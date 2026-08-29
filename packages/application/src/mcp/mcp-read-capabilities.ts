export type McpReadRole = "viewer" | "operator" | "reviewer" | "admin" | "owner";
export type McpReadScope = "mcp:read" | "mcp:write";
import type { McpOperationView } from "./mcp-durable-operations";

/** Identity supplied by the MCP OAuth resource server for one request. */
export interface McpExecutionContext {
  readonly userId: string;
  readonly workspaceId: string;
  readonly clientId: string;
  readonly role: McpReadRole;
  readonly scopes: readonly McpReadScope[];
  readonly audience: string;
}

export type McpReadValue =
  | null
  | boolean
  | number
  | string
  | readonly McpReadValue[]
  | { readonly [key: string]: McpReadValue };

export type McpReadPage = {
  readonly data: readonly McpReadValue[];
  readonly nextCursor: string | null;
} & { readonly [key: string]: McpReadValue };

export interface McpReadPagination {
  readonly cursor?: string | undefined;
  readonly limit: number;
}

export interface McpReadCapabilities {
  readonly workspace: {
    readonly getSummary: (context: McpExecutionContext, input: McpReadPagination) => Promise<McpReadValue>;
  };
  readonly crm: {
    readonly search: (
      context: McpExecutionContext,
      input: McpReadPagination & { readonly query?: string | undefined; readonly entity?: "company" | "contact" | undefined },
    ) => Promise<McpReadPage>;
    readonly getCompany: (context: McpExecutionContext, input: { readonly companyId: string }) => Promise<McpReadValue | null>;
  };
  readonly prospect: {
    readonly get360: (context: McpExecutionContext, input: { readonly contactId: string }) => Promise<McpReadValue | null>;
  };
  readonly pipeline: {
    readonly list: (context: McpExecutionContext, input: McpReadPagination) => Promise<McpReadPage>;
  };
  readonly opportunity: {
    readonly get: (context: McpExecutionContext, input: { readonly opportunityId: string }) => Promise<McpReadValue | null>;
  };
  readonly conversation: {
    readonly list: (
      context: McpExecutionContext,
      input: McpReadPagination & { readonly channel?: "linkedin" | "email" | "whatsapp" | undefined; readonly search?: string | undefined; readonly page?: number | undefined },
    ) => Promise<McpReadPage>;
  };
  readonly campaign: {
    readonly getStatus: (context: McpExecutionContext, input: { readonly campaignId: string }) => Promise<McpReadValue | null>;
  };
  readonly content: {
    readonly getCalendar: (
      context: McpExecutionContext,
      input: McpReadPagination & { readonly from?: string | undefined; readonly to?: string | undefined },
    ) => Promise<McpReadPage>;
  };
  readonly operations: {
    readonly getHealth: (context: McpExecutionContext) => Promise<McpReadValue>;
    readonly get: (context: McpExecutionContext, input: { readonly operationId: string }) => Promise<McpOperationView | null>;
  };
}

/** Freeze the capability graph so adapters cannot mutate process composition. */
export function createMcpReadCapabilities(value: McpReadCapabilities): McpReadCapabilities {
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
