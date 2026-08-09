import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { acknowledgeHealthAlertAction } from "./integrations/actions";
import { getSession, listAccountHealthAlerts, listWorkspaces } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ workspaceSlug: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");
  const { workspaceSlug } = await params;
  const workspaces = await listWorkspaces();
  const workspace = workspaces.find((candidate) => candidate.slug === workspaceSlug);
  if (!workspace) notFound();
  const healthAlerts = ["operator", "admin", "owner"].includes(workspace.role)
    ? await listAccountHealthAlerts(workspaceSlug).then(({ data }) => data.filter((alert) => alert.status === "active").map((alert) => ({
      ...alert,
      ...(workspace.role === "admin" || workspace.role === "owner"
        ? { acknowledgeAction: acknowledgeHealthAlertAction.bind(null, workspaceSlug, alert.id) }
        : {}),
    }))).catch(() => [])
    : [];

  return (
    <AppShell healthAlerts={healthAlerts} session={session} workspace={workspace} workspaces={workspaces}>
      {children}
    </AppShell>
  );
}
