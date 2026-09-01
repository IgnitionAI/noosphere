import type {
  ExternalEffectFacts,
  ExternalEffectFactsReader,
  ExternalEffectPrepareFactsReaderInput,
} from "@outbound/application/mcp/external-effect-policy";
import type {
  ExternalEffectPolicy,
  McpEffectProposal,
  McpEffectStatusView,
  McpGovernedEffectCapabilities,
  McpGovernedEffectKind,
  McpPrepareCommand,
  McpGovernedEffectStatus,
  McpExecutionContext,
} from "@outbound/application/mcp/mcp-governed-effects";
import type {
  CreateProposalInput,
  DecideAndQueueInput,
  McpEffectDecisionRecord,
  McpEffectProposalRecord,
  PostgresMcpGovernedEffectRepository,
} from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";
import { deriveMcpEffectInputHash } from "@outbound/infrastructure/mcp/postgres-mcp-governed-effect-repository";

interface GovernedEffectRepository {
  createProposal(input: CreateProposalInput): Promise<McpEffectProposalRecord>;
  listStatus(input: {
    readonly workspaceId: string;
    readonly status?: McpGovernedEffectStatus;
    readonly limit: number;
    readonly role?: string;
  }): Promise<readonly McpEffectDecisionRecord[]>;
  getStatus(input: {
    readonly workspaceId: string;
    readonly proposalId?: string;
    readonly approvalItemId?: string;
    readonly role?: string;
  }): Promise<McpEffectDecisionRecord | null>;
  decideAndQueue(input: DecideAndQueueInput): Promise<McpEffectDecisionRecord>;
}

type PrepareFactsReader = ExternalEffectFactsReader & {
  readonly readPrepare?: (input: ExternalEffectPrepareFactsReaderInput) => Promise<unknown>;
};

export class McpGovernedEffectCapabilitiesError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "McpGovernedEffectCapabilitiesError";
  }
}

/**
 * Provider-free production composition for the MCP governed-effect port.
 * Every prepare reads workspace-owned facts and persists a proposal; only the
 * repository's decideAndQueue operation can create execution artifacts.
 */
export class PostgresMcpGovernedEffectCapabilities implements McpGovernedEffectCapabilities {
  private readonly repository: GovernedEffectRepository;
  private readonly factsReader: PrepareFactsReader;
  private readonly policy: ExternalEffectPolicy;
  private readonly now: () => Date;

  constructor(
    repository: PostgresMcpGovernedEffectRepository | GovernedEffectRepository,
    factsReader: PrepareFactsReader,
    policy: ExternalEffectPolicy,
    now: () => Date = () => new Date(),
  ) {
    this.repository = repository;
    this.factsReader = factsReader;
    this.policy = policy;
    this.now = now;
  }

  async prepare(context: McpExecutionContext, command: McpPrepareCommand): Promise<McpEffectProposal> {
    const descriptor = prepareDescriptor(command);
    const readPrepare = this.factsReader.readPrepare;
    if (!readPrepare) throw new McpGovernedEffectCapabilitiesError("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    let value: unknown;
    try {
      value = await readPrepare.call(this.factsReader, {
        context,
        kind: descriptor.kind,
        aggregateId: descriptor.aggregateId,
        intentSnapshot: descriptor.intentSnapshot,
      });
    } catch {
      throw new McpGovernedEffectCapabilitiesError("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    }
    const source = validateFacts(value);
    if (!source || source.kind !== descriptor.kind) throw new McpGovernedEffectCapabilitiesError("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    if (source.aggregateId !== descriptor.aggregateId) throw new McpGovernedEffectCapabilitiesError("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    if (command.expectedVersion !== undefined && command.expectedVersion !== source.revision) {
      throw new McpGovernedEffectCapabilitiesError("MCP_EFFECT_VERSION_CONFLICT");
    }
    if (descriptor.kind === "campaign_activation" && source.adapterAvailable !== true) {
      throw new McpGovernedEffectCapabilitiesError("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    }
    if (descriptor.kind === "meeting_proposal" && !offeredMeeting(source, this.now())) {
      throw new McpGovernedEffectCapabilitiesError("MCP_EFFECT_ADAPTER_UNAVAILABLE");
    }

    const aggregateId = authoritativeAggregateId(descriptor, source);
    const intentSnapshot = intentSnapshotFor(descriptor, source, aggregateId);
    const sourceSnapshot = source as unknown as Record<string, unknown>;
    const inputHash = deriveMcpEffectInputHash({
      kind: descriptor.kind,
      aggregateId,
      intentSnapshot,
      sourceSnapshot,
      revision: source.revision,
      sourceVersion: source.sourceVersion,
      factsVersion: source.factsVersion,
    });
    return this.repository.createProposal({
      context: { workspaceId: context.workspaceId, clientId: context.clientId },
      kind: descriptor.kind,
      requestKey: command.requestKey,
      inputHash,
      aggregateId,
      intentSnapshot,
      sourceSnapshot,
      revision: source.revision,
      sourceVersion: source.sourceVersion,
      factsVersion: source.factsVersion,
    });
  }

  async list(
    context: McpExecutionContext,
    input: { readonly status?: McpGovernedEffectStatus; readonly limit: number },
  ): Promise<readonly McpEffectStatusView[]> {
    return this.repository.listStatus({
      workspaceId: context.workspaceId,
      ...(input.status === undefined ? {} : { status: input.status }),
      limit: Math.min(100, Math.max(1, input.limit)),
      role: context.role,
    });
  }

  async status(
    context: McpExecutionContext,
    input: { readonly proposalId?: string; readonly approvalItemId?: string },
  ): Promise<McpEffectStatusView | null> {
    return this.repository.getStatus({
      workspaceId: context.workspaceId,
      ...(input.proposalId === undefined ? {} : { proposalId: input.proposalId }),
      ...(input.approvalItemId === undefined ? {} : { approvalItemId: input.approvalItemId }),
      role: context.role,
    });
  }

  async decide(
    context: McpExecutionContext,
    input: {
      readonly approvalItemId: string;
      readonly decision: "approve" | "reject";
      readonly justification?: string;
      readonly expectedVersion?: number;
    },
  ): Promise<McpEffectStatusView> {
    return this.repository.decideAndQueue({
      context,
      approvalItemId: input.approvalItemId,
      decision: input.decision,
      ...(input.justification === undefined ? {} : { justification: input.justification }),
      ...(input.expectedVersion === undefined ? {} : { expectedVersion: input.expectedVersion }),
      policy: this.policy,
    });
  }
}

export function createPostgresMcpGovernedEffectCapabilities(
  repository: PostgresMcpGovernedEffectRepository | GovernedEffectRepository,
  factsReader: PrepareFactsReader,
  policy: ExternalEffectPolicy,
  now?: () => Date,
): McpGovernedEffectCapabilities {
  return new PostgresMcpGovernedEffectCapabilities(repository, factsReader, policy, now);
}

export const createMcpGovernedEffectCapabilities = createPostgresMcpGovernedEffectCapabilities;

interface PrepareDescriptor {
  readonly kind: McpGovernedEffectKind;
  readonly aggregateId: string;
  readonly intentSnapshot: Record<string, unknown>;
}

function prepareDescriptor(command: McpPrepareCommand): PrepareDescriptor {
  switch (command.kind) {
    case "conversation_reply":
      return { kind: command.kind, aggregateId: command.conversationId, intentSnapshot: { kind: command.kind, aggregateId: command.conversationId, body: command.body } };
    case "content_publication":
      return { kind: command.kind, aggregateId: command.assetId, intentSnapshot: { kind: command.kind, aggregateId: command.assetId, assetId: command.assetId, ...(command.assetVersionId === undefined ? {} : { assetVersionId: command.assetVersionId }), ...(command.scheduledFor === undefined ? {} : { scheduledFor: command.scheduledFor }) } };
    case "meeting_proposal":
      return { kind: command.kind, aggregateId: command.meetingProposalId, intentSnapshot: { kind: command.kind, aggregateId: command.meetingProposalId, slotPosition: command.slotPosition } };
    case "campaign_activation":
      return { kind: command.kind, aggregateId: command.campaignId, intentSnapshot: { kind: command.kind, aggregateId: command.campaignId } };
  }
}

function authoritativeAggregateId(descriptor: PrepareDescriptor, source: ExternalEffectFacts): string {
  if (descriptor.kind === "content_publication" && source.kind === "content_publication" && typeof source.publicationId === "string" && source.publicationId.length > 0) return source.publicationId;
  return descriptor.aggregateId;
}

function intentSnapshotFor(descriptor: PrepareDescriptor, source: ExternalEffectFacts, aggregateId: string): Record<string, unknown> {
  if (descriptor.kind !== "meeting_proposal" || source.kind !== "meeting_proposal") return { ...descriptor.intentSnapshot, aggregateId };
  return {
    kind: descriptor.kind,
    aggregateId,
    slotPosition: source.slotPosition,
    slotStart: source.slotStart,
    slotEnd: source.slotEnd,
    timeZone: source.timeZone,
  };
}

function offeredMeeting(source: ExternalEffectFacts, now: Date): boolean {
  if (source.kind !== "meeting_proposal" || source.status !== "offered") return false;
  if (!Number.isSafeInteger(source.slotPosition) || source.slotPosition < 1 || source.slotPosition > 100) return false;
  if (typeof source.slotStart !== "string" || typeof source.slotEnd !== "string" || typeof source.timeZone !== "string") return false;
  if (typeof source.expiresAt !== "string" || Number.isNaN(Date.parse(source.expiresAt))) return false;
  return Date.parse(source.expiresAt) > now.getTime();
}

function validateFacts(value: unknown): ExternalEffectFacts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.kind !== "conversation_reply" && candidate.kind !== "content_publication" && candidate.kind !== "meeting_proposal" && candidate.kind !== "campaign_activation") return null;
  if (typeof candidate.aggregateId !== "string" || candidate.aggregateId.length < 1 || typeof candidate.revision !== "number" || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1 || typeof candidate.sourceVersion !== "number" || !Number.isSafeInteger(candidate.sourceVersion) || candidate.sourceVersion < 1 || typeof candidate.factsVersion !== "number" || !Number.isSafeInteger(candidate.factsVersion) || candidate.factsVersion < 1 || typeof candidate.adapterAvailable !== "boolean") return null;
  return value as ExternalEffectFacts;
}
