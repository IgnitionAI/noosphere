import {
  ArrowLeft,
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  MapPin,
  RefreshCw,
  SearchCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { getResearchReport, OutboundApiError } from "@/lib/api";
import { campaignsHref } from "./report-links";

export const metadata = { title: "Rapport ICP" };
export const dynamic = "force-dynamic";

export default async function ResearchReportPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; runId: string }>;
}) {
  const { workspaceSlug, runId } = await params;
  let report;
  try {
    report = await getResearchReport(workspaceSlug, runId);
  } catch (error) {
    if (error instanceof OutboundApiError && error.status === 404) notFound();
    throw error;
  }

  const isV3 = report.run.brief.researchVersion === 3;
  const ranking = object(report.stageOutputs.objective_ranking);
  const review = object(report.stageOutputs.evidence_review);
  const commercialReadiness = object(review.commercialReadiness);
  const proposals = report.proposals
    .map(object)
    .sort((left, right) => numeric(left.rank) - numeric(right.rank));
  const decision = text(commercialReadiness.decision);
  const hasReservations = isV3 ? text(ranking.status) !== "complete" : decision !== "ready";
  const summary = isV3 ? text(ranking.summary) : text(review.executiveSummary);
  const coverage = object(ranking.coverage);
  const missingStages = stringArray(ranking.missingStages);
  const restartHref = `/w/${workspaceSlug}/strategy/product-reading`;
  const campaignsUrl = campaignsHref(workspaceSlug, report.versions);

  return (
    <main className="mx-auto max-w-5xl space-y-6 pb-12">
      <header>
        <Link
          className="mb-5 inline-flex min-h-11 items-center gap-2 text-xs font-semibold text-muted transition-colors hover:text-ink"
          href={`/w/${workspaceSlug}/research/${runId}`}
        >
          <ArrowLeft aria-hidden="true" size={15} />
          Retour à la progression
        </Link>

        <div className="flex flex-col gap-6 border-b border-line pb-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <span className={hasReservations ? "badge badge-warning" : "badge badge-success"}>
              {hasReservations ? (
                <TriangleAlert aria-hidden="true" size={12} />
              ) : (
                <CheckCircle2 aria-hidden="true" size={12} />
              )}
              {hasReservations ? "Analyse terminée avec réserves" : "Analyse validée automatiquement"}
            </span>
            <h1 className="page-title mt-4">Rapport ICP · {report.run.brief.productName}</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              Les marchés les plus crédibles pour votre produit, classés et transformés en
              critères directement utilisables pour la prospection.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {campaignsUrl ? (
              <Link
                className="button button-primary min-h-11 flex-none"
                data-testid="view-campaigns-cta"
                href={campaignsUrl}
              >
                <UsersRound aria-hidden="true" size={16} />
                Voir les campagnes générées
              </Link>
            ) : null}
            <Link className="button min-h-11 flex-none" href={restartHref}>
              <RefreshCw aria-hidden="true" size={16} />
              Relancer une étude
            </Link>
          </div>
        </div>

        <div className="grid gap-3 pt-5 sm:grid-cols-3">
          <ReportMetric label="ICP retenus" value={String(proposals.length)} />
          <ReportMetric label="Sources analysées" value={String(report.evidence.length)} />
          <ReportMetric
            label={isV3 ? "Hypothèses étudiées" : "Concurrents étudiés"}
            value={String(isV3 ? numeric(coverage.investigated) : report.competitors.length)}
          />
        </div>
      </header>

      {isV3 && text(ranking.status) === "partial" ? (
        <section className="rounded-xl border border-warning/40 bg-amber-50 p-5 text-warning sm:p-6">
          <div className="flex items-start gap-3">
            <TriangleAlert aria-hidden="true" className="mt-0.5 flex-none" size={19} />
            <div>
              <h2 className="font-semibold">Rapport partiel disponible</h2>
              <p className="mt-1 text-xs leading-5">
                La limite de recherche a été atteinte. Les résultats déjà prouvés sont conservés
                et les hypothèses non validées restent explicitement signalées.
              </p>
              {missingStages.length ? (
                <p className="mt-2 text-[11px] leading-5">
                  Étapes non terminées : {missingStages.join(", ")}.
                </p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      <section className="rounded-xl border border-line bg-white p-5 sm:p-7" aria-labelledby="summary-title">
        <div className="flex items-start gap-4">
          <span className="grid h-10 w-10 flex-none place-items-center rounded-lg bg-navy text-white">
            <FileCheck2 aria-hidden="true" size={19} />
          </span>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold" id="summary-title">
              Synthèse
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-7">
              {summary ||
                "L’étude a analysé votre produit, son environnement concurrentiel et les marchés accessibles."}
            </p>
            {!isV3 && text(commercialReadiness.rationale) ? (
              <p className="mt-3 text-xs leading-5 text-muted">{text(commercialReadiness.rationale)}</p>
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="icp-title">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-blue">
              Recommandations
            </span>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight" id="icp-title">
              Vos ICP prioritaires
            </h2>
          </div>
          <p className="max-w-md text-right text-xs leading-5 text-muted">
            Le classement est produit automatiquement. Aucune validation manuelle n’est requise.
          </p>
        </div>

        {proposals.length ? (
          <div className="space-y-4">
            {proposals.map((proposal, index) => (
              <IcpCard key={text(proposal.id) || `${text(proposal.name)}-${index}`} proposal={proposal} />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-warning/40 bg-amber-50 p-6 text-center">
            <TriangleAlert aria-hidden="true" className="mx-auto text-warning" size={24} />
            <h3 className="mt-3 font-semibold">Aucun ICP suffisamment crédible</h3>
            <p className="mx-auto mt-2 max-w-lg text-xs leading-5 text-warning">
              Cette étude n’a pas réuni assez d’éléments pour recommander un marché. Vous pouvez
              préciser le produit ou joindre de nouveaux documents, puis relancer l’analyse.
            </p>
          </div>
        )}
      </section>

      <details className="group rounded-xl border border-line bg-white">
        <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2">
          <span className="flex items-center gap-3">
            <SearchCheck aria-hidden="true" className="text-brand-blue" size={18} />
            Méthode et sources
          </span>
          <span className="text-xs font-medium text-muted group-open:hidden">Voir le détail</span>
          <span className="hidden text-xs font-medium text-muted group-open:inline">Masquer</span>
        </summary>
        <div className="space-y-6 border-t border-line px-5 py-5">
          {report.competitors.length ? (
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
                Concurrents et alternatives analysés
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {report.competitors.map((competitor, index) => (
                  <span className="badge" key={text(competitor.id) || index}>
                    {text(competitor.name) || "Acteur analysé"}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Sources utilisées
            </h3>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {report.evidence.map((item) => (
                <article className="rounded-lg border border-line p-4" key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <strong className="text-xs leading-5">{item.title}</strong>
                    <span className="badge flex-none">
                      {item.sourceType === "public_web" ? "Web" : "Interne"}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-[11px] leading-5 text-muted">{item.excerpt}</p>
                  {item.url ? (
                    <a
                      className="mt-3 inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand-blue"
                      href={item.url}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Ouvrir la source <ExternalLink aria-hidden="true" size={12} />
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </div>
        </div>
      </details>

      <section className="rounded-xl border border-navy bg-navy px-5 py-7 text-white sm:px-7">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Le résultat ne vous convient pas ?</h2>
            <p className="mt-2 max-w-xl text-sm leading-6 text-white/70">
              Ajustez votre brief, ajoutez des documents ou changez la profondeur de recherche,
              puis lancez une nouvelle étude complète.
            </p>
          </div>
          <Link className="button button-signal min-h-11 flex-none" href={restartHref}>
            Relancer une étude
            <ArrowRight aria-hidden="true" size={16} />
          </Link>
        </div>
      </section>
    </main>
  );
}

function IcpCard({ proposal }: { proposal: Record<string, unknown> }) {
  const criteria = object(proposal.criteria);
  const prospecting = object(criteria.prospecting);
  const industries = firstList(prospecting.industries, criteria.industries);
  const companySizes = firstList(prospecting.companySizes, criteria.companySizes);
  const geographies = firstList(prospecting.geographies, criteria.geographies, criteria.geography);
  const buyingCommittee = firstList(proposal.buyingCommittee, prospecting.jobTitles);
  const problems = stringArray(proposal.problems);
  const signals = firstList(proposal.signals, prospecting.triggerSignals);
  const exclusions = firstList(proposal.exclusions, prospecting.exclusions);
  const unknowns = stringArray(proposal.unknowns);
  const keywords = firstList(prospecting.searchKeywords, criteria.searchKeywords);
  const confidence = confidencePercent(proposal.confidence);
  const rank = Math.max(1, Math.round(numeric(proposal.rank)) || 1);

  return (
    <article className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="border-b border-line px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-signal">Priorité {rank}</span>
          <span className="badge">{buyerTypeLabel(text(criteria.buyerType))}</span>
          {confidence > 0 ? <span className="badge">Confiance {confidence} %</span> : null}
        </div>
        <h3 className="mt-3 text-xl font-semibold tracking-tight">{text(proposal.name)}</h3>
        {problems[0] ? <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">{problems[0]}</p> : null}
      </div>

      <div className="grid gap-px bg-line md:grid-cols-3">
        <ReportBlock
          icon={<Building2 aria-hidden="true" size={17} />}
          title="Entreprises à cibler"
          items={[...industries.slice(0, 2), ...companySizes.slice(0, 2)]}
          empty="Critères entreprise à préciser"
        />
        <ReportBlock
          icon={<UsersRound aria-hidden="true" size={17} />}
          title="Qui contacter"
          items={buyingCommittee.slice(0, 4)}
          empty="Décideurs à préciser"
        />
        <ReportBlock
          icon={<Sparkles aria-hidden="true" size={17} />}
          title="Signaux à surveiller"
          items={signals.slice(0, 3)}
          empty="Signaux à confirmer"
        />
      </div>

      <details className="group border-t border-line">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-4 px-5 py-3 text-xs font-semibold text-brand-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-blue focus-visible:ring-offset-2 sm:px-6">
          Voir le plan de prospection
          <span className="text-muted group-open:hidden">Afficher</span>
          <span className="hidden text-muted group-open:inline">Masquer</span>
        </summary>
        <div className="grid gap-5 border-t border-line px-5 py-5 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          <DetailList icon={<MapPin aria-hidden="true" size={15} />} title="Zones" items={geographies} />
          <DetailList
            icon={<BriefcaseBusiness aria-hidden="true" size={15} />}
            title="Problèmes"
            items={problems.slice(1, 5)}
          />
          <DetailList icon={<Target aria-hidden="true" size={15} />} title="Mots-clés" items={keywords} />
          <DetailList
            icon={<TriangleAlert aria-hidden="true" size={15} />}
            title="À éviter ou confirmer"
            items={[...exclusions.slice(0, 3), ...unknowns.slice(0, 2)]}
          />
        </div>
      </details>
    </article>
  );
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tracking-tight">{value}</div>
    </div>
  );
}

function ReportBlock({
  icon,
  title,
  items,
  empty,
}: {
  icon: ReactNode;
  title: string;
  items: readonly string[];
  empty: string;
}) {
  return (
    <div className="bg-white p-5 sm:p-6">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
        <span className="text-brand-blue">{icon}</span>
        {title}
      </div>
      {items.length ? (
        <ul className="mt-3 space-y-2 text-sm leading-5">
          {items.map((item) => (
            <li className="flex gap-2" key={item}>
              <span aria-hidden="true" className="mt-2 h-1 w-1 flex-none rounded-full bg-brand-blue" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs text-muted">{empty}</p>
      )}
    </div>
  );
}

function DetailList({
  icon,
  title,
  items,
}: {
  icon: ReactNode;
  title: string;
  items: readonly string[];
}) {
  if (!items.length) return null;
  return (
    <div>
      <h4 className="flex items-center gap-2 text-xs font-semibold text-muted">
        {icon}
        {title}
      </h4>
      <ul className="mt-2 space-y-1 text-xs leading-5">
        {items.map((item) => (
          <li key={item}>• {item}</li>
        ))}
      </ul>
    </div>
  );
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstList(...values: unknown[]): string[] {
  for (const value of values) {
    const list = stringArray(value);
    if (list.length) return list;
  }
  return [];
}

function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const single = text(value);
  return single ? [single] : [];
}

function buyerTypeLabel(value: string): string {
  if (value === "end_customer") return "Client final";
  if (value === "channel_partner") return "Partenaire";
  if (value === "internal_builder") return "Équipe interne";
  return "Marché cible";
}

function confidencePercent(value: unknown): number {
  const parsed = numeric(value);
  return Math.round(parsed <= 1 ? parsed * 100 : parsed);
}

function numeric(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
