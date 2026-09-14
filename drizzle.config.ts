import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./drizzle/schema.ts",
  out: "./drizzle/migrations",
  dbCredentials: {
    // Overridable per environment; local-dev fallback matches the Postgres
    // instance used by the db:migrate docs (DATABASE_URL=postgres://localhost:5432/novelos).
    url: process.env.DATABASE_URL ?? "postgres://localhost:5432/novelos",
  },
});
