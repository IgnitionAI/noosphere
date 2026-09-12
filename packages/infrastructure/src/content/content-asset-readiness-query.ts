import { sql } from "drizzle-orm";
import { CONTENT_EDITORIAL_POLICY_VERSION } from "@outbound/domain/content/content-asset";
import { contentAssets, contentAssetVersions } from "@outbound/infrastructure/database/schema";

/** Correlated to the outer contentAssets row; historical snapshots stay immutable. */
export function contentAssetReadinessIsCurrent() {
  return sql<boolean>`exists (
    select 1 from ${contentAssetVersions}
    where ${contentAssetVersions.workspaceId} = ${contentAssets.workspaceId}
      and ${contentAssetVersions.assetId} = ${contentAssets.id}
      and ${contentAssetVersions.version} = ${contentAssets.latestVersion}
      and ${contentAssetVersions.readiness}->>'policyVersion' = ${CONTENT_EDITORIAL_POLICY_VERSION}
      and ${contentAssetVersions.readiness}->>'ready' = 'true'
  )`;
}

export function effectiveContentAssetStatus() {
  return sql<string>`case when ${contentAssets.status} = 'ready' and not (${contentAssetReadinessIsCurrent()})
    then 'blocked' else ${contentAssets.status} end`;
}
