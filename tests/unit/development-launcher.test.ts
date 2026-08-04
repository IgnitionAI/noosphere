import { describe, expect, test } from "bun:test";
import { developmentProcessSpecs } from "../../scripts/start-development";

describe("development launcher", () => {
  test("runs the API, worker and web app together", () => {
    expect(developmentProcessSpecs).toEqual([
      { name: "api", command: ["bun", "apps/api/src/index.ts"] },
      { name: "worker", command: ["bun", "apps/worker/src/index.ts"] },
      { name: "web", command: ["bun", "run", "web"] },
    ]);
  });
});
