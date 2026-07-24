import { notFound, redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getSession, listWorkspaces } from "@/lib/api";

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

  return (
    <AppShell session={session} workspace={workspace} workspaces={workspaces}>
      {children}
    </AppShell>
  );
}
