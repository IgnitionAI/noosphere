export function campaignsHref(
  workspaceSlug: string,
  versions: readonly Readonly<Record<string, unknown>>[],
): string | null {
  if (!versions.some((version) => typeof version.id === "string" && version.id.length > 0)) {
    return null;
  }
  const runId = versions.find(
    (version) => typeof version.runId === "string" && version.runId.length > 0,
  )?.runId;
  return typeof runId === "string"
    ? `/w/${workspaceSlug}/campaigns?runId=${encodeURIComponent(runId)}`
    : `/w/${workspaceSlug}/campaigns`;
}
