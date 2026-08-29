/**
 * Explicit, transport-neutral application capabilities exposed by the runtime.
 *
 * Adapter code receives these wrappers instead of application instances. This
 * prevents accidental access to private repositories, database clients or
 * provider adapters while keeping the application boundary strongly typed.
 */
export interface ProductResearchRuntimeCapability {
  readonly get: (input: { readonly workspaceId: string; readonly runId: string }) => Promise<unknown>;
  readonly list: (input: { readonly workspaceId: string; readonly limit: number }) => Promise<unknown>;
}

export interface CrmRuntimeCapability {
  readonly productResearch: ProductResearchRuntimeCapability;
}

import type { ProspectMemoryCapability } from "@outbound/domain/prospect-memory/prospect-memory";
import type { ProspectMemoryPrincipalRole } from "@outbound/application/prospect-memory/prospect-memory";
import type { McpReadCapabilities } from "@outbound/application/mcp/mcp-read-capabilities";
import type { McpWriteCapabilities } from "@outbound/application/mcp/mcp-write-capabilities";
import type { McpGovernedEffectCapabilities } from "@outbound/application/mcp/mcp-governed-effects";

export interface ProspectMemoryRuntimeCapability {
  readonly status: (workspaceId: string, contactId: string) => Promise<unknown>;
  readonly view: (input: {
    readonly workspaceId: string;
    readonly contactId: string;
    readonly capability: ProspectMemoryCapability;
    readonly principalRole: ProspectMemoryPrincipalRole;
    readonly requestKey: string;
  }) => Promise<unknown>;
}

export interface ProspectMemoryGroupCapability {
  readonly operations: ProspectMemoryRuntimeCapability;
}

export interface ContentIdeasRuntimeCapability {
  readonly list: (input: { readonly workspaceId: string; readonly cursor?: string; readonly limit: number }) => Promise<unknown>;
}

export interface ContentStrategiesRuntimeCapability {
  readonly find: (workspaceId: string) => Promise<unknown>;
}

export interface ContentGenerationRuntimeCapability {
  readonly findRun: (input: { readonly workspaceId: string; readonly runId: string }) => Promise<unknown>;
  readonly findIdea: (input: { readonly workspaceId: string; readonly ideaId: string }) => Promise<unknown>;
  readonly findAssetByIdea: (input: { readonly workspaceId: string; readonly ideaId: string }) => Promise<unknown>;
}

export interface ContentPublicationRuntimeCapability {
  readonly list: (input: { readonly workspaceId: string; readonly cursor?: string; readonly limit: number }) => Promise<unknown>;
  readonly find: (input: { readonly workspaceId: string; readonly publicationId: string }) => Promise<unknown>;
}

export interface SocialContentRuntimeCapability {
  readonly list: (input: { readonly workspaceId: string; readonly cursor?: string; readonly limit: number }) => Promise<unknown>;
  readonly status: (input: { readonly workspaceId: string }) => Promise<unknown>;
}

export interface SocialEngagementRuntimeCapability {
  readonly list: (input: { readonly workspaceId: string; readonly cursor?: string; readonly limit: number }) => Promise<unknown>;
  readonly status: (input: { readonly workspaceId: string }) => Promise<unknown>;
}

export interface AttributionRuntimeCapability {
  readonly listJourneys: (input: { readonly workspaceId: string; readonly cursor?: string; readonly limit: number }) => Promise<unknown>;
}

export interface ContentRuntimeCapability {
  readonly strategies: ContentStrategiesRuntimeCapability;
  readonly ideas: ContentIdeasRuntimeCapability;
  readonly generation: ContentGenerationRuntimeCapability;
  readonly publications: ContentPublicationRuntimeCapability;
  readonly socialContent: SocialContentRuntimeCapability;
  readonly socialEngagement: SocialEngagementRuntimeCapability;
  readonly attribution: AttributionRuntimeCapability;
}

export interface EmptyRuntimeCapability {
  readonly available: false;
}

export interface OperationsRuntimeCapability {
  readonly contentPerformance: {
    readonly get: (workspaceId: string) => Promise<unknown>;
  };
}

export interface RuntimeCapabilities {
  /** Optional read surface consumed by the MCP adapter; absent in minimal test runtimes. */
  readonly mcpRead?: McpReadCapabilities;
  readonly mcpWrite?: McpWriteCapabilities;
  /** Optional provider-free governed-effect surface, registered per request. */
  readonly mcpGovernedEffects?: McpGovernedEffectCapabilities;
  readonly crm: CrmRuntimeCapability;
  readonly prospectMemory: ProspectMemoryGroupCapability;
  readonly pipeline: EmptyRuntimeCapability;
  readonly campaigns: EmptyRuntimeCapability;
  readonly conversations: EmptyRuntimeCapability;
  readonly content: ContentRuntimeCapability;
  readonly approvals: EmptyRuntimeCapability;
  readonly operations: OperationsRuntimeCapability;
  readonly knowledge: EmptyRuntimeCapability;
}

/** Deep-freeze all capability groups, wrappers and nested values. */
export function freezeRuntimeCapabilities(value: RuntimeCapabilities): RuntimeCapabilities {
  return deepFreeze(value);
}

function deepFreeze<T>(value: T): T {
  if ((typeof value !== "object" || value === null) && typeof value !== "function") return value;
  const objectValue = value as unknown as Record<PropertyKey, unknown>;
  for (const key of Reflect.ownKeys(objectValue)) {
    const child = objectValue[key];
    if (child !== value) deepFreeze(child);
  }
  return Object.freeze(value);
}
