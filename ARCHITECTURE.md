# Arquitetura

Decisões tomadas, os trade-offs por trás de cada uma, a taxonomia completa
de erros, e o que ficou fora do escopo. O README diz "como
subir e usar". Este documento cobre "por que está assim".

## Estilo geral

DDD + ports and adapters (hexagonal). Três camadas por bounded context
(`wallets`, `wagering`, `messaging`):

- **domain**: classes puras, sem import de framework nenhum (nem MikroORM,
  nem NestJS). `Money`, `Wallet`, `WalletLedgerEntry`, `WagerTransaction`.
- **application**: casos de uso e ports (interfaces). Também sem framework:
  todo caso de uso é uma classe comum, injeção por construtor manual.
- **infrastructure / interface**: adapters (MikroORM, SQS) e a borda com o
  mundo de fora (controllers HTTP, consumer de fila). É a única camada que
  conhece NestJS, MikroORM ou o SDK da AWS.

**Dois processos Bun**: `main.ts` (API HTTP) e `worker.ts` (SQS
consumer + outbox publisher + scheduler de retry). Ambos importam
`CoreModule` (repositórios e casos de uso compartilhados), mas cada um chama
`MikroORM.init()` a própria vez, então cada processo tem seu próprio pool de
conexão, seu próprio registro Prometheus, e a queda de um nunca derruba o
outro. `ApiModule` nunca importa nada de fila e `WorkerModule` nunca declara
rota de negócio.

## Money como bigint de centavos

`Money` guarda um `bigint` de centavos, `bigint` é nativo do runtime, sem dependência nova, e o domínio é só soma/subtração/comparação. `toJSON()`/`toString()` convertem de
volta pra string decimal (`"25.00"`) só na borda de serialização.

## Idempotência: claim-first

`WagerTransactionRepositoryPort.claim()` faz um insert e um `flush()`
imediato, deixando a violação da constraint `unique(idempotency_key)` (ou
`unique(provider_id, external_transaction_id)`) estourar como
`UniqueConstraintViolationException`. Não existe um `SELECT` de verificação
antes: sob concorrência real, um `SELECT` seguido de `INSERT` é uma corrida
(duas transações podem ver "não existe" e as duas tentar inserir). O
banco decidindo via constraint é a única forma de garantir exclusividade sem
lock explícito adicional. Quando o insert falha, `handleClaimConflict()`
busca a linha que já existe: se o payload bate (mesmo hash), é replay
idempotente, se não bate, é `IdempotencyConflictError` de verdade.

`computePayloadHash()` faz `sha256` sobre o JSON canônico (chaves ordenadas)
só dos campos de negócio (nunca metadado de transporte como `correlationId`),
então dois requests com o mesmo conteúdo de negócio sempre produzem o mesmo
hash, independente de ordem de chaves no JSON recebido.

## Ordem de lock: wallet antes da transação

Em `SubmitWagerTransactionUseCase.processNew()`, a wallet é travada
(`PESSIMISTIC_WRITE`) **antes** de reivindicar a linha de
`wager_transactions`, nunca depois. Invertido, isso deadlockaria sob
concorrência real: um `INSERT` que referencia `wallet_id` via FK adquire um
`FOR KEY SHARE` implícito na wallet; duas transações concorrentes conseguem
esse shared lock ao mesmo tempo, e cada uma trava esperando a outra soltar
pra fazer o upgrade pra `FOR UPDATE`. Travando a wallet primeiro, essa
inversão nunca existe. Verificado com o cenário obrigatório (saldo 100, duas
apostas de 80 em paralelo) e com 10 requests HTTP verdadeiramente paralelos
(`wallet_lock_conflicts_total` incrementou exatamente 10 vezes).

## Resolução de referência (REFUND/ROLLBACK)

Regras (`WagerTransactionFinalizer.resolveReference()`):

- REFUND só referencia BET.
- ROLLBACK referencia BET, WIN ou REFUND.
- Mesmo provider/player/wallet/round/currency da referência.
- Valor precisa bater exatamente.
- Referência precisa estar `PROCESSED` (se `PENDING`/`PENDING_REFERENCE`, a
  resolução também fica pendente; se `REJECTED`/`FAILED`, rejeita).
- Uma referência só pode ser revertida uma vez por tipo de reversão (checado
  em código via `findProcessedReversal()` e reforçado por um índice único
  parcial no banco: `(reference_transaction_id, kind) where status =
  'PROCESSED' and kind in ('REFUND','ROLLBACK')`).

Quando a referência ainda não existe (mensageria não garante ordem entre
filas diferentes), a transação fica `PENDING_REFERENCE`, não erro. O retry é
`ReprocessPendingReferencesUseCase`, com backoff exponencial (base 5s, dobra
por tentativa, capado em 5min) até `MAX_REFERENCE_RETRY_ATTEMPTS = 10`
tentativas, depois disso rejeita por `REFERENCE_RESOLUTION_TIMEOUT`. Rodado
pelo `WorkerSchedulerService` a cada 5s.

## Persistência: MikroORM 7 sem decorators

MikroORM 7 não tem `@Entity`/`@Property`: entities são `defineEntity({...})`
+ o builder `p`, e o tipo de uma linha é `InferEntity<typeof XEntity>`. Ports
(`WalletRepositoryPort`, etc.) tomam `EntityManager` como primeiro parâmetro
de cada método: é a concessão pragmática deste projeto ao "hexagonal": threading do mesmo `em` através de várias chamadas de repositório
dentro do mesmo `em.transactional()` é assim que MikroORM compartilha
transação, reimplementar isso por fora seria reimplementar o unit-of-work do
próprio ORM.

## Imutabilidade em duas camadas

Todo `markProcessed()`/`reject()`/`fail()` em `WagerTransaction` verifica
estado terminal (`assertNotTerminal()`) antes de mutar. Isso é disciplina de
código, então **também** existe um trigger de banco (`Migration
20260916134723` + o trigger de `wallet_ledger_entries` do commit da schema)
que bloqueia `UPDATE`/`DELETE` de verdade, independente de qualquer bug de
aplicação:

- `wallet_ledger_entries`: `UPDATE`/`DELETE` sempre rejeitados.
- `wager_transactions`: `UPDATE` permitido enquanto não terminal, rejeitado
  depois; `DELETE` nunca permitido.
- `outbox_messages`: o envelope (`id`, `aggregate_id`, `event_type`,
  `payload`, `occurred_at`) nunca muda, publicada ou não; depois de
  publicada (`published_at` setado), a linha inteira congela; `DELETE`
  nunca permitido.

Testado com SQL cru direto no Postgres (`test/integration/structural-
immutability.spec.ts`), não só verificado na hora que o trigger foi escrito.

## Mensageria: outbox + inbox, sem exactly-once forçado

`OutboxMessage` é gravado na mesma transação que a mudança de estado que o
gerou (garantia de atomicidade: nunca existe mudança sem evento, nem evento
sem mudança). Um processo separado (`PublishOutboxBatchUseCase`, rodando no
worker) publica em lote (`FOR UPDATE SKIP LOCKED`). O consumo do lado de entrada (`ConsumeWagerTransactionBatchUseCase`)
usa `InboxMessage` pra dedup por `(consumerName, messageId)`, na mesma
transação do `SubmitWagerTransactionUseCase`, que já é idempotente por
`idempotencyKey` de qualquer forma, então o inbox é defesa em profundidade,
não a única linha de defesa.

SQS entrega **at-least-once**, nunca exactly-once: o inbox (dedup) e a
idempotência do próprio caso de uso são o que compensam isso, não alguma
garantia da fila. DLQ é inteiramente responsabilidade da SQS
(`RedrivePolicy` com `maxReceiveCount: 5`, configurado na criação da fila):
o código da aplicação nunca decide "isso é lixo agora", só retorna
`ack: false` em erro e deixa a fila decidir quando desistir (verificado em
`test/messaging/dlq-exhaustion.spec.ts`: exatamente 5 tentativas, zero
contador de "dlq" gravado pela aplicação).

## Autenticação: client_credentials, não password grant

Providers são sistemas backend-a-backend, nunca um humano digitando senha,
então o fluxo é `client_credentials` contra um client Keycloak confidencial
(`wagering-api`, `serviceAccountsEnabled: true`), não `password` grant.
`KeycloakAuthGuard` valida o JWT via JWKS (chave pública buscada por HTTP,
cacheada), confere `issuer`/`audience`/role `provider`. O realm precisa de um
`oidc-audience-mapper` no client pro `aud` do token bater com `OIDC_AUDIENCE`.
Sem esse mapper, o `aud` default do Keycloak é só `account`, e a validação
de audience falharia sempre.

## Observabilidade

Logger estruturado (`pino`) com contexto via `AsyncLocalStorage`
(`correlationId`/`causationId`/`messageId`/`providerId`): nasce na borda
(middleware HTTP lê/gera `x-correlation-id`; consumer de fila abre com
`messageId` do SQS) e atravessa qualquer chamada de função por baixo, sem
precisar passar isso em toda assinatura.

Métricas via `PrometheusMetricsService` (`prom-client`), um `Registry` por
processo: API e worker nunca compartilham memória, então nunca compartilham
registro. Duas métricas quase passaram batido ao implementar o resto (só
apareceram ao reconferir a lista de requisitos item a item, não nasceram
naturalmente escrevendo o código): `wallet_lock_wait_ms`/
`wallet_lock_conflicts_total` (contenção real no lock pessimista da wallet)
e `wager_transaction_processing_duration_ms` (ponta a ponta, cobrindo
processamento novo e replay idempotente).

## Taxonomia de `FailureCode`

Motivo de rejeição gravado em `WagerTransaction.failureCode` quando o status
é `REJECTED`/`FAILED` (nunca aparece em transação `PROCESSED`):

| Code | Quando |
|---|---|
| `INSUFFICIENT_BALANCE` | BET (ou qualquer débito) deixaria o saldo negativo |
| `ROLLBACK_INSUFFICIENT_BALANCE` | ROLLBACK deixaria o saldo negativo (deliberadamente distinto do anterior: reversão sem saldo não é a mesma situação de negócio que uma aposta sem saldo) |
| `WALLET_CURRENCY_MISMATCH` | Moeda da transação não bate com a moeda da wallet |
| `REFERENCE_MISMATCH` | Referência existe, mas dono (player/wallet/round/currency) não bate |
| `REFERENCE_INVALID_KIND` | Referência existe, mas o kind não é reversível por esse tipo (ex: ROLLBACK de uma REFUND que já é reversão) |
| `REFERENCE_INVALID_STATE` | Referência está `REJECTED`/`FAILED`, nunca vai ficar resolvível |
| `REFERENCE_AMOUNT_MISMATCH` | Valor da reversão não bate com o valor da referência |
| `REFERENCE_ALREADY_REVERSED` | Essa referência já foi revertida (desse mesmo tipo) antes |
| `REFERENCE_RESOLUTION_TIMEOUT` | `PENDING_REFERENCE` esgotou `MAX_REFERENCE_RETRY_ATTEMPTS` (10) sem resolver |
| `PERSISTENCE_FAILURE` | Reservado pra falha de infraestrutura ao persistir o efeito (não usado ativamente hoje: `applyEffect()` não engole erro de persistência, deixa propagar) |

## Taxonomia de erro HTTP (`DomainError.code`)

Toda subclasse de `DomainError` carrega seu próprio `code`, o
`DomainExceptionFilter` traduz isso pro status HTTP. Erro não listado no
mapa cai em `500` de propósito: não é o cliente que errou, é invariante de
domínio violada (bug):

| Code | Status | Erro |
|---|---|---|
| `INVALID_MONEY_AMOUNT` | 400 | Formato de valor inválido (não é decimal com 2 casas) |
| `NEGATIVE_MONEY_AMOUNT` | 400 | Valor negativo onde não é permitido |
| `INVALID_CURRENCY` | 400 | Código de moeda inválido |
| `CURRENCY_MISMATCH` | 400 | Operação entre moedas diferentes |
| `VALIDATION_MISSING_REFERENCE` | 400 | REFUND/ROLLBACK sem `referenceExternalTransactionId` |
| `VALIDATION_WALLET_PLAYER_MISMATCH` | 400 | Wallet informada não pertence ao player |
| `VALIDATION_INVALID_CURSOR` | 400 | Cursor de paginação malformado |
| `WALLET_NOT_FOUND` | 404 | Wallet não existe |
| `WALLET_ALREADY_EXISTS` | 409 | Já existe wallet pra esse player+moeda |
| `IDEMPOTENCY_CONFLICT` | 409 | Mesma Idempotency-Key com payload diferente, ou corrida perdida sem vencedor localizável |
| `INFRASTRUCTURE_TRANSIENT` | 503 | Falha transitória, seguro pedir retry com a mesma Idempotency-Key |
| `UNBALANCED_LEDGER_ENTRY` | 500 (não mapeado) | Invariante de ledger violada: bug, não input do usuário |
| `INVALID_TRANSACTION_STATE` | 500 (não mapeado) | Transição de estado ilegal numa `WagerTransaction` terminal: bug |
| `INVARIANT_VIOLATION` | 500 (não mapeado) | Invariante de domínio genérica violada: bug |

## Limitações conhecidas

- **Sem tracing distribuído** (OpenTelemetry/Jaeger): `correlationId` no log
  estruturado é o que existe hoje. não tem span/trace formal atravessando
  API -> fila -> worker.
- **LocalStack, não AWS real**: o `SqsPort`/`SqsClientAdapter` fala o
  protocolo SQS de verdade, mas nunca foi testado contra uma conta AWS real
  (custo/latência de rede diferentes, IAM real não exercitado).
- **Sem versionamento formal de schema de evento**: `IntegrationEvent` tem
  um campo `version`, mas não existe nenhum registro/validação de
  compatibilidade entre versões, é só um número gravado no envelope.
- **`PERSISTENCE_FAILURE` não é ativamente lançado**: existe na taxonomia,
  mas nenhum caminho de código hoje o produz de propósito: falha real de 
  persistência propaga como exceção não tratada, não como um `FailureCode`
  gravado na transação.
- **Sem multi-região/replicação de Postgres**: uma instância de Postgres,
  sem read replica, sem failover automático.
- **Reconciliação é on-demand, não um job agendado**: `GET
  /wallets/:id/reconciliation` existe e funciona, mas nada chama isso
  periodicamente sozinho, é uma ferramenta de diagnóstico manual (ou pra um
  cron externo), não um scheduler do worker.
- **Keycloak com credenciais de dev no realm export** (`wagering-api-secret`
  em texto puro no repo): aceitável pra ambiente local, nunca deveria ir pra
  produção assim, precisaria de secret management real (Vault, AWS Secrets
  Manager, etc).
