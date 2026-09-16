/**
 * Teste de carga manual, não é `bun:test`: roda contra a API de verdade
 * (`bun run start`), precisa dela (e Postgres/Keycloak) no ar. `bun run
 * test:load`.
 *
 * Fase 1: throughput/latência sem contenção (muitas wallets diferentes,
 * nenhum lock disputado). Fase 2: contenção real sobre uma única wallet,
 * verificada por reconciliação, não só pela resposta HTTP.
 *
 * Sempre regrava LOAD_TEST_REPORT.md com os números desta execução: o
 * relatório nunca fica desalinhado do que o script realmente mede, porque
 * ele é gerado pelo próprio script, não copiado à mão do terminal.
 */

const API_URL = process.env.LOAD_TEST_API_URL ?? "http://localhost:3000";
const WORKER_URL = process.env.LOAD_TEST_WORKER_URL ?? "http://localhost:3001";
const KEYCLOAK_URL =
  process.env.LOAD_TEST_KEYCLOAK_URL ?? "http://localhost:8080";
const REPORT_PATH = `${import.meta.dir}/../../LOAD_TEST_REPORT.md`;

interface RequestResult {
  ok: boolean;
  status: number;
  durationMs: number;
  body: unknown;
}

async function getToken(): Promise<string> {
  const response = await fetch(
    `${KEYCLOAK_URL}/realms/wagering/protocol/openid-connect/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials&client_id=wagering-api&client_secret=wagering-api-secret",
    },
  );
  if (!response.ok) {
    throw new Error(
      `falha ao obter token: ${response.status} ${await response.text()}`,
    );
  }
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

async function timedFetch(
  url: string,
  init: RequestInit,
): Promise<RequestResult> {
  const startedAt = performance.now();
  const response = await fetch(url, init);
  const durationMs = performance.now() - startedAt;
  const body = await response.json().catch(() => undefined);
  return { ok: response.ok, status: response.status, durationMs, body };
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) {
    return 0;
  }
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1),
  );
  return sortedAsc[idx]!;
}

async function createWallet(
  token: string,
  initialBalance: string,
): Promise<{ id: string; playerId: string }> {
  const playerId = crypto.randomUUID();
  const result = await timedFetch(`${API_URL}/wallets`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      playerId,
      initialBalance: { amount: initialBalance, currency: "BRL" },
    }),
  });
  if (!result.ok) {
    throw new Error(
      `falha ao criar wallet: ${result.status} ${JSON.stringify(result.body)}`,
    );
  }
  return { id: (result.body as { id: string }).id, playerId };
}

async function submitBet(
  token: string,
  wallet: { id: string; playerId: string },
  amount: string,
  externalId: string,
): Promise<RequestResult> {
  return timedFetch(`${API_URL}/wager-transactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      providerId: "load-test",
      externalTransactionId: externalId,
      idempotencyKey: `load-test:${externalId}`,
      playerId: wallet.playerId,
      walletId: wallet.id,
      roundId: "load-test-round",
      gameId: "load-test-game",
      kind: "BET",
      money: { amount, currency: "BRL" },
    }),
  });
}

interface Phase1Result {
  totalRequests: number;
  walletCount: number;
  requestsPerWallet: number;
  durationSec: number;
  throughputPerSec: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorCount: number;
}

async function phase1ThroughputNoContention(
  token: string,
): Promise<Phase1Result> {
  console.log("\n=== Fase 1: throughput/latência, sem contenção ===");
  const WALLET_COUNT = 50;
  const REQUESTS_PER_WALLET = 10;
  const TOTAL_REQUESTS = WALLET_COUNT * REQUESTS_PER_WALLET;

  console.log(`Criando ${WALLET_COUNT} wallets...`);
  const wallets = await Promise.all(
    Array.from({ length: WALLET_COUNT }, () => createWallet(token, "10000.00")),
  );

  console.log(
    `Disparando ${TOTAL_REQUESTS} requests (${REQUESTS_PER_WALLET} por wallet, cada wallet só disputa lock com ela mesma)...`,
  );
  const startedAt = performance.now();
  const results = await Promise.all(
    wallets.flatMap((wallet, walletIdx) =>
      Array.from({ length: REQUESTS_PER_WALLET }, (_, i) =>
        submitBet(
          token,
          wallet,
          "10.00",
          `phase1-${walletIdx}-${i}-${crypto.randomUUID()}`,
        ),
      ),
    ),
  );
  const durationSec = (performance.now() - startedAt) / 1000;

  const errors = results.filter((r) => !r.ok);
  const durations = results.map((r) => r.durationMs).sort((a, b) => a - b);

  const result: Phase1Result = {
    totalRequests: TOTAL_REQUESTS,
    walletCount: WALLET_COUNT,
    requestsPerWallet: REQUESTS_PER_WALLET,
    durationSec,
    throughputPerSec: TOTAL_REQUESTS / durationSec,
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    p99Ms: percentile(durations, 99),
    errorCount: errors.length,
  };

  console.log(
    `Total: ${result.totalRequests} requests em ${result.durationSec.toFixed(2)}s`,
  );
  console.log(`Throughput: ${result.throughputPerSec.toFixed(1)} req/s`);
  console.log(
    `Latência: p50=${result.p50Ms.toFixed(0)}ms p95=${result.p95Ms.toFixed(0)}ms p99=${result.p99Ms.toFixed(0)}ms`,
  );
  console.log(
    `Erros: ${result.errorCount}/${result.totalRequests} (${((result.errorCount / result.totalRequests) * 100).toFixed(1)}%)`,
  );
  if (errors.length > 0) {
    console.log(
      "Exemplos de erro:",
      errors.slice(0, 3).map((e) => ({ status: e.status, body: e.body })),
    );
  }
  return result;
}

interface Phase2Result {
  walletId: string;
  initialBalance: number;
  betAmount: number;
  concurrentBets: number;
  processed: number;
  rejected: number;
  expectedProcessed: number;
  storedBalance: string;
  calculatedBalance: string;
  difference: string;
  consistent: boolean;
  checkedEntries: number;
}

async function phase2Contention(token: string): Promise<Phase2Result> {
  console.log(
    "\n=== Fase 2: conflito de concorrência real sobre uma única wallet ===",
  );
  const INITIAL_BALANCE = 300;
  const BET_AMOUNT = 10;
  const CONCURRENT_BETS = 50;
  const EXPECTED_PROCESSED = INITIAL_BALANCE / BET_AMOUNT; // 30, matematicamente exato

  const wallet = await createWallet(token, INITIAL_BALANCE.toFixed(2));
  console.log(
    `Wallet ${wallet.id}, saldo inicial ${INITIAL_BALANCE.toFixed(2)}, ${CONCURRENT_BETS} BETs de ${BET_AMOUNT.toFixed(2)} em paralelo (máximo processável: ${EXPECTED_PROCESSED})`,
  );

  const results = await Promise.all(
    Array.from({ length: CONCURRENT_BETS }, (_, i) =>
      submitBet(
        token,
        wallet,
        BET_AMOUNT.toFixed(2),
        `phase2-${i}-${crypto.randomUUID()}`,
      ),
    ),
  );

  const statuses = results.map(
    (r) =>
      (r.body as { transaction?: { status?: string } } | undefined)?.transaction
        ?.status,
  );
  const processed = statuses.filter((s) => s === "PROCESSED").length;
  const rejected = statuses.filter((s) => s === "REJECTED").length;
  console.log(
    `PROCESSED: ${processed}, REJECTED: ${rejected} (esperado: ${EXPECTED_PROCESSED} / ${CONCURRENT_BETS - EXPECTED_PROCESSED})`,
  );

  const reconciliationResponse = await timedFetch(
    `${API_URL}/wallets/${wallet.id}/reconciliation`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
  console.log("Reconciliação:", reconciliationResponse.body);
  const reconciliation = reconciliationResponse.body as {
    storedBalance?: { amount: string };
    calculatedBalance?: { amount: string };
    difference?: { amount: string };
    consistent?: boolean;
    checkedEntries?: number;
  };

  return {
    walletId: wallet.id,
    initialBalance: INITIAL_BALANCE,
    betAmount: BET_AMOUNT,
    concurrentBets: CONCURRENT_BETS,
    processed,
    rejected,
    expectedProcessed: EXPECTED_PROCESSED,
    storedBalance: reconciliation.storedBalance?.amount ?? "?",
    calculatedBalance: reconciliation.calculatedBalance?.amount ?? "?",
    difference: reconciliation.difference?.amount ?? "?",
    consistent: Boolean(reconciliation.consistent),
    checkedEntries: reconciliation.checkedEntries ?? 0,
  };
}

interface OutboxLagResult {
  reachable: boolean;
  publishedTotal?: number;
  lagSumMs?: number;
  lagCountMs?: number;
}

async function readOutboxLag(): Promise<OutboxLagResult> {
  console.log("\n=== Outbox lag ===");
  console.log(
    "Lido do /metrics do WORKER, não da API: são registros Prometheus separados, ler do lugar errado dá zero sem avisar.",
  );
  // O publisher do worker roda a cada 2s (ver WorkerSchedulerService): espera
  // pelo menos um ciclo cheio antes de ler, senão pega a foto de antes dele
  // ter processado o lote que a fase 2 acabou de gerar.
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  try {
    const response = await fetch(`${WORKER_URL}/metrics`);
    const text = await response.text();
    const publishedTotal = Number(
      text.match(/^outbox_published_total (\d+)/m)?.[1] ?? "0",
    );
    const lagSumMs = Number(
      text.match(/^outbox_publish_lag_ms_sum (\d+(\.\d+)?)/m)?.[1] ?? "0",
    );
    const lagCountMs = Number(
      text.match(/^outbox_publish_lag_ms_count (\d+)/m)?.[1] ?? "0",
    );
    console.log(`outbox_published_total ${publishedTotal}`);
    console.log(`outbox_publish_lag_ms_sum ${lagSumMs}`);
    console.log(`outbox_publish_lag_ms_count ${lagCountMs}`);
    return { reachable: true, publishedTotal, lagSumMs, lagCountMs };
  } catch {
    console.log(
      `worker não respondeu em ${WORKER_URL}, pulando (rode "bun run worker" pra ver esse número)`,
    );
    return { reachable: false };
  }
}

function buildReportMarkdown(
  phase1: Phase1Result,
  phase2: Phase2Result,
  outbox: OutboxLagResult,
  generatedAt: Date,
): string {
  const avgLagMs =
    outbox.reachable && outbox.lagCountMs && outbox.lagCountMs > 0
      ? (outbox.lagSumMs ?? 0) / outbox.lagCountMs
      : undefined;

  const outboxSection = outbox.reachable
    ? `\`\`\`
outbox_published_total ${outbox.publishedTotal}
outbox_publish_lag_ms_sum ${outbox.lagSumMs}
outbox_publish_lag_ms_count ${outbox.lagCountMs}
\`\`\`

Lag médio: \`${avgLagMs !== undefined ? (avgLagMs / 1000).toFixed(1) : "?"}s\`. Esse número inclui qualquer backlog
acumulado de outras execuções no mesmo ambiente, não é uma medida isolada
desta única rodada.`
    : `Worker não estava acessível em \`${WORKER_URL}\` durante esta execução
(rode \`bun run worker\` antes de \`bun run test:load\` pra ver esse número).`;

  return `# Relatório de teste de carga

Gerado automaticamente por \`bun run test:load\` em ${generatedAt.toISOString()}.
Números reais desta execução, contra a API e o worker de verdade (Postgres/
LocalStack/Keycloak em Docker, sem tuning de infraestrutura). Este arquivo é
sobrescrito toda vez que o script roda, nunca editado à mão.

## Como reproduzir

\`\`\`bash
docker compose up -d postgres localstack keycloak
bun run migration:up
bun run start    # terminal 1
bun run worker   # terminal 2 (opcional, só pra ver o lag da outbox)
bun run test:load
\`\`\`

## Fase 1: throughput e latência, sem contenção

${phase1.walletCount} wallets diferentes, ${phase1.requestsPerWallet} requests (\`BET\`) por
wallet, ${phase1.totalRequests} requests no total. Nenhuma wallet compartilha lock com
outra.

| Métrica | Valor |
|---|---|
| Total de requests | ${phase1.totalRequests} |
| Duração total | ${phase1.durationSec.toFixed(2)}s |
| Throughput | ${phase1.throughputPerSec.toFixed(1)} req/s |
| Latência p50 | ${phase1.p50Ms.toFixed(0)}ms |
| Latência p95 | ${phase1.p95Ms.toFixed(0)}ms |
| Latência p99 | ${phase1.p99Ms.toFixed(0)}ms |
| Taxa de erro | ${((phase1.errorCount / phase1.totalRequests) * 100).toFixed(1)}% (${phase1.errorCount}/${phase1.totalRequests}) |

## Fase 2: conflito de concorrência real sobre uma única wallet

Uma wallet, saldo inicial \`${phase2.initialBalance.toFixed(2)}\`, ${phase2.concurrentBets} \`BET\`s de
\`${phase2.betAmount.toFixed(2)}\` em paralelo. Máximo matematicamente possível de
aprovar: \`${phase2.initialBalance} / ${phase2.betAmount} = ${phase2.expectedProcessed}\`.

| Métrica | Valor |
|---|---|
| PROCESSED | ${phase2.processed} |
| REJECTED | ${phase2.rejected} |
| Esperado | ${phase2.expectedProcessed} / ${phase2.concurrentBets - phase2.expectedProcessed} (exato, não é probabilístico) |
| Saldo materializado | ${phase2.storedBalance} |
| Saldo recalculado do ledger | ${phase2.calculatedBalance} |
| Diferença | ${phase2.difference} |
| Consistente (\`reconcile\`) | ${phase2.consistent} |
| Lançamentos verificados | ${phase2.checkedEntries} |

O resultado é determinístico: cada \`BET\` só é decidido depois de adquirir o
lock pessimista da wallet, então o banco sempre aprova exatamente as
primeiras ${phase2.expectedProcessed} unidades de saldo disponível e rejeita o resto por
\`INSUFFICIENT_BALANCE\`, independente da ordem de chegada.

## Lag de publicação da outbox

Lido do \`/metrics\` do **worker** (\`WORKER_PORT\`, não da API, são registros
Prometheus separados):

${outboxSection}

## Conclusão

${phase1.errorCount === 0 ? "Sem contenção, throughput alto e erro zero." : `Sem contenção, throughput alto, mas ${phase1.errorCount} erro(s) na fase 1 (ver log do script).`}
${
  phase2.processed === phase2.expectedProcessed && phase2.consistent
    ? "Com contenção real sobre uma única wallet, o sistema aprovou exatamente o máximo matematicamente possível e rejeitou o resto sem deixar o saldo negativo, sem duplicar débito, e sem inconsistência entre o saldo materializado e o ledger recalculado do zero."
    : "ATENÇÃO: a fase 2 não bateu o esperado ou a reconciliação ficou inconsistente, ver os números acima."
}
`;
}

async function main(): Promise<void> {
  const token = await getToken();
  const phase1 = await phase1ThroughputNoContention(token);
  const phase2 = await phase2Contention(token);
  const outbox = await readOutboxLag();

  const markdown = buildReportMarkdown(phase1, phase2, outbox, new Date());
  await Bun.write(REPORT_PATH, markdown);
  console.log(`\nLOAD_TEST_REPORT.md regravado (${REPORT_PATH}).`);

  if (phase2.processed !== phase2.expectedProcessed) {
    console.error(
      `\nFASE 2 FALHOU: esperado ${phase2.expectedProcessed} PROCESSED, veio ${phase2.processed}`,
    );
    process.exit(1);
  }
  if (!phase2.consistent) {
    console.error("\nFASE 2 FALHOU: reconciliação reportou inconsistência");
    process.exit(1);
  }
  console.log(
    "\nOK: fase 2 bateu o máximo matematicamente possível, e a reconciliação ficou consistente.",
  );
}

main();
