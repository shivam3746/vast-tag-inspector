import type { Chain, Finding, InspectionSource } from '@vast-tag/vast-core';
import { and, asc, desc, eq, inArray, lt } from 'drizzle-orm';
import type { Database } from './db.ts';
import { findings, hops, inspections } from './schema.ts';

export async function recoverExpiredInspections(db: Database, cutoff: Date) {
  await db
    .update(inspections)
    .set({
      status: 'failed',
      errorCode: 'JOB_EXPIRED',
      finishedAt: new Date(),
    })
    .where(
      and(
        lt(inspections.createdAt, cutoff),
        inArray(inspections.status, ['queued', 'running']),
      ),
    );
}

export function createInspectionRepository(db: Database, teamId: string) {
  const scope = eq(inspections.teamId, teamId);
  const byId = (id: string) => and(scope, eq(inspections.id, id));

  return {
    async create(source: InspectionSource, createdBy: string) {
      const sourceRef =
        source.type === 'url' ? new URL(source.value).origin : 'Pasted XML';
      const [row] = await db
        .insert(inspections)
        .values({ teamId, createdBy, sourceType: source.type, sourceRef })
        .returning({ id: inspections.id });
      if (!row) throw new Error('Inspection insert returned no ID.');
      return row.id;
    },
    async start(id: string) {
      const rows = await db
        .update(inspections)
        .set({ status: 'running' })
        .where(and(byId(id), eq(inspections.status, 'queued')))
        .returning({ id: inspections.id });
      return rows.length === 1;
    },
    async finish(id: string, chain: Chain, issues: Finding[]) {
      const error = chain.outcome.kind === 'error' ? chain.outcome : null;
      const maxSeverity = issues.some(({ severity }) => severity === 'error')
        ? 'error'
        : issues.length
          ? 'warning'
          : 'none';
      await db.transaction(async (tx) => {
        const rows = await tx
          .update(inspections)
          .set({
            status: error ? 'failed' : 'done',
            errorCode: error?.code ?? null,
            hopCount: chain.hops.length,
            totalLatencyMs: Math.round(
              chain.hops.reduce((total, hop) => total + hop.latencyMs, 0),
            ),
            maxSeverity,
            finishedAt: new Date(),
          })
          .where(and(byId(id), eq(inspections.status, 'running')))
          .returning({ id: inspections.id });
        if (!rows.length) return;

        const hopRows: (typeof hops.$inferInsert)[] = chain.hops.map(
          (hop, index) => ({
            inspectionId: id,
            index,
            latencyMs: Math.round(hop.latencyMs),
            httpStatus: hop.status,
            vastVersion: hop.document?.version ?? null,
            kind: hop.document
              ? (hop.document.ads[0]?.kind ?? 'empty')
              : chain.outcome.kind === 'empty'
                ? 'empty'
                : 'error',
            errorCode: error?.hopIndex === index ? error.code : null,
          }),
        );
        const savedHops = hopRows.length
          ? await tx
              .insert(hops)
              .values(hopRows)
              .returning({ id: hops.id, index: hops.index })
          : [];
        const hopIds = new Map(savedHops.map((hop) => [hop.index, hop.id]));
        if (issues.length) {
          await tx.insert(findings).values(
            issues.map((finding, index) => ({
              inspectionId: id,
              hopId:
                finding.hopIndex === null
                  ? null
                  : (hopIds.get(finding.hopIndex) ?? null),
              index,
              ruleId: finding.ruleId,
              severity: finding.severity,
              message: finding.message,
            })),
          );
        }
      });
    },
    async fail(id: string, errorCode: string) {
      await db
        .update(inspections)
        .set({ status: 'failed', errorCode, finishedAt: new Date() })
        .where(
          and(byId(id), inArray(inspections.status, ['queued', 'running'])),
        );
    },
    async delete(id: string) {
      const rows = await db
        .delete(inspections)
        .where(byId(id))
        .returning({ id: inspections.id });
      return rows.length === 1;
    },
    async list(limit: number, offset: number) {
      return db
        .select()
        .from(inspections)
        .where(scope)
        .orderBy(desc(inspections.createdAt), desc(inspections.id))
        .limit(limit)
        .offset(offset);
    },
    async get(id: string) {
      return db.query.inspections.findFirst({
        where: byId(id),
        with: {
          hops: { orderBy: asc(hops.index) },
          findings: { orderBy: asc(findings.index) },
        },
      });
    },
  };
}

export type InspectionRepository = ReturnType<
  typeof createInspectionRepository
>;
