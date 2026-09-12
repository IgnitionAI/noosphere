import { redirect } from "next/navigation";
import { getInstanceSetup, getSession, listWorkspaces } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const workspaces = await listWorkspaces();
  const workspace = workspaces[0];
  if (!workspace) {
    const setup = await getInstanceSetup();
    if (setup.isAdministrator && !setup.skipped && !setup.aiReady) redirect("/setup");
    redirect("/onboarding");
  }
  redirect(`/w/${workspace.slug}`);
}
