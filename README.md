# distributedwageringprocessor

Processador de transações de apostas (BET/WIN/LOSS/REFUND/ROLLBACK) com wallet
ledger, idempotência e resolução de referência, seguindo DDD/ports and
adapters. Bun + TypeScript + MikroORM + Postgres + NestJS.

## Requisitos

- Bun 1.4+
- Docker (Postgres + LocalStack, que simula SQS + Keycloak localmente)

## Como subir

```bash
bun install
cp .env.example .env
docker compose up -d postgres localstack keycloak
bun run migration:up
bun run start    # API, processo 1
bun run worker   # worker (SQS consumer/publisher + scheduler), processo 2
```

`.env` é lido pela aplicação (`DATABASE_*`, `PORT`, `WORKER_PORT`,
`AWS_REGION`, `SQS_ENDPOINT`, `KEYCLOAK_*`, `OIDC_AUDIENCE`) e pelo
`docker-compose.yml` (Postgres, LocalStack, Keycloak). Sem `.env`, tudo cai
em um fallback igual ao de `.env.example`, então funciona também sem copiar
nada.

API sobe em `http://localhost:3000`, worker em `http://localhost:3001`
(só `/health`). Portas trocam em `.env` (`PORT`, `WORKER_PORT`).

Scripts:  
`bun run typecheck`  
`bun test`  
`bun run migration:create`  
`migration:down`  
`migration:pending`

## Autenticação

Toda rota de negócio (`/wallets/*`, `/wager-transactions/*`) exige
`Authorization: Bearer <token>` com um JWT válido, emitido pelo Keycloak, com
a role `provider`. `/health` continua aberto (`@Public()`). O worker nunca
registra esse guard.

O fluxo é `client_credentials` contra o client confidencial `wagering-api`, não `password` grant de usuário. Essa request é direto no Keycloak:

- `POST http://localhost:8080/realms/wagering/protocol/openid-connect/token`
  Header: `Content-Type: application/x-www-form-urlencoded`
  Body (`x-www-form-urlencoded`, não JSON)

  ```
  grant_type=client_credentials
  client_id=wagering-api
  client_secret=wagering-api-secret
  ```
  Resposta: `{ "access_token": "...", "expires_in": 300, ... }`

O `access_token` vai no header `Authorization: Bearer <access_token>` de
qualquer chamada em `/wallets` ou `/wager-transactions`. Expira em 5 minutos
(`expires_in`), pede outro quando expirar.

## Rotas

`playerId` e `walletId` são coluna `uuid` no Postgres: precisa mandar um UUID de
verdade, não uma string qualquer.

### Health

- `GET /health` → `{ "status": "ok", "postgres": "ok" }` (API e worker)
- `GET /health/ready` → `{ "status": "ok", "postgres": "ok", "sqs": "ok" }` (só worker, checa SQS também)
- `GET /metrics` → métricas Prometheus (API e worker, registros separados: métricas de outbox/fila só aparecem no do worker)

### Wallets

- `POST /wallets` (`201`)
  ```json
  { "playerId": "<uuid>", "initialBalance": { "amount": "100.00", "currency": "BRL" } }
  ```
- `GET /wallets/:id`
- `GET /wallets/:id/ledger?cursor=&limit=` (cursor opaco, keyset; `limit` default 50)
- `GET /wallets/:id/reconciliation` (soma o ledger do zero e compara com o saldo materializado)

### Wager transactions

- `POST /wager-transactions` (`201`)
  ```json
  {
    "providerId": "provider-a",
    "externalTransactionId": "ext-1",
    "idempotencyKey": "provider-a:ext-1",
    "playerId": "<uuid>",
    "walletId": "<uuid>",
    "roundId": "round-1",
    "gameId": "game-1",
    "kind": "BET",
    "money": { "amount": "25.00", "currency": "BRL" },
    "referenceExternalTransactionId": "<obrigatório em REFUND/ROLLBACK>"
  }
  ```
  `kind`: `BET | WIN | LOSS | REFUND | ROLLBACK` (`OPENING` é interno, nunca
  submetido externamente). Repetir o mesmo `idempotencyKey` com o mesmo
  payload devolve `idempotentReplay: true` sem reprocessar.
- `GET /wager-transactions/:id`

### Erros

Erro de domínio (`WalletNotFoundError`, `IdempotencyConflictError`, etc):
```json
{ "failureCode": "WALLET_NOT_FOUND", "message": "..." }
```
com o status HTTP correspondente (400/404/409/503). Erro de validação de DTO
(campo faltando, `kind` fora do enum) vem no formato padrão do Nest:
```json
{ "statusCode": 400, "message": ["..."], "error": "Bad Request" }
```

## Mensageria

Dois processos Bun separados, cada um com seu próprio pool de conexão com o
Postgres: `bun run start` (API HTTP) e `bun run worker` (SQS consumer +
outbox publisher + scheduler). A API nunca importa nada de fila e o worker
nunca declara rota de negócio.

Filas (LocalStack, criadas automaticamente por `infra/localstack/init-queues.sh`
quando o container sobe):

- `wager-transactions.fifo`: entrada. Mensagem no mesmo shape do body de
  `POST /wager-transactions`. O worker consome, faz dedup por
  `(consumerName, messageId)` na tabela de inbox, chama o
  `SubmitWagerTransactionUseCase` (mesma idempotência por
  `idempotencyKey`), e só apaga a mensagem (`ack`) depois do commit.
  Redrive policy manda pra `wager-transactions-dlq.fifo` depois de 5
  tentativas sem ack, a fila cuida disso sozinha.
- `wager-events.fifo`: saída. O publisher pega o lote pendente da outbox
  (`FOR UPDATE SKIP LOCKED`) e publica cada evento, agrupando por `aggregateId` (ordem garantida por wallet/transação numa fila FIFO).

Testar manualmente sem a API no ar (o worker processa sozinho):
```bash
QUEUE_URL=$(docker compose exec -T localstack awslocal sqs get-queue-url --queue-name wager-transactions.fifo --query QueueUrl --output text)
docker compose exec -T localstack awslocal sqs send-message \
  --queue-url "$QUEUE_URL" \
  --message-body '{"providerId":"provider-a","externalTransactionId":"ext-1","idempotencyKey":"provider-a:ext-1","playerId":"<uuid>","walletId":"<uuid>","roundId":"round-1","gameId":"game-1","kind":"BET","money":{"amount":"25.00","currency":"BRL"}}' \
  --message-group-id "<walletId>" \
  --message-deduplication-id "ext-1"
```

## Observabilidade

Logger estruturado (pino, JSON) com `correlationId`/`messageId`/`providerId`
propagados via `AsyncLocalStorage`, sem precisar passar isso em toda
assinatura de função: nasce no middleware HTTP (header `x-correlation-id`,
gera um novo se não vier) ou no consumer de fila (`messageId` do SQS).

Métricas Prometheus (`prom-client`), um `Registry` por processo:

- `wallet_lock_wait_ms` / `wallet_lock_conflicts_total`: tempo pra adquirir
  o `FOR UPDATE` da wallet em `SubmitWagerTransactionUseCase`; conflito é
  `wait > 5ms`, proxy honesto de contenção real (verificado com 10 BETs
  verdadeiramente paralelos contra a mesma wallet: incrementou exatamente
  10 vezes).
- `wager_transaction_processing_duration_ms{outcome}`: ponta a ponta,
  `outcome=new` (processamento novo) ou `outcome=replay` (idempotente).
- `outbox_publish_lag_ms`: tempo entre o evento acontecer (`occurredAt`) e
  ser publicado na fila.
- Mais os contadores por status/kind, replays, mensagens de fila por
  status, publicações e falhas de publicação da outbox.

## Testes

```bash
bun test
```

Roda tudo de uma vez, `test/support/test-orm.ts` e `test/support/sqs-test-
utils.ts` cuidam do bootstrap (sem container de DI, wiring manual, igual
`CoreModule` mas pra teste). Precisa de Postgres, LocalStack e Keycloak de
pé (não sobe nada sozinho).

- `test/unit`: domínio puro, sem infraestrutura.
- `test/integration`: um caso de uso ou repositório por vez, Postgres real
  (idempotência, atomicidade, imutabilidade estrutural via SQL cru).
- `test/concurrency`: múltiplas instâncias reais (`createTestInstance()`
  abre um pool de conexão cada, como processos separados de verdade) batendo
  na mesma wallet ao mesmo tempo.
- `test/messaging`: LocalStack real, sem mock (consumo ponta a ponta,
  exaustão de DLQ, dois publishers concorrentes).

Se o `worker` (`bun run worker`) estiver rodando em paralelo, ele compete
pelas mesmas filas reais que os testes de mensageria usam: para ele antes
de rodar `bun test`, ou aceite que 1-2 testes de fila podem falhar por
disputa (não é bug, é o mesmo consumidor de produção roubando a mensagem do
teste). Sempre confira `ps aux` antes de descartar isso como bug, um `bun
run worker` esquecido de uma sessão anterior já causou exatamente esse
sintoma neste projeto.

## Progresso

- Money como bigint imutável (centavos) e base de DomainError
- Wallet e WalletLedgerEntry
- WagerTransaction, máquina de estado
- Inbox, Outbox e integration events
- Schema Postgres via migrations, com triggers de imutabilidade
- Entities, mappers e ports do MikroORM (v7, sem decorators: `defineEntity` + `p`)
- Adapters do MikroORM e paginação por cursor
- Casos de uso da Wallet (abrir, consultar, ledger, reconciliação)
- Submissão de WagerTransaction com idempotência claim-first
- Worker de retry pra PENDING_REFERENCE, com backoff exponencial
- HTTP: primeira parte end-to-end (casos de uso continuam sem decorator nenhum)
- Wiring compartilhado extraído pra CoreModule (API e worker importam o mesmo)
- LocalStack + filas SQS (wager-transactions.fifo + DLQ, wager-events.fifo)
- Port + adapter pro SQS, sem o SDK da AWS saindo pro resto do código
- Publisher da outbox (lote pendente, retry com backoff em falha de envio)
- Consumer de wager-transactions.fifo, dedup por inbox, recuperação de crash
- worker.ts: segundo processo Bun, scheduler roda consumer/publisher/retry de referência
- Autenticação via Keycloak (client_credentials, role "provider", KeycloakAuthGuard global com @Public() pro health)
- Logger estruturado (pino + AsyncLocalStorage pra correlationId/messageId/providerId)
- Métricas Prometheus por processo, incluindo lock wait/conflicts, duração de processamento e lag de publicação
- /health/ready do worker, checando SQS além do Postgres
- Teste de imutabilidade estrutural (triggers do Postgres, ledger/wager_transactions/outbox)
- Teste de concorrência: REFUND/ROLLBACK fora de ordem, resolvido depois, consistência provada via reconcile
- Teste de exaustão real de DLQ (LocalStack real, sem mock, maxReceiveCount da SQS)
- Teste de dois publishers de outbox concorrentes (dois pools MikroORM, sem duplicar nem perder)
- Documentação final (README completo, ARCHITECTURE.md com decisões, trade-offs e taxonomia de erros)
