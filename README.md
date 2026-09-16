# distributedwageringprocessor

Processador de transações de apostas (BET/WIN/LOSS/REFUND/ROLLBACK) com wallet
ledger, idempotência e resolução de referência, seguindo DDD/ports and
adapters. Bun + TypeScript + MikroORM + Postgres + NestJS.

## Requisitos

- Bun 1.4+
- Docker (Postgres)

## Como subir

```bash
bun install
cp .env.example .env
docker compose up -d postgres
bun run migration:up
bun run start
```

`.env` é lido pela aplicação (`DATABASE_*`, `PORT`) e `docker-compose.yml` (Postgres).  
Sem `.env`, tudo cai em um fallback igual ao de `.env.example`, então funciona também sem copiar nada.

API sobe em `http://localhost:3000` (troca em .env `PORT`).

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
