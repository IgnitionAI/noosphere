import type { WorkspaceAiModelPolicy } from "@outbound/application/workspaces/workspace-ai-settings";
import type { SqlClient } from "@outbound/infrastructure/database/client";

/** Publish routing and migrate pre-snapshot queue rows before accepting work; never copy secrets. */
export async function registerRuntimeAiDefaults(sql: SqlClient, policy: WorkspaceAiModelPolicy): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`insert into instance_ai_runtime_defaults (id, policy) values (true, ${tx.json(policy as never)})
      on conflict (id) do update set policy = excluded.policy
      where instance_ai_runtime_defaults.policy is distinct from excluded.policy`;
    // Environment routing is available only at runtime, after SQL migrations. Existing
    // task contexts win, including a run with both upgraded and legacy queue rows.
    // Older workspace settings stored separate model lists without a provider.
    // Bind them once to the installation's existing provider, keeping the lists intact.
    const legacyProvider = policy.defaultRoutes?.[0]?.provider ?? "kimi-code";
    await tx`update workspace_ai_settings s set model_routing = jsonb_build_object(
      'researchTierRoutes', jsonb_build_object(
        'principal', (select coalesce(jsonb_agg(jsonb_build_object('provider', ${legacyProvider}::text, 'model', value, 'reasoningEffort', case when ordinality = 1 then 'max' else 'low' end) order by ordinality), '[]'::jsonb) from jsonb_array_elements_text(s.research_models) with ordinality),
        'executor', (select coalesce(jsonb_agg(jsonb_build_object('provider', ${legacyProvider}::text, 'model', value, 'reasoningEffort', 'low') order by ordinality), '[]'::jsonb) from jsonb_array_elements_text(s.synthesis_models) with ordinality)))
      where model_routing is null`;
    await tx`insert into task_ai_contexts (workspace_id, task_key, policy)
      select distinct workspace_id,
        case when jsonb_typeof(payload->'runId') = 'string'
          then split_part(type, '.', 1) || ':run:' || (payload->>'runId')
          else 'job:' || id::text end,
        noosphere_capture_ai_policy(workspace_id)
      from jobs where ai_policy is null or ai_task_key is null
      on conflict (workspace_id, task_key) do nothing`;
    // Research runs remain resumable after queue retention. Drafts have never
    // launched and must continue inheriting the choice at their future enqueue.
    await tx`insert into task_ai_contexts (workspace_id, task_key, policy)
      select workspace_id, 'research:run:' || id::text, noosphere_capture_ai_policy(workspace_id)
      from product_research_runs r where status <> 'draft'
        and not exists (select 1 from task_ai_contexts c
          where c.workspace_id = r.workspace_id and c.task_key = 'research:run:' || r.id::text)
      on conflict (workspace_id, task_key) do nothing`;
    await tx`update jobs j set ai_policy = c.policy, ai_task_key = c.task_key
      from task_ai_contexts c
      where j.workspace_id = c.workspace_id and (j.ai_policy is null or j.ai_task_key is null)
        and c.task_key = case when jsonb_typeof(j.payload->'runId') = 'string'
          then split_part(j.type, '.', 1) || ':run:' || (j.payload->>'runId')
          else 'job:' || j.id::text end`;
  });
}
