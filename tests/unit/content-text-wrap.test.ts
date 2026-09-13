import { expect, test } from "bun:test";
import { wrapContentText } from "@outbound/infrastructure/content/content-text-wrap";

test("keeps French closing punctuation with the preceding word at a cover boundary", () => {
  for (const space of [" ", "\u00a0", "\u202f"]) {
    const title = `Capture ou création${space}?`;
    const lines = wrapContentText(title, 19, 5);
    expect(lines).toEqual(["Capture ou", "création ?"]);
    expect(lines.join(" ")).toBe(title.replace(/\s+/g, " "));
  }
  expect(wrapContentText("Choisir la méthode : pourquoi ?", 20, 5)).toEqual(["Choisir la méthode :", "pourquoi ?"]);
});

test("preserves complete overlong tokens for strict renderer rejection", () => {
  expect(wrapContentText("IdentificationLongue ?", 19, 5)).toEqual(["IdentificationLongue ?"]);
  expect(wrapContentText("Capture ou création ?", 19, 1)).toEqual(["Capture ou…"]);
});
