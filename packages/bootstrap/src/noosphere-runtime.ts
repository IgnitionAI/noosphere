import type { RuntimeCapabilities } from "@outbound/bootstrap/runtime-capabilities";

export interface NoosphereRuntime {
  readonly capabilities: RuntimeCapabilities;
  readonly handle: (request: Request) => Promise<Response>;
  readonly handleAuth: (request: Request) => Promise<Response>;
  readonly health: () => Promise<{ readonly status: "ready" | "not_ready" }>;
  readonly close: () => Promise<void>;
}
