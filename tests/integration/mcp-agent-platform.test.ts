import { ResearchInboundPreparationProcessor } from "@outbound/infrastructure/content/research-inbound-preparation-runner";
import { PostgresJobQueue } from "@outbound/infrastructure/jobs/postgres-job-queue";
import { PostgresMcpOperationStore } from "@outbound/infrastructure/auth/postgres-mcp-operation-store";
import { McpTrackedJobLifecycle } from "@outbound/application/mcp/mcp-tracked-job-lifecycle";
import { EditorialStrategyApplication } from "@outbound/application/content/editorial-strategy";
import { PostgresEditorialStrategyRepository } from "@outbound/infrastructure/content/postgres-editorial-strategy-repository";
import type { EditorialStrategySnapshot } from "@outbound/domain/content/editorial-strategy";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createNoosphereApiRuntime, createMcpWriteCapabilities } from "@outbound/bootstrap/create-noosphere-api-runtime";
import { createMcpTransport } from "@outbound/interface/mcp/mcp-transport";
import { createDatabase } from "@outbound/infrastructure/database/client";
import { authUsers, mcpOauthClients, workspaceMembers, workspaces, offers, offerVersions, icps, icpVersions, campaigns, sequences } from "@outbound/infrastructure/database/schema";
import type { McpExecutionContext } from "@outbound/application/mcp/mcp-read-capabilities";

const url = process.env.TEST_DATABASE_URL;
(url ? describe : describe.skip)("Agent platform through MCP", () => {
 if (!url) return;
 const db = createDatabase(url);
 const workspaceId=crypto.randomUUID(), userId=crypto.randomUUID(), clientId=crypto.randomUUID();
 const context: McpExecutionContext={workspaceId,userId,clientId,role:"owner",scopes:["mcp:read","mcp:write"],audience:"https://mcp.example.test/mcp"};
 const runtime=createNoosphereApiRuntime({DATABASE_URL:url,BETTER_AUTH_URL:"https://mcp.example.test",BETTER_AUTH_SECRET:"synthetic-test-secret-with-thirty-two-characters",S3_ENDPOINT:"http://127.0.0.1:1",S3_BUCKET:"test",S3_ACCESS_KEY_ID:"fixture",S3_SECRET_ACCESS_KEY:"fixture"});
 const client=new Client({name:"agent-platform-test",version:"1.0.0"});
 beforeAll(async()=>{
  await migrate(db.db,{migrationsFolder:`${import.meta.dir}/../../packages/infrastructure/migrations`});
  await db.db.insert(workspaces).values({id:workspaceId,slug:workspaceId,name:"MCP Agent Test"});
  await db.db.insert(authUsers).values({id:userId,name:"Test",email:`${userId}@example.test`});
  await db.db.insert(workspaceMembers).values({workspaceId,userId,role:"owner",status:"active"});
  await db.db.insert(mcpOauthClients).values({clientId,clientName:"Agent test",redirectUris:[],userId,workspaceId,allowedScopes:["mcp:read","mcp:write"]});
  const server=createMcpTransport({capabilities:runtime.capabilities,allowedHosts:["mcp.example.test"],authorize:async()=>context});
  await client.connect(new StreamableHTTPClientTransport(new URL(context.audience),{fetch:async(input,init)=>server.handle(input instanceof Request?input:new Request(input,init))}));
 });
 afterAll(async()=>{await client.close();await runtime.close();await db.close();});
 test("rename brand preserves other fields, rejects stale edits and replays the same result",async()=>{
  const before=await client.callTool({name:"brand_get",arguments:{}});
  expect(before.isError).not.toBe(true);
  const original=before.structuredContent as {version:number;snapshot:Record<string,unknown>};
  const args={requestKey:crypto.randomUUID(),expectedVersion:original.version,patch:{brandName:"IgnitionAI"}};
  const result=await client.callTool({name:"brand_update",arguments:args});
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent).toMatchObject({version:1,state:"updated"});
  const after=await client.callTool({name:"brand_get",arguments:{}});
  expect(after.structuredContent).toMatchObject({version:1,snapshot:{...original.snapshot,brandName:"IgnitionAI"}});
  expect((await client.callTool({name:"brand_update",arguments:args})).structuredContent).toEqual(result.structuredContent);
  const stale=await client.callTool({name:"brand_update",arguments:{...args,requestKey:crypto.randomUUID(),patch:{brandName:"Stale name"}}});
  expect(stale.isError).toBe(true);
  expect(stale.structuredContent).toMatchObject({error:"MCP_WRITE_VERSION_CONFLICT"});
 });
 test("preparing Inbound explains missing offer instead of starting ungrounded generation",async()=>{
  const result=await client.callTool({name:"content_strategy_prepare",arguments:{requestKey:crypto.randomUUID()}});
  expect(result.isError).toBe(true);
  expect(result.structuredContent).toMatchObject({error:"EDITORIAL_STRATEGY_OFFER_REQUIRED"});
 });

 test("agent edits and publishes the reviewed strategy without a social publication",async()=>{
  const offerId=crypto.randomUUID(), offerVersionId=crypto.randomUUID(), icpId=crypto.randomUUID(), icpVersionId=crypto.randomUUID();
  await db.db.insert(offers).values({id:offerId,workspaceId,name:"Agent offer"});
  await db.db.insert(offerVersions).values({id:offerVersionId,workspaceId,offerId,version:1,name:"Agent offer",category:"service",valueProposition:"Acquisition structurée",targetAudience:"PME",publishedAt:new Date()});
  await db.db.insert(icps).values({id:icpId,workspaceId,name:"PME"});
  await db.db.insert(icpVersions).values({id:icpVersionId,workspaceId,icpId,version:1,name:"PME",confidence:"0.9000",criteria:{},buyingCommittee:[],problems:[],signals:[],exclusions:[],unknowns:[],unresolvedContradictions:[],blockedFindings:[],publishedAt:new Date()});
  const campaignId=crypto.randomUUID(), sequenceId=crypto.randomUUID();
  await db.db.insert(sequences).values({id:sequenceId,workspaceId,name:"Prepared sequence"});
  await db.db.insert(campaigns).values({id:campaignId,workspaceId,name:"Prepared Outbound",icpVersionId,sequenceId,channel:"linkedin",status:"draft"});
  const listed=(await client.callTool({name:"campaign_list",arguments:{}})).structuredContent as any;
  const campaign=listed.data.find((row:any)=>row.id===campaignId);
  const bind={requestKey:crypto.randomUUID(),campaignId,expectedUpdatedAt:campaign.updatedAt,offerVersionId};
  const linked=await client.callTool({name:"campaign_update",arguments:bind});
  expect(linked.isError).not.toBe(true);
  expect((await client.callTool({name:"campaign_update",arguments:bind})).structuredContent).toEqual(linked.structuredContent);
  const reread=(await client.callTool({name:"campaign_list",arguments:{}})).structuredContent as any;
  expect(reread.data.find((row:any)=>row.id===campaignId)).toMatchObject({offerVersionId,status:"draft"});
  const app=new EditorialStrategyApplication(new PostgresEditorialStrategyRepository(db.db),{generate:async()=>({snapshot:snapshot(),metadata:{provider:"test",model:"fixture",promptVersion:"test",aiRunId:null}})});
  await app.derive({workspaceId,userId,requestKey:crypto.randomUUID()});
  const read=await client.callTool({name:"content_strategy_get",arguments:{}});
  const strategy=(read.structuredContent as any).strategy;
  const draft={...strategy.draft,callsToAction:["Découvrir IgnitionAI"]};
  const edit=await client.callTool({name:"content_strategy_update",arguments:{requestKey:crypto.randomUUID(),strategyId:strategy.id,expectedUpdatedAt:strategy.updatedAt,snapshot:draft}});
  expect(edit.isError).not.toBe(true);
  const refreshed=(await client.callTool({name:"content_strategy_get",arguments:{}})).structuredContent as any;
  expect(refreshed.strategy.draft.callsToAction).toEqual(["Découvrir IgnitionAI"]);
  const stale=await client.callTool({name:"content_strategy_publish",arguments:{requestKey:crypto.randomUUID(),strategyId:strategy.id,expectedUpdatedAt:strategy.updatedAt}});
  expect(stale.isError).toBe(true);
  const args={requestKey:crypto.randomUUID(),strategyId:strategy.id,expectedUpdatedAt:refreshed.strategy.updatedAt};
  const published=await client.callTool({name:"content_strategy_publish",arguments:args});
  expect(published.isError).not.toBe(true);
  expect(published.structuredContent).toMatchObject({state:"published",version:1});
  expect((await client.callTool({name:"content_strategy_publish",arguments:args})).structuredContent).toEqual(published.structuredContent);
  const denied=await client.callTool({name:"content_strategy_prepare",arguments:{requestKey:crypto.randomUUID(),sources:{offerVersionId:crypto.randomUUID(),icpVersionId}}});
  expect(denied.structuredContent).toMatchObject({error:"EDITORIAL_STRATEGY_OFFER_REQUIRED"});
  const calendar=await client.callTool({name:"content_get_calendar",arguments:{}});
  expect(calendar.structuredContent).toMatchObject({data:[]});
 });

 test("read-only scopes cannot mutate brand and workspace selection cannot be supplied by an agent",async()=>{
  const server=createMcpTransport({capabilities:runtime.capabilities,allowedHosts:["mcp.example.test"],authorize:async()=>({...context,scopes:["mcp:read"]})});
  const viewer=new Client({name:"read-only",version:"1"});
  await viewer.connect(new StreamableHTTPClientTransport(new URL(context.audience),{fetch:async(input,init)=>server.handle(input instanceof Request?input:new Request(input,init))}));
  try {
   const result=await viewer.callTool({name:"brand_update",arguments:{requestKey:crypto.randomUUID(),expectedVersion:1,patch:{brandName:"Forbidden"}}});
   expect(result.isError).toBe(true);
   expect(result.structuredContent).toMatchObject({error:"WRITE_SCOPE_REQUIRED"});
   expect((await viewer.callTool({name:"brand_get",arguments:{workspaceId:crypto.randomUUID()}})).isError).toBe(true);
  }finally{await viewer.close();await server.close();}
 });

 test("queued Inbound generation survives a worker lease loss and MCP retries without duplicate generation",async()=>{
  const clock={now:()=>new Date()};
  const server=createMcpTransport({capabilities:{...runtime.capabilities,mcpWrite:createMcpWriteCapabilities(db.db,clock,()=>async()=>true)},allowedHosts:["mcp.example.test"],authorize:async()=>context});
  const writer=new Client({name:"queued-preparation",version:"1"});
  await writer.connect(new StreamableHTTPClientTransport(new URL(context.audience),{fetch:async(input,init)=>server.handle(input instanceof Request?input:new Request(input,init))}));
  try {
   const args={requestKey:crypto.randomUUID()};
   const requested=await writer.callTool({name:"content_strategy_prepare",arguments:args});
   expect(requested.isError).not.toBe(true);
   const result=requested.structuredContent as any;
   expect(result.state).toBe("queued");
   expect((await writer.callTool({name:"content_strategy_prepare",arguments:args})).structuredContent).toEqual(result);
   const queue=new PostgresJobQueue(db.client);
   const first=(await queue.lease({workerId:"lost-worker",types:["content.strategy.prepare"],limit:100,leaseMs:1,now:clock.now()})).find(job=>job.id===result.jobId)!;
   expect(first).toBeDefined();
   const retained=(await queue.lease({workerId:"replacement-worker",types:["content.strategy.prepare"],limit:100,leaseMs:60000,now:new Date(Date.now()+1000)})).find(job=>job.id===result.jobId)!;
   expect(retained.attempts).toBe(2);
   let generated=0;
   const app=new EditorialStrategyApplication(new PostgresEditorialStrategyRepository(db.db),{generate:async()=>{generated++;return {snapshot:snapshot(),metadata:{provider:"test",model:"fixture",promptVersion:"test",aiRunId:null}};}});
   const lifecycle=new McpTrackedJobLifecycle(new PostgresMcpOperationStore(db.db),async({operation})=>operation.resultRefs,clock);
   const tracked=await lifecycle.beforeDispatch(retained);
   await new ResearchInboundPreparationProcessor(app,queue,clock).process(retained);
   await lifecycle.afterSuccess(tracked);
   const status=await writer.callTool({name:"operation_get",arguments:{operationId:result.operationId}});
   expect(status.structuredContent).toMatchObject({status:"completed"});
   await writer.callTool({name:"content_strategy_prepare",arguments:args});
   expect(generated).toBe(1);
  }finally{await writer.close();await server.close();}
 });

 test("a delayed generation never replaces an intervening manual draft edit",async()=>{
  const repository=new PostgresEditorialStrategyRepository(db.db);
  let started!:()=>void, release!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const hold=new Promise<void>(resolve=>{release=resolve;});
  const app=new EditorialStrategyApplication(repository,{generate:async()=>{started();await hold;return {snapshot:snapshot(),metadata:{provider:"test",model:"fixture",promptVersion:"test",aiRunId:null}};}});
  const generation=app.derive({workspaceId,userId,requestKey:crypto.randomUUID()});
  await ready;
  const before=await app.find(workspaceId);
  await app.updateDraft({workspaceId,userId,requestKey:crypto.randomUUID(),snapshot:{...before!.draft,callsToAction:["Modification humaine à conserver"]}});
  release();
  await expect(generation).rejects.toThrow("EDITORIAL_STRATEGY_VERSION_CONFLICT");
  expect((await app.find(workspaceId))?.draft.callsToAction).toEqual(["Modification humaine à conserver"]);
 });

 test("simultaneous shared-application retries return the same draft",async()=>{
  const repository=new PostgresEditorialStrategyRepository(db.db);
  const app=new EditorialStrategyApplication(repository,{generate:async()=>{throw Error("not requested");}});
  const current=await app.find(workspaceId);
  const input={workspaceId,userId,requestKey:crypto.randomUUID(),snapshot:{...current!.draft,callsToAction:["Commande unique"]}};
  const [first,second]=await Promise.all([app.updateDraft(input),app.updateDraft(input)]);
  expect(first.id).toBe(second.id);
  expect(first.updatedAt).toEqual(second.updatedAt);
  expect(first.draft.callsToAction).toEqual(["Commande unique"]);
 });

});

function snapshot(): EditorialStrategySnapshot {
  return {
    audience: { name: "Fondateurs SaaS B2B", summary: "Équipes qui veulent relier contenu, prospection et appels.", awareness: "solution_aware" },
    pillars: [
      { name: "Système", promise: "Montrer le pipeline complet.", proofTypes: ["capture produit"] },
      { name: "Preuves", promise: "Expliquer les décisions avec leurs sources.", proofTypes: ["journal d’audit"] },
      { name: "Terrain", promise: "Partager les apprentissages des conversations.", proofTypes: ["conversation anonymisée"] },
    ],
    voice: { traits: ["direct", "technique"], avoid: ["hooks interchangeables"] },
    formats: ["linkedin_text"],
    cadence: { postsPerWeek: 3, preferredDays: [2, 3, 5], timezone: "Europe/Paris" },
    callsToAction: ["Demander un retour terrain"],
    allowedClaimIds: [],
    forbiddenTopics: ["chiffres non sourcés"],
  };
}
