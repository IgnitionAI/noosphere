import { expect, test } from "bun:test";
import journal from "../../packages/infrastructure/migrations/meta/_journal.json";

test("migration journal timestamps advance so existing installations apply every later migration", () => {
  for (let index = 1; index < journal.entries.length; index++) {
    expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
  }
});
