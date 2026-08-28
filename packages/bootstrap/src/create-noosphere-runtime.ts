import type { NoosphereRuntime } from "@outbound/bootstrap/noosphere-runtime";
import {
  freezeRuntimeCapabilities,
  type RuntimeCapabilities,
} from "@outbound/bootstrap/runtime-capabilities";

export interface NoosphereRuntimeComposition {
  readonly capabilities?: RuntimeCapabilities;
  readonly dispatch?: (request: Request) => Response | Promise<Response>;
  readonly auth?: (request: Request) => Response | Promise<Response>;
  readonly health?: () => Promise<{ readonly status: "ready" | "not_ready" }>;
  readonly close?: () => Promise<void>;
  /** Reserved for process bootstrap callers; composition remains injectable in tests. */
  readonly env?: NodeJS.ProcessEnv;
  readonly port?: number;
}

/**
 * Build the process-scoped application runtime from already-composed ports.
 * The runtime owns no request, tenant, transcript or agent-session state; all
 * such values are resolved by the inbound adapter and passed to application
 * capabilities on demand.
 */
export function createNoosphereRuntime(input: NoosphereRuntimeComposition = {}): NoosphereRuntime {
  const capabilities = freezeRuntimeCapabilities(input.capabilities ?? emptyCapabilities());
  const dispatch = input.dispatch ?? (() => Response.json({ status: "not_found" }, { status: 404 }));
  const auth = input.auth ?? (() => Response.json({ status: "not_found" }, { status: 404 }));
  const health = input.health ?? (async () => ({ status: "ready" as const }));
  const closeDelegate = input.close ?? (async () => undefined);
  let closePromise: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closePromise ??= Promise.resolve().then(closeDelegate);
    return closePromise;
  };
  return Object.freeze({
    capabilities,
    handle: async (request: Request) => dispatch(request),
    handleAuth: async (request: Request) => auth(request),
    health,
    close,
  });
}

function emptyCapabilities(): RuntimeCapabilities {
  return {
    crm: { productResearch: { get: async () => undefined, list: async () => undefined } },
    prospectMemory: { operations: { status: async () => undefined, view: async () => undefined } },
    pipeline: { available: false },
    campaigns: { available: false },
    conversations: { available: false },
    content: {
      strategies: { find: async () => undefined },
      ideas: { list: async () => undefined },
      generation: { findRun: async () => undefined, findIdea: async () => undefined, findAssetByIdea: async () => undefined },
      publications: { list: async () => undefined, find: async () => undefined },
      socialContent: { list: async () => undefined, status: async () => undefined },
      socialEngagement: { list: async () => undefined, status: async () => undefined },
      attribution: { listJourneys: async () => undefined },
    },
    approvals: { available: false },
    operations: { contentPerformance: { get: async () => undefined } },
    knowledge: { available: false },
  };
}
