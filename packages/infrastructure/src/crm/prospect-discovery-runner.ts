import type { ProspectEnricher } from "@outbound/application/crm/prospect-enrichment-ports";
import { PROSPECT_DISCOVERY_JOB_TYPE } from "@outbound/application/campaigns/autonomous-prospecting";
import type {
  AutonomousSourcingFilters,
} from "@outbound/application/campaigns/autonomous-prospecting";
import type { CompanyProspectSource } from "@outbound/application/crm/company-prospect-source";
import {
  buildProspectSearchFilters,
  computeProspectIcpFit,
} from "@outbound/application/crm/prospect-discovery-policy";
import type { JobQueue, LeasedJob } from "@outbound/application/jobs/job-queue";
import type { Clock } from "@outbound/application/shared/ports";
import {
  emptyProspectChannels,
  type ProspectChannels,
} from "@outbound/domain/crm/prospect-channels";
import { normalizeLinkedinUrl } from "@outbound/domain/crm/normalization";
import type { Database } from "@outbound/infrastructure/database/client";
import { PostgresDiscoveryRepository } from "@outbound/infrastructure/crm/postgres-discovery-repository";
import {
  ProviderUnavailableError,
  type ProspectSource,
} from "@outbound/infrastructure/crm/unipile-prospect-source";

export { PROSPECT_DISCOVERY_JOB_TYPE };

export class ProspectDiscoveryRunner {
  readonly #repository: PostgresDiscoveryRepository;

  constructor(
    database: Database,
    private readonly prospectSource: () => ProspectSource,
    private readonly prospectEnricher?: () => ProspectEnricher | null,
    private readonly companyProspectSource?: () => CompanyProspectSource | null,
  ) {
    this.#repository = new PostgresDiscoveryRepository(database);
  }

  async execute(input: {
    workspaceId: string;
    runId: string;
    version: { criteria: unknown; buyingCommittee: unknown };
    filters: ReturnType<typeof buildProspectSearchFilters> | AutonomousSourcingFilters;
  }) {
    if (isCompanySourcingFilters(input.filters)) {
      return this.#executeCompanySourcing({
        ...input,
        filters: input.filters,
      });
    }
    try {
      const source = this.prospectSource();
      const searched = await source.searchPeople(input.filters);
      const found = "channel" in input.filters && input.filters.channel === "linkedin" && source.enrichLinkedinProfile
        ? await mapWithConcurrency(searched, 3, (candidate) => source.enrichLinkedinProfile!(candidate))
        : searched;
      const baseCandidates = found.map((candidate) => ({
        id: crypto.randomUUID(),
        fullName: candidate.fullName,
        headline: candidate.headline,
        linkedinUrl: candidate.linkedinUrl,
        linkedinNormalized: normalizeLinkedin(candidate.linkedinUrl),
        location: candidate.location,
        companyName: candidate.companyName,
        companyWebsite: null as string | null,
        companyDomain: null as string | null,
        channels: candidate.channels ?? fallbackChannels(candidate.linkedinUrl),
        providerData: candidate.providerData,
        icpFit: computeProspectIcpFit(input.version, {
          headline: `Contact professionnel · ${candidate.companyName}`,
          companyName: candidate.companyName,
          location: candidate.location,
        }),
      }));
      const enricher = input.filters.enrichContacts
        ? this.prospectEnricher?.() ?? null
        : null;
      const candidates = enricher
        ? await mapWithConcurrency(baseCandidates, 2, async (candidate) => {
            if (!candidate.companyName) return candidate;
            try {
              const result = await enricher.enrich({
                fullName: candidate.fullName,
                companyName: candidate.companyName,
                location: candidate.location,
                linkedinUrl: candidate.linkedinUrl,
                channels: candidate.channels,
                correlationId: `prospect:${input.runId}:${candidate.id}`,
                requestKey: `prospect-enrichment:${input.runId}:${candidate.id}`,
              });
              let channels = result.channels;
              if (
                channels.whatsapp.value &&
                channels.whatsapp.status === "unverified" &&
                source.verifyWhatsappNumber
              ) {
                const verified = await source.verifyWhatsappNumber(channels.whatsapp.value);
                if (verified.status === "verified") {
                  channels = {
                    ...channels,
                    whatsapp: {
                      ...channels.whatsapp,
                      status: verified.status,
                      confidence: verified.confidence,
                      source: verified.source,
                    },
                  };
                }
              }
              return {
                ...candidate,
                companyWebsite: result.companyWebsite,
                companyDomain: result.companyDomain,
                channels,
                providerData: {
                  ...candidate.providerData,
                  publicEnrichment: {
                    status: "completed",
                    queries: result.queries,
                    evidence: result.evidence,
                  },
                },
              };
            } catch (error) {
              return {
                ...candidate,
                providerData: {
                  ...candidate.providerData,
                  publicEnrichment: {
                    status: "failed",
                    error: error instanceof Error ? error.name : "ENRICHMENT_FAILED",
                  },
                },
              };
            }
          })
        : baseCandidates;
      return await this.#repository.completeRun({
        workspaceId: input.workspaceId,
        runId: input.runId,
        candidates,
      });
    } catch (error) {
      if (error instanceof ProviderUnavailableError) {
        return this.#repository.failRun({
          workspaceId: input.workspaceId,
          runId: input.runId,
          errorCode: "PROVIDER_UNAVAILABLE",
          errorMessage: error.message,
        });
      }
      throw error;
    }
  }

  async #executeCompanySourcing(input: {
    workspaceId: string;
    runId: string;
    version: { criteria: unknown; buyingCommittee: unknown };
    filters: Extract<AutonomousSourcingFilters, { channel: "email" | "whatsapp" }>;
  }) {
    const source = this.companyProspectSource?.();
    if (!source) throw new ProviderUnavailableError("Company prospect sourcing is not configured");
    const found = await source.searchCompanies({
      ...input.filters,
      correlationId: `campaign-sourcing:${input.runId}`,
    });
    return this.#repository.completeRun({
      workspaceId: input.workspaceId,
      runId: input.runId,
      candidates: found.map((candidate) => ({
        id: crypto.randomUUID(),
        fullName: candidate.fullName,
        headline: `Contact professionnel · ${candidate.companyName}`,
        linkedinUrl: null,
        linkedinNormalized: null,
        location: candidate.location,
        companyName: candidate.companyName,
        companyWebsite: candidate.companyWebsite,
        companyDomain: candidate.companyDomain,
        channels: candidate.channels,
        providerData: candidate.providerData,
        icpFit: computeProspectIcpFit(input.version, {
          headline: `Contact professionnel · ${candidate.companyName}`,
          companyName: candidate.companyName,
          location: candidate.location,
        }),
      })),
    });
  }
}

function isCompanySourcingFilters(
  filters: ReturnType<typeof buildProspectSearchFilters> | AutonomousSourcingFilters,
): filters is Extract<AutonomousSourcingFilters, { channel: "email" | "whatsapp" }> {
  return "channel" in filters && (filters.channel === "email" || filters.channel === "whatsapp");
}

export class ProspectDiscoveryJobProcessor {
  readonly #repository: PostgresDiscoveryRepository;

  constructor(
    database: Database,
    private readonly queue: JobQueue,
    private readonly runner: ProspectDiscoveryRunner,
    private readonly clock: Clock,
  ) {
    this.#repository = new PostgresDiscoveryRepository(database);
  }

  async process(job: LeasedJob): Promise<void> {
    const payload = discoveryJobPayload(job.payload);
    const run = await this.#repository.getRun(payload);
    if (!run || run.status === "completed") {
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    const version = await this.#repository.getIcpVersion({
      workspaceId: payload.workspaceId,
      versionId: run.icpVersionId,
    });
    if (!version) {
      await this.#repository.failRun({
        ...payload,
        errorCode: "ICP_VERSION_NOT_FOUND",
        errorMessage: "Published ICP version not found",
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
      return;
    }
    try {
      await this.runner.execute({
        ...payload,
        version,
        filters: run.filters as ReturnType<typeof buildProspectSearchFilters> | AutonomousSourcingFilters,
      });
      await this.queue.acknowledge(job.id, job.lockedBy, this.clock.now());
    } catch (error) {
      const outcome = await this.queue.retry({
        jobId: job.id,
        workerId: job.lockedBy,
        availableAt: new Date(this.clock.now().getTime() + 30_000 * job.attempts),
        errorCode: "PROSPECT_DISCOVERY_FAILED",
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      if (outcome === "dead_lettered") {
        await this.#repository.failRun({
          ...payload,
          errorCode: "PROSPECT_DISCOVERY_FAILED",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

function discoveryJobPayload(value: unknown): { workspaceId: string; runId: string } {
  if (!value || typeof value !== "object") throw new Error("INVALID_PROSPECT_DISCOVERY_JOB");
  const payload = value as Record<string, unknown>;
  if (typeof payload.workspaceId !== "string" || typeof payload.runId !== "string") {
    throw new Error("INVALID_PROSPECT_DISCOVERY_JOB");
  }
  return { workspaceId: payload.workspaceId, runId: payload.runId };
}

function normalizeLinkedin(url: string | null): string | null {
  if (!url) return null;
  try {
    return normalizeLinkedinUrl(url);
  } catch {
    return null;
  }
}

function fallbackChannels(linkedinUrl: string | null): ProspectChannels {
  const channels = emptyProspectChannels();
  const normalizedValue = normalizeLinkedin(linkedinUrl);
  if (!linkedinUrl || !normalizedValue) return channels;
  return {
    ...channels,
    linkedin: {
      value: linkedinUrl,
      normalizedValue,
      status: "found",
      confidence: "medium",
      source: "provider_search",
    },
  };
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, async () => {
      while (cursor < values.length) {
        const index = cursor++;
        results[index] = await mapper(values[index]!);
      }
    }),
  );
  return results;
}
