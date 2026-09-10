import { expect, test } from "bun:test";
import journal from "../../packages/infrastructure/migrations/meta/_journal.json";

test("migration journal timestamps advance so existing installations apply every later migration", () => {
  for (let index = 1; index < journal.entries.length; index++) {
    expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
  }
});

test("combined MCP and instance AI upgrades retain every migration in order", () => {
  expect(journal.entries.slice(107).map(entry => entry.tag)).toEqual([
    "0107_mcp_dynamic_client_registration",
    "0108_instance_ai_setup",
    "0109_instance_ai_connections",
    "0110_instance_codex_connections",
    "0111_task_ai_policy",
    "0112_paused_ai_jobs",
    "0113_ai_pause_capability",
    "0114_legacy_research_tiers",
    "0115_instance_ai_fallback",
    "0116_offer_draft_revision",
  ]);
  expect(journal.entries.map(entry => entry.idx)).toEqual(journal.entries.map((_, index) => index));
});
