import { redirect } from "next/navigation";
import { getSession, listWorkspaces } from "@/lib/api";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const workspaces = await listWorkspaces();
  const workspace = workspaces[0];
  if (!workspace) redirect("/onboarding");
  redirect(`/w/${workspace.slug}/strategy/product-reading`);
}
