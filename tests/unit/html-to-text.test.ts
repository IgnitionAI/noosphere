import { describe, expect, test } from "bun:test";
import { htmlToText } from "@outbound/infrastructure/inbox/html-to-text";

describe("inbox HTML to text", () => {
  test("keeps readable structure while discarding executable elements", () => {
    expect(htmlToText("<p>Bonjour<br>Salim</p><script>alert('x')</script><p>Suite</p>"))
      .toBe("Bonjour\nSalim\nSuite");
  });

  test("decodes entities once without turning encoded markup into HTML", () => {
    expect(htmlToText("&amp;lt;script&amp;gt;preuve&amp;lt;/script&amp;gt;"))
      .toBe("&lt;script&gt;preuve&lt;/script&gt;");
  });

  test("fails closed on malformed executable markup", () => {
    expect(htmlToText("<script>danger</script ><p>visible</p>"))
      .toBeNull();
  });
});
