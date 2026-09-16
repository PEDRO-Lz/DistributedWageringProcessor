# distributedwageringprocessor

Processador de transações de apostas (BET/WIN/LOSS/REFUND/ROLLBACK) com wallet
ledger, idempotência e resolução de referência, seguindo DDD/ports and
adapters. Bun + TypeScript + MikroORM + Postgres + NestJS.

## Requisitos

- Bun 1.4+
- Docker (Postgres + LocalStack, que simula SQS localmente)

## Como subir

```bash
bun install
cp .env.example .env
docker compose up -d postgres localstack
bun run migration:up
bun run start    # API, processo 1
bun run worker   # worker (SQS consumer/publisher + scheduler), processo 2
```

`.env` é lido pela aplicação (`DATABASE_*`, `PORT`, `WORKER_PORT`,
`AWS_REGION`, `SQS_ENDPOINT`) e pelo `docker-compose.yml` (Postgres,
LocalStack). Sem `.env`, tudo cai em um fallback igual ao de
`.env.example`, então funciona também sem copiar nada.

API sobe em `http://localhost:3000`, worker em `http://localhost:3001`
(só `/health`). Portas trocam em `.env` (`PORT`, `WORKER_PORT`).

Scripts:  
`bun run typecheck`  
`bun test`  
`bun run migration:create`  
`migration:down`  
`migration:pending`

## Rotas

`playerId` e `walletId` são coluna `uuid` no Postgres: precisa mandar um UUID de
verdade, não uma string qualquer.

### Health

- `GET /health` → `{ "status": "ok", "postgres": "ok" }`

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
