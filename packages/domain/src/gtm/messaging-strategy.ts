export type MessagingChannel = "linkedin" | "email" | "whatsapp";

/** Variables are references only; their values are resolved at send time. */
export const ALLOWED_MESSAGING_TEMPLATE_VARIABLES = new Set([
  "contact.first_name",
  "contact.last_name",
  "contact.title",
  "contact.email",
  "company.name",
  "company.industry",
  "sender.first_name",
  "sender.last_name",
  "offer.name",
  "icp.name",
]);

const TEMPLATE_VARIABLE_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_.]*)\s*\}\}/g;

export interface TemplateVariableValidation {
  readonly valid: boolean;
  readonly unknownVariables: readonly string[];
}

export function findUnknownTemplateVariables(template: string): readonly string[] {
  const unknown: string[] = [];
  for (const match of template.matchAll(TEMPLATE_VARIABLE_PATTERN)) {
    const variable = match[1]!;
    if (!ALLOWED_MESSAGING_TEMPLATE_VARIABLES.has(variable)) unknown.push(variable);
  }
  return unknown;
}

export function validateMessagingTemplateVariables(template: string): TemplateVariableValidation {
  const unknownVariables = findUnknownTemplateVariables(template);
  return { valid: unknownVariables.length === 0, unknownVariables };
}

/** Short alias for callers validating a single template field. */
export const validateTemplateVariables = validateMessagingTemplateVariables;

export interface MessagingTemplate {
  readonly channel: MessagingChannel;
  readonly body: string;
  readonly subject?: string | undefined;
  readonly maxLength?: number | undefined;
  readonly cta?: string | undefined;
  readonly constraints?: Readonly<Record<string, unknown>> | undefined;
}

export interface MessagingStrategyRules {
  readonly tone: string;
  readonly angle: string;
  readonly templates: readonly MessagingTemplate[];
  readonly allowedClaimIds: readonly string[];
  readonly offerVersionId?: string | undefined;
  readonly constraints?: Readonly<Record<string, unknown>> | undefined;
}

export interface MessagingStrategyVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly strategyId: string;
  readonly version: number;
  readonly rules: MessagingStrategyRules;
  readonly publishedBy: string | null;
  readonly publishedAt: Date;
}

export interface MessagingStrategy {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly deletedAt: Date | null;
}

export interface AIPolicyRules {
  /** When true, the first contact is held for a human; false enables autopilot. */
  readonly firstContactRequiresHumanApproval?: boolean | undefined;
  /** When true, every response is held for a human; false enables autopilot. */
  readonly responsesRequireHumanApproval?: boolean | undefined;
  /** Whether follow-ups may be sent without an approval queue. */
  readonly followUpsMayBeAutomated: boolean;
  readonly escalationRules?: Readonly<Record<string, unknown>> | undefined;
}

export interface AIPolicyVersion {
  readonly id: string;
  readonly workspaceId: string;
  readonly policyId: string;
  readonly version: number;
  readonly rules: AIPolicyRules;
  readonly publishedBy: string | null;
  readonly publishedAt: Date;
}

export interface AIPolicy {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly currentVersion: number;
  readonly deletedAt: Date | null;
}

export interface MessagingStrategyValidationError {
  readonly code: "UNKNOWN_TEMPLATE_VARIABLE" | "CHANNEL_INCOMPLETE" | "TEMPLATE_REQUIRED";
  readonly path: string;
  readonly message: string;
  readonly variables?: readonly string[];
}

export class MessagingStrategyInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MessagingStrategyInvariantError";
  }
}

export function validateMessagingStrategy(
  rules: MessagingStrategyRules,
): readonly MessagingStrategyValidationError[] {
  const errors: MessagingStrategyValidationError[] = [];
  if (!rules.templates.length) {
    errors.push({ code: "TEMPLATE_REQUIRED", path: "templates", message: "At least one channel template is required" });
  }
  rules.templates.forEach((template, index) => {
    const path = `templates[${index}]`;
    const unknownVariables = findUnknownTemplateVariables(
      [template.subject ?? "", template.body, template.cta ?? ""].join("\n"),
    );
    if (unknownVariables.length) {
      errors.push({
        code: "UNKNOWN_TEMPLATE_VARIABLE",
        path,
        message: `Unknown template variable(s): ${unknownVariables.map((variable) => `{{${variable}}}`).join(", ")}`,
        variables: unknownVariables,
      });
    }
    if (!template.body.trim() || template.maxLength === undefined || !template.cta?.trim()) {
      errors.push({
        code: "CHANNEL_INCOMPLETE",
        path,
        message: "A channel template requires body, maxLength and CTA",
      });
    }
  });
  return errors;
}

export function assertHumanSupervisionPolicy(rules: AIPolicyRules): void {
  // The policy is intentionally allowed to be fully autonomous. Keep this
  // validator as the single boundary for callers that still use the legacy
  // name, but only reject malformed values rather than forcing supervision.
  if (rules.firstContactRequiresHumanApproval !== undefined && typeof rules.firstContactRequiresHumanApproval !== "boolean") {
    throw new MessagingStrategyInvariantError("firstContactRequiresHumanApproval must be a boolean");
  }
  if (rules.responsesRequireHumanApproval !== undefined && typeof rules.responsesRequireHumanApproval !== "boolean") {
    throw new MessagingStrategyInvariantError("responsesRequireHumanApproval must be a boolean");
  }
  if (typeof rules.followUpsMayBeAutomated !== "boolean") {
    throw new MessagingStrategyInvariantError("followUpsMayBeAutomated must be a boolean");
  }
}

export function validateAIPolicyRules(rules: AIPolicyRules): readonly string[] {
  const errors: string[] = [];
  if (rules.firstContactRequiresHumanApproval !== undefined && typeof rules.firstContactRequiresHumanApproval !== "boolean") {
    errors.push("firstContactRequiresHumanApproval");
  }
  if (rules.responsesRequireHumanApproval !== undefined && typeof rules.responsesRequireHumanApproval !== "boolean") {
    errors.push("responsesRequireHumanApproval");
  }
  if (typeof rules.followUpsMayBeAutomated !== "boolean") errors.push("followUpsMayBeAutomated");
  return errors;
}
