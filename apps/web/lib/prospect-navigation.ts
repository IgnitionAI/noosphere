export function prospectDetailHref(
  workspaceSlug: string,
  contactId: string,
  returnTo?: string,
): string {
  const pathname = `/w/${encodeURIComponent(workspaceSlug)}/prospects/${encodeURIComponent(contactId)}`;
  if (!returnTo) return pathname;
  return `${pathname}?${new URLSearchParams({ returnTo }).toString()}`;
}

export function resolveProspectReturn(
  workspaceSlug: string,
  returnTo?: string,
): { readonly href: string; readonly label: string } {
  const fallback = {
    href: `/w/${encodeURIComponent(workspaceSlug)}/prospects`,
    label: "Retour aux prospects",
  } as const;
  if (!returnTo || returnTo.includes("\\")) return fallback;

  try {
    const resolved = new URL(returnTo, "http://ignition-outbound.local");
    const campaignRoot = `/w/${encodeURIComponent(workspaceSlug)}/campaigns`;
    const belongsToWorkspace = resolved.origin === "http://ignition-outbound.local"
      && (resolved.pathname === campaignRoot || resolved.pathname.startsWith(`${campaignRoot}/`));
    if (!belongsToWorkspace) return fallback;
    return {
      href: `${resolved.pathname}${resolved.search}`,
      label: "Retour à la campagne",
    };
  } catch {
    return fallback;
  }
}
