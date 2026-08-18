import { redirect } from "next/navigation";

export default async function WorkspaceHomePage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  redirect(`/w/${workspaceSlug}/campaigns`);
}
