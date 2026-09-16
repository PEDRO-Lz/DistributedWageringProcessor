// Tokens de DI pro NestJS
// A instância do MikroORM é só mais uma dependência wireada à mão, do mesmo
// jeito que test/support/test-orm.ts é pros testes
export const MIKRO_ORM = Symbol("MIKRO_ORM");
export const ENTITY_MANAGER = Symbol("ENTITY_MANAGER");
