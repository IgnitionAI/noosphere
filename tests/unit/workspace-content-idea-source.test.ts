import { expect, test } from "bun:test";
import { WorkspaceContentIdeaSource } from "@outbound/infrastructure/content/workspace-content-idea-source";
import { AiTaskPauseError } from "@outbound/application/ai/ai-task-pause";
import type { ModelRoute } from "@outbound/application/ai/model-gateway";
const route = { provider: "codex-cli" as const, model: "gpt-5.6-luna", reasoningEffort: "low" as const, connectionId: "76d3cd29-959e-40a2-98ed-0deb10963d8e", connectionVersion: 2 };
const request = { workspaceId: "workspace-a", query: "source query", limit: 2, correlationId: "query:1", deadlineAt: new Date(Date.now()+60000) };
const result = { results: [{ url: "https://example.com/source", title: "Search title" }], metadata: { ...route, transport: "codex-process" as const, latencyMs: 5, usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, source: "unknown" as const } } };
const policy = (selected: ModelRoute) => ({ async find(workspaceId: string) { expect(workspaceId).toBe(request.workspaceId); return { researchModels: [], synthesisModels: [], defaultRoutes: [selected] }; } });

test("uses the workspace route and reads actual pages before returning evidence", async () => {
 const recorded: unknown[]=[];
 const source=new WorkspaceContentIdeaSource({ async search(){throw new Error('must not use searx');}, async readPages(input){expect(input.urls).toEqual([result.results[0]!.url]);return [{url:input.urls[0]!,title:'Read title',markdown:'Verified source text',metadata:{}}];}},
 policy(route), {async getReadyRoute(input){expect(input).toEqual({connectionId:route.connectionId,model:route.model});return route;}},
 {async record(input){recorded.push(input);return {id:'audit'};}}, {INSTANCE_CODEX_HOME:'/tmp/instance'}, options=>{
 expect(options.codexHome).toBe(`/tmp/instance/${route.connectionId}`);
 return {async search(input){expect(input.model).toBe(route.model);expect(input.reasoningEffort).toBe('low');expect(input.deadlineAt.getTime()).toBeLessThanOrEqual(request.deadlineAt.getTime());return result;}};
 });
 expect((await source.search(request))[0]).toMatchObject({title:'Read title',excerpt:'Verified source text'});
 expect(recorded[0]).toMatchObject({workspaceId:request.workspaceId,purpose:'content_source_discovery',status:'completed',output:{correlationId:request.correlationId,connectionId:route.connectionId,connectionVersion:route.connectionVersion}});
});

test("an unavailable or changed connection pauses before any model or crawler call", async () => {
 for(const ready of [null,{...route,connectionVersion:3}]) {
 const source=new WorkspaceContentIdeaSource({async search(){throw new Error('must not search');},async readPages(){throw new Error('must not read');}},policy(route),{async getReadyRoute(){return ready;}},{async record(){throw new Error('must not record a model invocation');}},{INSTANCE_CODEX_HOME:'/tmp/instance'},()=>{throw new Error('must not construct model');});
 await expect(source.search(request)).rejects.toBeInstanceOf(AiTaskPauseError);
 }
});

test("non-Codex and legacy routes retain the configured crawler", async () => {
 for(const selected of [{provider:'openai-api' as const,model:'configured',reasoningEffort:'low' as const},{provider:'codex-cli' as const,model:'legacy',reasoningEffort:'low' as const}]) {
 let searched=false;
 const source=new WorkspaceContentIdeaSource({async search(){searched=true;return [];},async readPages(){throw new Error('must not read');}},policy(selected),{async getReadyRoute(){throw new Error('must not access instance connection');}},{async record(){throw new Error('no model invoked');}},{},()=>{throw new Error('must not use native');});
 expect(await source.search(request)).toEqual([]);expect(searched).toBe(true);
 }
});

test("records native failure without promoting model text or hiding it as empty success", async () => {
 const recorded: unknown[]=[];
 const failure=new Error('CODEX_WEB_SEARCH_NOT_EXECUTED');
 const source=new WorkspaceContentIdeaSource({async search(){throw new Error('no implicit fallback');},async readPages(){throw new Error('must not read');}},policy(route),{async getReadyRoute(){return route;}},{async record(input){recorded.push(input);return{id:'audit'};}},{INSTANCE_CODEX_HOME:'/tmp/instance'},()=>({async search(){throw failure;}}));
 await expect(source.search(request)).rejects.toBe(failure);
 expect(recorded[0]).toMatchObject({status:'failed',output:{code:'CONTENT_NATIVE_SEARCH_FAILED'}});
});

test("provider quota errors pause the job and record only the safe error code", async () => {
 const { ModelGatewayError } = await import('@outbound/application/ai/model-gateway');
 const recorded: unknown[]=[];
 const source=new WorkspaceContentIdeaSource({async search(){throw new Error('must not search');},async readPages(){throw new Error('must not read');}},policy(route),{async getReadyRoute(){return route;}},{async record(input){recorded.push(input);return{id:'audit'};}},{INSTANCE_CODEX_HOME:'/tmp/instance'},()=>({async search(){throw new ModelGatewayError('AI_PROVIDER_QUOTA_EXHAUSTED','codex-cli','private provider detail',true,false);}}));
 await expect(source.search(request)).rejects.toBeInstanceOf(AiTaskPauseError);
 expect(recorded[0]).toMatchObject({status:'failed',output:{code:'AI_PROVIDER_QUOTA_EXHAUSTED',correlationId:request.correlationId,connectionId:route.connectionId,connectionVersion:route.connectionVersion}});
 expect(JSON.stringify(recorded)).not.toContain('private provider detail');
});
