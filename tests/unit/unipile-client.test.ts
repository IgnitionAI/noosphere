import { describe, expect, test } from "bun:test";
import { hostedAuthProviders, mapSnapshot } from "@outbound/infrastructure/integrations/unipile-client";

describe("Unipile hosted authentication", () => {
  test("maps each outbound channel to providers accepted by Hosted Auth V1", () => {
    expect(hostedAuthProviders("linkedin")).toEqual(["LINKEDIN"]);
    expect(hostedAuthProviders("whatsapp")).toEqual(["WHATSAPP"]);
    expect(hostedAuthProviders("email")).toEqual(["GOOGLE", "OUTLOOK", "MAIL"]);
  });

  test("maps a connected LinkedIn account from Unipile source status", () => {
    const snapshot = mapSnapshot("linkedin-account", {
      type: "LINKEDIN",
      name: "Owner LinkedIn",
      sources: [{ id: "linkedin-account_MESSAGING", status: "OK" }],
    });

    expect(snapshot.status).toBe("connected");
    expect(snapshot.capabilities).toEqual({ linkedin: { sending: true } });
  });

  test("maps Google OAuth mail and calendar sources as email capabilities", () => {
    const snapshot = mapSnapshot("google-account", {
      type: "GOOGLE_OAUTH",
      name: "owner@example.com",
      sources: [
        { id: "google-account_MAILS", status: "OK" },
        { id: "google-account_CALENDAR", status: "OK" },
      ],
    });

    expect(snapshot.status).toBe("connected");
    expect(snapshot.capabilities).toEqual({
      email: { sending: true, receiving: true },
      calendar: { booking: true },
    });
  });
});
