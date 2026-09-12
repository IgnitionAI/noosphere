import { expect, test } from "bun:test";
import { resolve } from "node:path";

// Keep API mocks in a child process so they cannot contaminate other suites.
for (const scenario of ["draft", "unexpected", "success"] as const) {
  test(`autopilot server action serializes ${scenario} without leaking server exceptions`, () => {
    const actionPath = resolve("apps/web/app/w/[workspaceSlug]/content/strategy/actions.ts");
    const source = `
      import { mock } from "bun:test";
      import assert from "node:assert/strict";
      class OutboundApiError extends Error { constructor(status, code, message) { super(message); this.status=status; this.code=code; } }
      const scenario=${JSON.stringify(scenario)};
      mock.module("@/lib/api", () => ({
        OutboundApiError,
        configureContentAutopilot: async () => {
          if (scenario === "draft") throw new OutboundApiError(409,"CONTENT_AUTOPILOT_ACTIVE_STRATEGY_REQUIRED","Publish an editorial strategy before enabling the autopilot");
          if (scenario === "unexpected") throw new Error("private infrastructure detail");
          return {enabled:true};
        },
        deriveEditorialStrategy: async()=>{}, publishEditorialStrategy:async()=>{}, updateContentBrandKit:async()=>{}
      }));
      const { configureAutopilotAction } = await import(${JSON.stringify(actionPath)});
      const result=await configureAutopilotAction("isolated",{enabled:true,localTime:"09:00",timezone:"Europe/Paris"});
      assert.equal(result.ok,scenario === "success");
      if(scenario === "draft") {
        assert.equal(result.code,"CONTENT_AUTOPILOT_ACTIVE_STRATEGY_REQUIRED");
        assert.match(result.message,/valider.*stratégie/i);
      }
      if(scenario === "unexpected") assert.equal(JSON.stringify(result).includes("private infrastructure detail"),false);
      console.log("PASS");
    `;
    const result = Bun.spawnSync([process.execPath, "--eval", source], { stdout: "pipe", stderr: "pipe" });
    expect({ code: result.exitCode, error: result.stderr.toString() }).toEqual({ code: 0, error: "" });
    expect(result.stdout.toString().trim()).toBe("PASS");
  });
}
