import { describe, expect, test } from "bun:test";
import { integrationTestDatabaseUrl } from "../../scripts/run-integration-tests";

describe("integration test database isolation", () => {
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
});
