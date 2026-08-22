import { ArrowLeft, Palette } from "lucide-react";
import Link from "next/link";
import { getContentBrandKit } from "@/lib/api";
import { BrandEditor } from "./brand-editor";

export const metadata = { title: "Identité de marque — Noosphere" };
export const dynamic = "force-dynamic";

export default async function WorkspaceBrandPage({ params }: { params: Promise<{ workspaceSlug: string }> }) {
  const { workspaceSlug } = await params;
  const brandKit = await getContentBrandKit(workspaceSlug);
  return <div className="mx-auto max-w-6xl">
    <header className="border-b border-line pb-6">
      <Link className="inline-flex items-center gap-1 text-xs font-semibold text-muted hover:text-navy" href={`/w/${workspaceSlug}/settings`}><ArrowLeft size={13} /> Configuration</Link>
      <div className="badge badge-signal mt-3 w-fit"><Palette size={13} /> Une marque, deux moteurs</div>
      <h1 className="page-title mt-3">Identité de marque</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">Noosphere réutilise automatiquement cette identité dans vos posts, carrousels, messages Outbound et réponses du Setter.</p>
    </header>
    <BrandEditor initial={brandKit.snapshot} workspaceSlug={workspaceSlug} />
  </div>;
}
