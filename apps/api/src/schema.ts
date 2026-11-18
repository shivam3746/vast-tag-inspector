import { relations, sql } from 'drizzle-orm';
import {
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { Explanation } from './explainer.ts';

export const schema = pgSchema('vast_inspector');
export const status = schema.enum('inspection_status', [
  'queued',
  'running',
  'done',
  'failed',
]);
export const sourceType = schema.enum('source_type', ['url', 'xml']);
export const hopKind = schema.enum('hop_kind', [
  'wrapper',
  'inline',
  'empty',
  'error',
]);
export const severity = schema.enum('finding_severity', [
  'info',
  'warning',
  'error',
]);
export const teamRole = schema.enum('team_role', ['admin', 'ad_ops', 'viewer']);

export const teams = schema.table('teams', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const profiles = schema.table(
  'profiles',
  {
    userId: uuid('user_id').primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    role: teamRole().notNull().default('viewer'),
  },
  (table) => [index('profiles_team').on(table.teamId)],
);

export const inspections = schema.table(
  'inspections',
  {
    id: uuid().defaultRandom().primaryKey(),
    teamId: uuid('team_id')
      .notNull()
      .references(() => teams.id),
    createdBy: uuid('created_by'),
    sourceType: sourceType('source_type').notNull(),
    sourceRef: text('source_ref').notNull(),
    status: status().default('queued').notNull(),
    errorCode: text('error_code'),
    hopCount: integer('hop_count').default(0).notNull(),
    totalLatencyMs: integer('total_latency_ms').default(0).notNull(),
    maxSeverity: text('max_severity', {
      enum: ['none', 'info', 'warning', 'error'],
    })
      .default('none')
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (table) => [
    index('inspections_team_history').on(
      table.teamId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('inspections_pending_age')
      .on(table.createdAt)
      .where(sql`${table.status} in ('queued', 'running')`),
    check(
      'inspections_max_severity_check',
      sql`${table.maxSeverity} in ('none', 'info', 'warning', 'error')`,
    ),
  ],
);

export const hops = schema.table(
  'hops',
  {
    id: uuid().defaultRandom().primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    index: integer('idx').notNull(),
    httpStatus: integer('http_status'),
    latencyMs: integer('latency_ms').notNull(),
    kind: hopKind().notNull(),
    vastVersion: text('vast_version'),
    urlOrigin: text('url_origin'),
    xmlPreview: text('xml_preview'),
    errorCode: text('error_code'),
  },
  (table) => [
    unique().on(table.inspectionId, table.index),
    check(
      'hops_xml_preview_size',
      sql`octet_length(${table.xmlPreview}) <= 16384`,
    ),
  ],
);

export const findings = schema.table(
  'findings',
  {
    id: uuid().defaultRandom().primaryKey(),
    inspectionId: uuid('inspection_id')
      .notNull()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    hopId: uuid('hop_id').references(() => hops.id, { onDelete: 'cascade' }),
    index: integer('idx').notNull(),
    ruleId: text('rule_id').notNull(),
    severity: severity().notNull(),
    message: text().notNull(),
  },
  (table) => [unique().on(table.inspectionId, table.index)],
);

export const explanations = schema.table(
  'explanations',
  {
    inspectionId: uuid('inspection_id')
      .primaryKey()
      .references(() => inspections.id, { onDelete: 'cascade' }),
    cacheKey: text('cache_key').notNull(),
    model: text().notNull(),
    promptVersion: text('prompt_version').notNull(),
    output: jsonb().$type<Explanation>().notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    costUsd: doublePrecision('cost_usd'),
    latencyMs: integer('latency_ms').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [index('explanations_cache_key').on(table.cacheKey)],
);

export const inspectionRelations = relations(inspections, ({ many, one }) => ({
  hops: many(hops),
  findings: many(findings),
  explanation: one(explanations),
}));
export const explanationRelations = relations(explanations, ({ one }) => ({
  inspection: one(inspections, {
    fields: [explanations.inspectionId],
    references: [inspections.id],
  }),
}));
export const hopRelations = relations(hops, ({ one }) => ({
  inspection: one(inspections, {
    fields: [hops.inspectionId],
    references: [inspections.id],
  }),
}));
export const findingRelations = relations(findings, ({ one }) => ({
  inspection: one(inspections, {
    fields: [findings.inspectionId],
    references: [inspections.id],
  }),
}));
