import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/infrastructure/src/database/schema.ts",
  out: "./packages/infrastructure/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/ignition_outbound",
  },
  strict: true,
  verbose: true,
});
