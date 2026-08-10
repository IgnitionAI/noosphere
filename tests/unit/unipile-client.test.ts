import { describe, expect, test } from "bun:test";
import { hostedAuthProviders } from "@outbound/infrastructure/integrations/unipile-client";

describe("Unipile hosted authentication", () => {
  test("maps each outbound channel to providers accepted by Hosted Auth V1", () => {
    expect(hostedAuthProviders("linkedin")).toEqual(["LINKEDIN"]);
    expect(hostedAuthProviders("whatsapp")).toEqual(["WHATSAPP"]);
    expect(hostedAuthProviders("email")).toEqual(["GOOGLE", "OUTLOOK", "MAIL"]);
  });
});
