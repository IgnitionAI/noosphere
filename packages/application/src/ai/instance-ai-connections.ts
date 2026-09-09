import type { AiReasoningEffort, ModelGatewayErrorCode, ModelRoute } from "@outbound/application/ai/model-gateway";
import { ModelGatewayError } from "@outbound/application/ai/model-gateway";
import type { InstanceSetupRepository } from "@outbound/application/ai/instance-setup";

export const instanceAiProviders = ["openai-api", "anthropic", "openrouter", "openai-compatible"] as const;
export type InstanceAiProvider = (typeof instanceAiProviders)[number];
export interface InstanceAiModel {
  readonly model: string;
  readonly reasoningEffort: AiReasoningEffort;
  readonly status: "untested" | "testing" | "ready" | "failed";
  readonly testedAt: Date | null;
  readonly errorCode: ModelGatewayErrorCode | null;
}
export interface InstanceAiConnectionView {
  readonly id: string;
  readonly name: string;
  readonly provider: InstanceAiProvider;
  readonly baseUrl: string;
  readonly version: number;
  readonly secretConfigured: boolean;
  readonly models: readonly InstanceAiModel[];
}
export interface SaveInstanceAiConnection {
  readonly id?: string | undefined;
  readonly name: string;
  readonly provider: InstanceAiProvider;
  readonly apiKey?: string | undefined;
  readonly baseUrl?: string | undefined;
  readonly models: readonly { readonly model: string; readonly reasoningEffort: AiReasoningEffort }[];
}
export interface InstanceAiModelSelection { readonly connectionId: string; readonly model: string }
export interface InstanceAiTestLease extends InstanceAiModelSelection {
  readonly version: number;
  readonly testId: string;
  readonly reasoningEffort: AiReasoningEffort;
}
export interface InstanceAiConnectionsRepository {
  list(): Promise<readonly InstanceAiConnectionView[]>;
  save(input: SaveInstanceAiConnection): Promise<InstanceAiConnectionView>;
  beginTest(input: InstanceAiModelSelection): Promise<InstanceAiTestLease>;
  finishTest(input: InstanceAiTestLease & { errorCode: ModelGatewayErrorCode | null }): Promise<boolean>;
  setDefault(input: InstanceAiModelSelection): Promise<boolean>;
  getDefault(): Promise<(ModelRoute & { connectionId: string }) | null>;
}
export interface InstanceAiConnectionTester { test(input: InstanceAiTestLease): Promise<void> }
export class InstanceAiError extends Error {
  constructor(readonly code: string) { super(code); }
}

export class InstanceAiConnectionsApplication {
  constructor(
    private readonly administrators: Pick<InstanceSetupRepository, "isAdministrator">,
    private readonly repository: InstanceAiConnectionsRepository,
    private readonly tester: InstanceAiConnectionTester,
  ) {}
  private async requireAdministrator(userId: string): Promise<void> {
    if (!await this.administrators.isAdministrator(userId)) throw new InstanceAiError("INSTANCE_ADMIN_REQUIRED");
  }
  async list(userId: string) {
    await this.requireAdministrator(userId);
    const [connections, defaultModel] = await Promise.all([this.repository.list(), this.repository.getDefault()]);
    return { connections, defaultModel };
  }
  async save(userId: string, input: SaveInstanceAiConnection) {
    await this.requireAdministrator(userId);
    return this.repository.save(input);
  }
  async test(userId: string, input: InstanceAiModelSelection) {
    await this.requireAdministrator(userId);
    const lease = await this.repository.beginTest(input);
    let errorCode: ModelGatewayErrorCode | null = null;
    try { await this.tester.test(lease); }
    catch (error) {
      errorCode = error instanceof ModelGatewayError ? error.code : "AI_PROVIDER_UNAVAILABLE";
    }
    if (!await this.repository.finishTest({ ...lease, errorCode })) throw new InstanceAiError("AI_CONNECTION_CHANGED");
    return { ...input, status: errorCode ? "failed" as const : "ready" as const, errorCode };
  }
  async setDefault(userId: string, input: InstanceAiModelSelection) {
    await this.requireAdministrator(userId);
    if (!await this.repository.setDefault(input)) throw new InstanceAiError("AI_CONNECTION_NOT_VALIDATED");
    return this.repository.getDefault();
  }
}
