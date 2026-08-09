import { CheckCircle2, MailCheck, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/api";
import { acceptInvitationAction } from "./actions";

export const metadata = { title: "Invitation workspace" };
export const dynamic = "force-dynamic";

export default async function InvitationPage({ params, searchParams }: { params: Promise<{ invitationId: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ invitationId }, query, session] = await Promise.all([params, searchParams, getSession()]);
  if (!session) redirect(`/login?next=${encodeURIComponent(`/invitations/${invitationId}`)}`);
  const accept = acceptInvitationAction.bind(null, invitationId);
  return <main className="grid min-h-screen place-items-center bg-canvas p-5"><section className="panel w-full max-w-lg p-8"><div className="badge badge-signal w-fit"><MailCheck size={13} /> Invitation sécurisée</div><h1 className="mt-5 text-2xl font-semibold text-navy">Rejoindre le workspace</h1><p className="mt-3 text-sm leading-6 text-muted">Cette invitation sera associée au compte <strong className="text-navy">{session.user.email}</strong>. Elle est personnelle et à usage unique.</p>{query.error ? <p className="mt-5 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-danger">{invitationError(query.error)}</p> : null}<div className="mt-6 rounded-lg border border-line bg-slate-50 p-4 text-xs leading-5 text-muted"><p className="flex items-start gap-2"><ShieldCheck className="mt-0.5 shrink-0 text-emerald-600" size={15} /> L’accès ne concerne que le workspace indiqué par l’invitation. Aucun autre espace n’est exposé.</p></div><form action={accept} className="mt-6"><button className="button button-signal w-full" type="submit"><CheckCircle2 size={16} /> Accepter et ouvrir le workspace</button></form></section></main>;
}

function invitationError(code: string) { return ({ WORKSPACE_INVITATION_EXPIRED: "Cette invitation a expiré. Demandez-en une nouvelle à un owner.", WORKSPACE_INVITATION_CONSUMED: "Cette invitation a déjà été utilisée ou révoquée.", WORKSPACE_INVITATION_EMAIL_MISMATCH: "Connectez-vous avec l’adresse email invitée.", WORKSPACE_INVITATION_NOT_FOUND: "Cette invitation n’existe pas ou n’est plus disponible." } as Record<string, string>)[code] ?? "L’invitation ne peut pas être acceptée pour le moment."; }
