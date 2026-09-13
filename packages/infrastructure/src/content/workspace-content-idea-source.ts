import { ContentIdeaSourceDeadlineError, type ContentIdeaSourceDiscovery, type ContentIdeaSourceRequest } from "@outbound/application/content/content-ideas";
import { AiTaskPauseError, requiresManualAiResume } from "@outbound/application/ai/ai-task-pause";
import { ModelGatewayError } from "@outbound/application/ai/model-gateway";
import type { AiRunRecorder } from "@outbound/application/ai/ai-run-recorder";
import { routesForCapability, type WorkspaceAiModelPolicyReader } from "@outbound/application/workspaces/workspace-ai-settings";
import type { CrawlerClient } from "@outbound/infrastructure/ai/crawler-client";
import { CodexNativeWebSearch } from "@outbound/infrastructure/ai/codex-native-web-search";
import { instanceCodexHome } from "@outbound/infrastructure/ai/instance-codex-home";
import type { PostgresInstanceAiConnectionsRepository } from "@outbound/infrastructure/ai/postgres-instance-ai-connections-repository";
import { CrawlerContentIdeaSource } from "@outbound/infrastructure/content/crawler-content-idea-source";

type NativeFactory = (options: { codexHome: string; binaryPath?: string }) => Pick<CodexNativeWebSearch, "search">;

/** Resolves the same content-idea policy as generation, including task-scoped choices. */
export class WorkspaceContentIdeaSource implements ContentIdeaSourceDiscovery {
  constructor(
    private readonly crawler: Pick<CrawlerClient, "search" | "readPages">,
    private readonly policies: WorkspaceAiModelPolicyReader,
    private readonly connections: Pick<PostgresInstanceAiConnectionsRepository, "getReadyRoute">,
    private readonly recorder: AiRunRecorder,
    private readonly environment: Readonly<Record<string, string | undefined>> = process.env,
    private readonly nativeFactory: NativeFactory = options => new CodexNativeWebSearch(options),
  ) {}

  async search(input: ContentIdeaSourceRequest) {
    if (input.limit < 1) return [];
    if (Date.now() >= input.deadlineAt.getTime()) throw new ContentIdeaSourceDeadlineError();
    const routes = routesForCapability(await this.policies.find(input.workspaceId), "content_idea", []);
    const route = routes[0];
    if (route?.provider !== "codex-cli" || !route.connectionId) return new CrawlerContentIdeaSource(this.crawler).search(input);
    const ready = route.connectionId ? await this.connections.getReadyRoute({ connectionId: route.connectionId, model: route.model }) : null;
    if (!ready || ready.provider !== route.provider || (route.connectionVersion && ready.connectionVersion !== route.connectionVersion)) {
      throw new AiTaskPauseError(new ModelGatewayError("AI_PROVIDER_UNAVAILABLE", "codex-cli", "AI_CONNECTION_NOT_VALIDATED", true, false), "content_idea", input.correlationId, routes);
    }
    const native = this.nativeFactory({ codexHome: instanceCodexHome(this.environment, ready.connectionId), ...(this.environment.CODEX_BINARY_PATH ? { binaryPath: this.environment.CODEX_BINARY_PATH } : {}) });
    const started = performance.now();
    const log = { workspaceId: input.workspaceId, purpose: "content_source_discovery", provider: route.provider, model: route.model,
      promptVersion: "noosphere-native-source-discovery-v2", shadow: false, cost: null,
      inputHash: new Bun.CryptoHasher("sha256").update(JSON.stringify({ query: input.query, limit: input.limit })).digest("hex") };
    const invocation = { correlationId: input.correlationId, connectionId: ready.connectionId, connectionVersion: ready.connectionVersion };
    let discovered;
    try {
      discovered = await native.search({ query: input.query, limit: Math.min(8, input.limit), model: route.model, reasoningEffort: route.reasoningEffort,
        deadlineAt: new Date(Math.min(input.deadlineAt.getTime(), Date.now() + 60_000)) });
    } catch (error) {
      await this.recorder.record({ ...log, status: "failed", output: { ...invocation, code: error instanceof ModelGatewayError ? error.code : "CONTENT_NATIVE_SEARCH_FAILED" }, latencyMs: Math.round(performance.now()-started) });
      if (Date.now() >= input.deadlineAt.getTime()) throw new ContentIdeaSourceDeadlineError();
      if (requiresManualAiResume(error)) throw new AiTaskPauseError(error, "content_idea", input.correlationId, [route]);
      throw error;
    }
    await this.recorder.record({ ...log, status: "completed", output: { ...invocation, results: discovered.results, metadata: discovered.metadata }, latencyMs: discovered.metadata.latencyMs });
    return new CrawlerContentIdeaSource({
      search: async () => discovered.results.map(item => ({ ...item, description: "", provider: "codex-native-web" })),
      readPages: request => this.crawler.readPages(request),
    }).search(input);
  }
}
