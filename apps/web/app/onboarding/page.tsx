import { ArrowRight, Check, CircleAlert, Clock3, ExternalLink, LockKeyhole, RotateCcw } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession, getWorkspaceOnboarding, listWorkspaces } from "@/lib/api";
import { createWorkspaceAction } from "../workspaces/actions";
import { WorkspaceForm } from "../workspaces/workspace-form";
import { completeOnboardingStepAction, skipOnboardingStepAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ error?: string; workspace?: string }> }) {
  if (!(await getSession())) redirect("/login");
  const [workspaces, query] = await Promise.all([listWorkspaces(), searchParams]);
  const workspace = workspaces.find((candidate) => candidate.slug === query.workspace) ?? workspaces[0];
  if (workspace) {
    const progress = await getWorkspaceOnboarding(workspace.slug, workspace.id);
    const complete = completeOnboardingStepAction.bind(null, workspace.slug, workspace.id);
    const skip = skipOnboardingStepAction.bind(null, workspace.slug, workspace.id);
    return (
      <main className="min-h-screen bg-canvas px-4 py-8 sm:px-6 lg:py-12">
        <div className="mx-auto max-w-5xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><div className="badge badge-signal w-fit">Configuration guidée</div><h1 className="mt-4 text-3xl font-semibold text-navy">Rendez {workspace.name} opérationnel</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Chaque validation repose sur les vraies données du workspace. Vous pouvez quitter et reprendre sans rien perdre.</p></div>
            <div className="flex items-center gap-3"><span className="text-sm font-semibold text-navy">{progress.completedCount}/7 étapes</span><Link className="button" href={`/w/${workspace.slug}/strategy/product-reading`}>Ouvrir l’app</Link></div>
          </div>
          {workspaces.length > 1 ? <nav aria-label="Choisir le workspace" className="mt-5 flex flex-wrap gap-2">{workspaces.map((candidate) => <Link className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${candidate.id === workspace.id ? "border-navy bg-navy text-white" : "border-line bg-white text-muted"}`} href={`/onboarding?workspace=${candidate.slug}`} key={candidate.id}>{candidate.name}</Link>)}</nav> : null}
          {query.error ? <div className="mt-5 flex items-start gap-2 rounded-lg border border-danger/30 bg-red-50 p-4 text-sm text-danger" role="alert"><CircleAlert className="mt-0.5 shrink-0" size={16} /><p>{onboardingError(query.error)}</p></div> : null}
          <div className="mt-7 grid gap-3">
            {progress.steps.map((step) => {
              const current = step.key === progress.currentStep;
              const href = workspaceHref(workspace.slug, step.prerequisite.href);
              return <section className={`rounded-xl border bg-white p-5 ${current ? "border-brand-blue shadow-sm" : "border-line"}`} id={step.key} key={step.key}>
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="flex min-w-0 gap-4"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${step.status === "completed" ? "bg-emerald-100 text-success" : step.status === "skipped" ? "bg-slate-100 text-muted" : current ? "bg-blue-100 text-brand-blue" : "bg-slate-50 text-muted"}`}>{step.status === "completed" ? <Check size={17} /> : step.position}</span><div><div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold text-navy">{step.title}</h2>{step.optional ? <span className="badge">Facultatif</span> : null}{current ? <span className="badge badge-signal">Étape actuelle</span> : null}</div><p className="mt-1 text-sm text-muted">{step.description}</p><div className={`mt-3 flex items-start gap-2 text-xs ${step.prerequisite.satisfied ? "text-success" : "text-muted"}`}>{step.prerequisite.satisfied ? <Check className="mt-0.5 shrink-0" size={14} /> : <CircleAlert className="mt-0.5 shrink-0" size={14} />}<span>{step.prerequisite.satisfied ? "Prérequis réel satisfait." : step.prerequisite.message}</span></div>{!step.canMutate && step.status === "pending" ? <p className="mt-2 flex items-center gap-2 text-xs text-amber-700"><LockKeyhole size={13} />{step.requiredRole === "owner_or_admin" ? "Cette étape est réservée aux owners et admins." : "Votre rôle permet uniquement de consulter la progression."}</p> : null}</div></div>
                  {step.key === "sending_account" && step.status !== "completed" && step.canMutate ? <div className="mt-4 rounded-lg border border-brand-blue/20 bg-blue-50 p-3 sm:ml-13"><p className="text-xs font-semibold text-navy">Configurer directement un canal</p><p className="mt-1 text-xs text-muted">Le compte email ne bloque pas l’ajout d’un compte LinkedIn séparé.</p><div className="mt-3 flex flex-wrap gap-2"><Link className="button" href={workspaceHref(workspace.slug, "/integrations?channel=linkedin#connect-account")}>LinkedIn</Link><Link className="button" href={workspaceHref(workspace.slug, "/integrations?channel=email#connect-account")}>Email</Link><Link className="button" href={workspaceHref(workspace.slug, "/integrations?channel=whatsapp#connect-account")}>WhatsApp</Link></div></div> : null}
                  <div className="flex shrink-0 flex-wrap gap-2"><Link className="button" href={href}><ExternalLink size={14} />{step.prerequisite.satisfied ? "Voir" : "Résoudre"}</Link>{step.status !== "completed" && step.canMutate && step.prerequisite.satisfied && (current || step.status === "skipped") ? <form action={complete}><input name="step" type="hidden" value={step.key} /><button className="button button-primary" type="submit"><Check size={14} />Valider</button></form> : null}{current && step.optional && step.status === "pending" && step.canMutate ? <form action={skip}><input name="step" type="hidden" value={step.key} /><button className="button" type="submit"><Clock3 size={14} />Passer pour l’instant</button></form> : null}</div>
                </div>
              </section>;
            })}
          </div>
          <section className={`mt-6 rounded-xl border p-6 ${progress.completed ? "border-success/30 bg-emerald-50" : "border-line bg-white"}`}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="flex items-center gap-2 font-semibold text-navy">{progress.completed ? <Check className="text-success" size={18} /> : <RotateCcw className="text-brand-blue" size={18} />}{progress.completed ? "Configuration terminée" : "Votre progression est sauvegardée"}</h2><p className="mt-1 text-sm text-muted">{progress.completed ? "Le workspace est prêt. La prochaine action est de découvrir des prospects pour la première campagne." : "Revenez à tout moment : le parcours reprendra à la première étape incomplète."}</p></div><Link className="button button-signal" href={progress.completed ? workspaceHref(workspace.slug, progress.nextAction.href) : `#${progress.currentStep ?? "workspace"}`}>{progress.completed ? progress.nextAction.label : "Continuer"}<ArrowRight size={15} /></Link></div>
          </section>
        </div>
      </main>
    );
  }
  const create = createWorkspaceAction.bind(null, "/onboarding");
  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-5">
      <section className="panel w-full max-w-lg p-8">
        <div className="badge badge-signal w-fit">Première configuration</div>
        <h1 className="mt-5 text-2xl font-semibold">Créez votre workspace</h1>
        <p className="mt-3 text-sm leading-6 text-muted">Il contiendra vos offres, ICP, prospects et campagnes. Vous pourrez inviter l’équipe ensuite.</p>
        {query.error ? <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-danger">Impossible de créer le workspace. Vérifiez son nom puis réessayez.</p> : null}
        <WorkspaceForm action={create} />
      </section>
    </main>
  );
}

function workspaceHref(workspaceSlug: string, href: string) { return href.startsWith("#") ? href : `/w/${workspaceSlug}${href}`; }
function onboardingError(code: string) {
  if (code === "ONBOARDING_PREREQUISITE_MISSING") return "Le prérequis réel de cette étape n’est pas encore satisfait.";
  if (code === "ONBOARDING_PREVIOUS_STEP_INCOMPLETE") return "Terminez d’abord l’étape précédente.";
  if (code === "ONBOARDING_MUTATION_FORBIDDEN") return "Votre rôle ne permet pas de valider cette étape.";
  return "La progression n’a pas pu être mise à jour. Réessayez sans perdre votre contexte.";
}
