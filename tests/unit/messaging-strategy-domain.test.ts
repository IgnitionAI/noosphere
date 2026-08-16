import { describe, expect, test } from "bun:test";
import {
  assertHumanSupervisionPolicy,
  findUnknownTemplateVariables,
  validateAIPolicyRules,
  validateMessagingStrategy,
  validateMessagingTemplateVariables,
} from "@outbound/domain/gtm/messaging-strategy";

describe("messaging strategy domain", () => {
  test("accepts the supported namespaced variables", () => {
    expect(findUnknownTemplateVariables(
      "Bonjour {{contact.first_name}}, {{company.name}} — {{sender.first_name}}",
    )).toEqual([]);
    expect(validateMessagingTemplateVariables("{{contact.first_name}}")).toEqual({
      valid: true,
      unknownVariables: [],
    });
  });

  test("lists every unknown variable occurrence", () => {
    expect(findUnknownTemplateVariables(
      "{{contact.titre}} {{contact.titre}} {{company.unknown}}",
    )).toEqual(["contact.titre", "contact.titre", "company.unknown"]);
  });

  test("reports unknown variables in all template fields", () => {
    const errors = validateMessagingStrategy({
      tone: "direct",
      angle: "value",
      allowedClaimIds: [],
      templates: [{
        channel: "email",
        subject: "{{company.unknown}}",
        body: "{{contact.titre}}",
        cta: "Répondre",
        maxLength: 5000,
      }],
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("UNKNOWN_TEMPLATE_VARIABLE");
    expect(errors[0]?.variables).toEqual(["company.unknown", "contact.titre"]);
  });

  test("allows autonomous first contacts, responses and follow-ups", () => {
    expect(validateAIPolicyRules({
      firstContactRequiresHumanApproval: false,
      responsesRequireHumanApproval: false,
      followUpsMayBeAutomated: true,
    })).toEqual([]);
    expect(() => assertHumanSupervisionPolicy({
      firstContactRequiresHumanApproval: false,
      responsesRequireHumanApproval: false,
      followUpsMayBeAutomated: true,
    })).not.toThrow();
    expect(() => assertHumanSupervisionPolicy({
      firstContactRequiresHumanApproval: "yes" as never,
      responsesRequireHumanApproval: false,
      followUpsMayBeAutomated: true,
    })).toThrow("firstContactRequiresHumanApproval must be a boolean");
  });
});
