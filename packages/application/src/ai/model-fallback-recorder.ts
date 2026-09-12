import type { AiCapability, AiProviderId } from "./model-gateway";
export interface ModelFallbackObservation {
  readonly workspaceId: string;
  readonly requestKey: string;
  readonly capability: AiCapability;
  readonly primary: { readonly provider: AiProviderId; readonly model: string };
  readonly selected: { readonly provider: AiProviderId; readonly model: string };
  readonly reason: string;
}
export interface ModelFallbackRecorder { record(input: ModelFallbackObservation): Promise<void>; }
