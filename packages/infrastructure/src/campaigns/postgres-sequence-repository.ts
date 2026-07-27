import { and, asc, desc, eq } from "drizzle-orm";
import type { Database } from "@outbound/infrastructure/database/client";
import {
  outboxEvents,
  sequences,
  sequenceSteps,
  sequenceVersions,
} from "@outbound/infrastructure/database/schema";

export class PostgresSequenceRepository {
  constructor(private readonly db: Database) {}

  async listSequences(workspaceId: string) {
    return this.db
      .select()
      .from(sequences)
      .where(eq(sequences.workspaceId, workspaceId))
      .orderBy(desc(sequences.updatedAt))
      .limit(100);
  }

  async createSequence(input: {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    createdBy: string;
  }) {
    const rows = await this.db
      .insert(sequences)
      .values(input)
      .returning();
    await this.db.insert(outboxEvents).values({
      workspaceId: input.workspaceId,
      aggregateType: "Sequence",
      aggregateId: input.id,
      eventType: "SequenceCreated",
      payload: { sequenceId: input.id },
    });
    return rows[0]!;
  }

  async getSequence(input: { workspaceId: string; sequenceId: string }) {
    const rows = await this.db
      .select()
      .from(sequences)
      .where(
        and(
          eq(sequences.workspaceId, input.workspaceId),
          eq(sequences.id, input.sequenceId),
        ),
      )
      .limit(1);
    const sequence = rows[0];
    if (!sequence) return null;
    const steps = await this.db
      .select()
      .from(sequenceSteps)
      .where(
        and(
          eq(sequenceSteps.workspaceId, input.workspaceId),
          eq(sequenceSteps.sequenceId, input.sequenceId),
        ),
      )
      .orderBy(asc(sequenceSteps.position));
    return { ...sequence, steps };
  }

  async updateSequence(input: {
    workspaceId: string;
    sequenceId: string;
    name?: string;
    description?: string | null;
  }) {
    const rows = await this.db
      .update(sequences)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(sequences.workspaceId, input.workspaceId),
          eq(sequences.id, input.sequenceId),
        ),
      )
      .returning();
    if (rows.length !== 1) throw new Error("SEQUENCE_NOT_FOUND");
    return rows[0]!;
  }

  async replaceSteps(input: {
    workspaceId: string;
    sequenceId: string;
    steps: readonly {
      id: string;
      position: number;
      kind: "linkedin_invite" | "linkedin_message" | "email" | "whatsapp" | "manual_task";
      delayDays: number;
      windowStart: string | null;
      windowEnd: string | null;
      subject: string | null;
      body: string;
      fallbackKind: "linkedin_invite" | "linkedin_message" | "email" | "whatsapp" | "manual_task" | null;
    }[];
  }) {
    return this.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: sequences.id })
        .from(sequences)
        .where(
          and(
            eq(sequences.workspaceId, input.workspaceId),
            eq(sequences.id, input.sequenceId),
          ),
        )
        .limit(1);
      if (!owned[0]) throw new Error("SEQUENCE_NOT_FOUND");
      await tx
        .delete(sequenceSteps)
        .where(
          and(
            eq(sequenceSteps.workspaceId, input.workspaceId),
            eq(sequenceSteps.sequenceId, input.sequenceId),
          ),
        );
      if (input.steps.length) {
        await tx.insert(sequenceSteps).values(
          input.steps.map((step) => ({
            id: step.id,
            workspaceId: input.workspaceId,
            sequenceId: input.sequenceId,
            position: step.position,
            kind: step.kind,
            delayDays: step.delayDays,
            windowStart: step.windowStart,
            windowEnd: step.windowEnd,
            subject: step.subject,
            body: step.body,
            fallbackKind: step.fallbackKind,
          })),
        );
      }
      await tx
        .update(sequences)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(sequences.workspaceId, input.workspaceId),
            eq(sequences.id, input.sequenceId),
          ),
        );
    });
  }

  async publishVersion(input: {
    id: string;
    workspaceId: string;
    sequenceId: string;
    publishedBy: string;
    publishedAt: Date;
  }) {
    return this.db.transaction(async (tx) => {
      const steps = await tx
        .select()
        .from(sequenceSteps)
        .where(
          and(
            eq(sequenceSteps.workspaceId, input.workspaceId),
            eq(sequenceSteps.sequenceId, input.sequenceId),
          ),
        )
        .orderBy(asc(sequenceSteps.position));
      const current = await tx
        .select({ version: sequenceVersions.version })
        .from(sequenceVersions)
        .where(
          and(
            eq(sequenceVersions.workspaceId, input.workspaceId),
            eq(sequenceVersions.sequenceId, input.sequenceId),
          ),
        )
        .orderBy(desc(sequenceVersions.version))
        .limit(1);
      const version = (current[0]?.version ?? 0) + 1;
      const snapshot = steps.map((step) => ({
        position: step.position,
        kind: step.kind,
        delayDays: step.delayDays,
        windowStart: step.windowStart,
        windowEnd: step.windowEnd,
        subject: step.subject,
        body: step.body,
        fallbackKind: step.fallbackKind,
      }));
      const rows = await tx
        .insert(sequenceVersions)
        .values({
          id: input.id,
          workspaceId: input.workspaceId,
          sequenceId: input.sequenceId,
          version,
          steps: snapshot,
          publishedBy: input.publishedBy,
          publishedAt: input.publishedAt,
        })
        .returning();
      await tx
        .update(sequences)
        .set({ status: "published", updatedAt: input.publishedAt })
        .where(
          and(
            eq(sequences.workspaceId, input.workspaceId),
            eq(sequences.id, input.sequenceId),
          ),
        );
      await tx.insert(outboxEvents).values({
        workspaceId: input.workspaceId,
        aggregateType: "Sequence",
        aggregateId: input.sequenceId,
        eventType: "SequenceVersionPublished",
        payload: { sequenceId: input.sequenceId, versionId: input.id, version },
      });
      return rows[0]!;
    });
  }

  async listVersions(input: { workspaceId: string; sequenceId: string }) {
    return this.db
      .select()
      .from(sequenceVersions)
      .where(
        and(
          eq(sequenceVersions.workspaceId, input.workspaceId),
          eq(sequenceVersions.sequenceId, input.sequenceId),
        ),
      )
      .orderBy(asc(sequenceVersions.version));
  }
}
