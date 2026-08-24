import { ArrowRight, Building2 } from "lucide-react";

export function WorkspaceForm({ action }: { action: (formData: FormData) => Promise<void> }) {
  return <form action={action} className="mt-6 space-y-4"><label className="block text-xs font-semibold text-muted">Nom du workspace<input autoFocus className="control mt-1.5" maxLength={200} name="name" placeholder="Acme France" required /></label><label className="block text-xs font-semibold text-muted">Slug personnalisé <span className="font-normal">(facultatif)</span><input className="control mt-1.5" maxLength={120} name="slug" pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="acme-france" /><span className="mt-1.5 block text-[11px] font-normal leading-5 text-muted">Laissez vide pour le générer automatiquement depuis le nom.</span></label><button className="button button-signal w-full" type="submit"><Building2 size={16} /> Créer le workspace <ArrowRight size={15} /></button></form>;
}
