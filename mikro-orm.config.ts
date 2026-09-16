import { defineConfig } from "@mikro-orm/postgresql";
import { UnderscoreNamingStrategy } from "@mikro-orm/core";

export default defineConfig({
  namingStrategy: UnderscoreNamingStrategy,
  host: process.env.DATABASE_HOST ?? "localhost",
  port: Number(process.env.DATABASE_PORT ?? 5432),
  user: process.env.DATABASE_USER ?? "wagering",
  password: process.env.DATABASE_PASSWORD ?? "wagering",
  dbName: process.env.DATABASE_NAME ?? "wagering",
  entities: ["./src/**/*.entity.js"],
  entitiesTs: ["./src/**/*.entity.ts"],
  migrations: {
    path: "migrations",
    pathTs: "migrations",
  },
});
