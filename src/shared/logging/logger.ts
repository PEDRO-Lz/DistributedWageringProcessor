import pino from "pino";
import { getLogContext } from "./log-context";

const base = pino({
  level: process.env.LOG_LEVEL ?? "info",
});

/**
 * Logger de uso do código de aplicação/domínio (nunca o Logger do Nest:
 * aquele é pra classe com decorator, esse é framework-free, importável de
 * qualquer use case). Todo log sai com o contexto do AsyncLocalStorage
 * misturado, sem precisar passar correlationId em cada chamada.
 */
export const logger = {
  info(msg: string, fields: Record<string, unknown> = {}): void {
    base.info({ ...getLogContext(), ...fields }, msg);
  },
  warn(msg: string, fields: Record<string, unknown> = {}): void {
    base.warn({ ...getLogContext(), ...fields }, msg);
  },
  error(msg: string, fields: Record<string, unknown> = {}): void {
    base.error({ ...getLogContext(), ...fields }, msg);
  },
};
