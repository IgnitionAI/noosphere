import type { WorkspaceAiModelPolicy } from "@outbound/application/workspaces/workspace-ai-settings";
import type { SqlClient } from "@outbound/infrastructure/database/client";

/** Publish only model routing, never environment values or credentials, before accepting work. */
export async function registerRuntimeAiDefaults(sql: SqlClient, policy: WorkspaceAiModelPolicy): Promise<void> {
  await sql`insert into instance_ai_runtime_defaults (id, policy) values (true, ${sql.json(policy as never)})
    on conflict (id) do update set policy = excluded.policy
    where instance_ai_runtime_defaults.policy is distinct from excluded.policy`;
}
