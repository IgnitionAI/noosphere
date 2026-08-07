import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  companies,
  icps,
  icpVersions,
  prospectDiscoveryCandidates,
  prospectDiscoveryRuns,
} from "@outbound/infrastructure/database/schema";

export class PostgresDiscoveryRepository {
  constructor(private readonly db: Database) {}

  async listIcps(workspaceId: string) {
    return this.db.select().from(icps)
      .where(and(eq(icps.workspaceId, workspaceId), isNull(icps.deletedAt)))
      .orderBy(asc(icps.name));
  }

  async getIcp(input: { workspaceId: string; icpId: string }) {
    const rows = await this.db.select().from(icps).where(and(
      eq(icps.workspaceId, input.workspaceId), eq(icps.id, input.icpId),
    )).limit(1);
    if (!rows[0]) return null;
    const versions = await this.db.select().from(icpVersions).where(and(
      eq(icpVersions.workspaceId, input.workspaceId), eq(icpVersions.icpId, input.icpId),
    )).orderBy(desc(icpVersions.version));
    return { ...rows[0], versions };
  }

  async listIcpVersions(workspaceId: string) {
    return this.db
      .select()
      .from(icpVersions)
      .where(eq(icpVersions.workspaceId, workspaceId))
      .orderBy(desc(icpVersions.publishedAt));
  }

  async getIcpVersion(input: { workspaceId: string; versionId: string }) {
    const rows = await this.db
      .select()
      .from(icpVersions)
      .where(
        and(
          eq(icpVersions.workspaceId, input.workspaceId),
          eq(icpVersions.id, input.versionId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async createRun(input: {
    id: string;
    workspaceId: string;
    icpVersionId: string;
    filters: unknown;
    createdBy: string;
  }) {
    const rows = await this.db
      .insert(prospectDiscoveryRuns)
      .values({
        id: input.id,
        workspaceId: input.workspaceId,
        icpVersionId: input.icpVersionId,
        filters: input.filters,
        createdBy: input.createdBy,
      })
      .returning();
    return rows[0]!;
  }

  async completeRun(input: {
    workspaceId: string;
    runId: string;
    candidates: readonly {
      id: string;
      fullName: string;
      headline: string | null;
      linkedinUrl: string | null;
      linkedinNormalized: string | null;
      location: string | null;
      companyName: string | null;
      providerData: unknown;
      icpFit: unknown;
    }[];
  }) {
    return this.db.transaction(async (tx) => {
      if (input.candidates.length) {
        await tx
          .insert(prospectDiscoveryCandidates)
          .values(
            input.candidates.map((candidate) => ({
              id: candidate.id,
              workspaceId: input.workspaceId,
              runId: input.runId,
              fullName: candidate.fullName,
              headline: candidate.headline,
              linkedinUrl: candidate.linkedinUrl,
              linkedinNormalized: candidate.linkedinNormalized,
              location: candidate.location,
              companyName: candidate.companyName,
              providerData: candidate.providerData as Record<string, unknown>,
              icpFit: candidate.icpFit as Record<string, unknown>,
            })),
          )
          .onConflictDoNothing();
      }
      const rows = await tx
        .update(prospectDiscoveryRuns)
        .set({
          status: "completed",
          errorCode: null,
          errorMessage: null,
          candidateCount: input.candidates.length,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
            eq(prospectDiscoveryRuns.id, input.runId),
          ),
        )
        .returning();
      if (rows.length !== 1) throw new Error("DISCOVERY_RUN_NOT_FOUND");
      return rows[0]!;
    });
  }

  async failRun(input: {
    workspaceId: string;
    runId: string;
    errorCode: string;
    errorMessage: string;
  }) {
    const rows = await this.db
      .update(prospectDiscoveryRuns)
      .set({
        status: "failed",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
          eq(prospectDiscoveryRuns.id, input.runId),
        ),
      )
      .returning();
    if (rows.length !== 1) throw new Error("DISCOVERY_RUN_NOT_FOUND");
    return rows[0]!;
  }

  async listRuns(input: { workspaceId: string; icpVersionId?: string }) {
    return this.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
          ...(input.icpVersionId
            ? [eq(prospectDiscoveryRuns.icpVersionId, input.icpVersionId)]
            : []),
        ),
      )
      .orderBy(desc(prospectDiscoveryRuns.createdAt))
      .limit(50);
  }

  async getRun(input: { workspaceId: string; runId: string }) {
    const rows = await this.db
      .select()
      .from(prospectDiscoveryRuns)
      .where(
        and(
          eq(prospectDiscoveryRuns.workspaceId, input.workspaceId),
          eq(prospectDiscoveryRuns.id, input.runId),
        ),
      )
      .limit(1);
    const run = rows[0];
    if (!run) return null;
    const candidates = await this.db
      .select()
      .from(prospectDiscoveryCandidates)
      .where(
        and(
          eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
          eq(prospectDiscoveryCandidates.runId, input.runId),
        ),
      )
      .orderBy(asc(prospectDiscoveryCandidates.createdAt));
    return { ...run, candidates };
  }

  async getCandidate(input: { workspaceId: string; runId: string; candidateId: string }) {
    const rows = await this.db
      .select()
      .from(prospectDiscoveryCandidates)
      .where(
        and(
          eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
          eq(prospectDiscoveryCandidates.runId, input.runId),
          eq(prospectDiscoveryCandidates.id, input.candidateId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findCompanyByName(input: { workspaceId: string; name: string }) {
    const rows = await this.db
      .select()
      .from(companies)
      .where(
        and(
          eq(companies.workspaceId, input.workspaceId),
          eq(companies.name, input.name),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async markCandidateImported(input: {
    workspaceId: string;
    candidateId: string;
    contactId: string;
  }) {
    await this.db
      .update(prospectDiscoveryCandidates)
      .set({ importedContactId: input.contactId })
      .where(
        and(
          eq(prospectDiscoveryCandidates.workspaceId, input.workspaceId),
          eq(prospectDiscoveryCandidates.id, input.candidateId),
        ),
      );
  }
}
