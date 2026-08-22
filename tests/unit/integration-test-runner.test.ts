import { describe, expect, test } from "bun:test";
import { integrationTestDatabaseUrl, integrationTestEnvironment } from "../../scripts/run-integration-tests";

describe("integration test database isolation", () => {
  test("integration specs never fall back to the live application database", async () => {
    const unsafeFiles: string[] = [];
    for await (const file of new Bun.Glob("tests/integration/*.test.ts").scan({ cwd: import.meta.dir + "/../.." })) {
      const source = await Bun.file(import.meta.dir + `/../../${file}`).text();
      if (source.includes("process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL")) unsafeFiles.push(file);
    }
    expect(unsafeFiles).toEqual([]);
  });

  test("derives a dedicated database when no explicit test URL exists", () => {
    const result = integrationTestDatabaseUrl({
      DATABASE_URL: "postgresql://user:password@localhost:5432/ignition_outbound",
    });
    expect(new URL(result).pathname).toBe("/ignition_outbound_test");
  });

  test("accepts an explicit distinct test database", () => {
    const result = integrationTestDatabaseUrl({
      DATABASE_URL: "postgresql://user:password@localhost:5432/ignition_outbound",
      TEST_DATABASE_URL: "postgresql://user:password@localhost:5432/outbound_ci",
    });
    expect(new URL(result).pathname).toBe("/outbound_ci");
  });

  test("refuses to run integration tests against the development database", () => {
    expect(() => integrationTestDatabaseUrl({
      DATABASE_URL: "postgresql://user:password@localhost:5432/ignition_outbound",
      TEST_DATABASE_URL: "postgresql://user:password@localhost:5432/ignition_outbound",
    })).toThrow("TEST_DATABASE_URL must not target the development database");
  });

  test("refuses a reserved PostgreSQL database as integration target", () => {
    expect(() => integrationTestDatabaseUrl({
      TEST_DATABASE_URL: "postgresql://user:password@localhost:5432/postgres",
    })).toThrow("Integration test database name is reserved");
  });

  test("uses an isolated encryption key instead of inheriting a local application secret", () => {
    const result = integrationTestEnvironment(
      {
        APP_ENCRYPTION_KEY: "local-application-secret",
        BETTER_AUTH_SECRET: "local-auth-secret",
      },
      "postgresql://user:password@localhost:5432/ignition_outbound_test",
    );
    expect(result.TEST_DATABASE_URL).toEndWith("/ignition_outbound_test");
    expect(result.APP_ENCRYPTION_KEY).toBe("ignition-outbound-integration-tests-only");
    expect(result.APP_ENCRYPTION_KEY).not.toBe("local-application-secret");
  });
});
