import type { InstanceAiConnectionTester, InstanceAiTestLease } from "@outbound/application/ai/instance-ai-connections";
import { ModelGatewayError } from "@outbound/application/ai/model-gateway";
import type { InstanceAiCredentialReader } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { OpenAiResponsesModelGateway, type OpenAiModelGatewayOptions } from "@outbound/infrastructure/ai/openai-model-gateway";

export class InstanceModelConnectionTester implements InstanceAiConnectionTester {
  constructor(private readonly credentials: InstanceAiCredentialReader, private readonly fetcher?: OpenAiModelGatewayOptions["fetcher"]) {}
  async test(input: InstanceAiTestLease): Promise<void> {
    const credential = await this.credentials.getCredential(input.connectionId, input.version);
    if (!credential) throw new ModelGatewayError("AI_PROVIDER_UNAVAILABLE", "openai-api", "AI_CONNECTION_CHANGED", false, false);
    const gateway = new OpenAiResponsesModelGateway({ apiKey: credential.apiKey, baseUrl: credential.baseUrl, maxOutputTokens: 1024, ...(this.fetcher ? { fetcher: this.fetcher } : {}) });
    await gateway.invokeStructured({
      workspaceId: "instance-setup", capability: "icp_research", requestKey: input.testId,
      model: input.model, reasoningEffort: input.reasoningEffort,
      systemPrompt: "Call the connection_probe function with ok set to true. This is a short connection test; do not produce any other content.", input: {},
      outputName: "connection_probe", outputDescription: "Validate the structured function output required by Noosphere research.",
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      parse(value) { if (typeof value !== "object" || value === null || !("ok" in value) || value.ok !== true) throw new Error("INVALID_CONNECTION_PROBE"); return { ok: true }; },
      deadlineAt: new Date(Date.now() + 30_000),
    });
  }
}
