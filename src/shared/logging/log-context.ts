import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Campos que atravessam várias chamadas de função e várias
 * camadas de use case sem que não precise passar isso explícito em
 * toda assinatura. `correlationId` é o caso que nasce na borda (header
 * HTTP ou mensagem SQS) e devia aparecer em todo log até o fim do
 * processamento, mesmo em código que não sabe nada sobre HTTP ou fila
 */
export interface LogContext {
  correlationId?: string;
  causationId?: string;
  messageId?: string;
  providerId?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

// Mescla com o contexto já aberto (se houver), nunca substitui por completo:
// permite "entrar" de novo mais pra dentro da pilha só pra adicionar um campo
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  const merged = { ...storage.getStore(), ...context };
  return storage.run(merged, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}
