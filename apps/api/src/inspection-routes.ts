import { MAX_XML_BYTES } from '@vast-tag/vast-core';
import { Router, json } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requireRole } from './auth.ts';
import type { VerifyAccessToken } from './auth.ts';
import type { Database } from './db.ts';
import { promptVersion } from './explainer.ts';
import { explanationErrors } from './explanation-service.ts';
import type { ExplainInspection } from './explanation-service.ts';
import { createInspectionRepository } from './inspection-repository.ts';
import type { InspectionService } from './inspection-service.ts';

const source = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('xml'),
    value: z
      .string()
      .min(1)
      .refine(
        (value) =>
          value.trim().length > 0 &&
          Buffer.byteLength(value, 'utf8') <= MAX_XML_BYTES,
      ),
  }),
  z.strictObject({
    type: z.literal('url'),
    value: z
      .string()
      .trim()
      .max(8192)
      .refine((value) => {
        const url = URL.parse(value);
        return (
          url?.protocol === 'https:' &&
          !url.port &&
          !url.username &&
          !url.password
        );
      }),
  }),
]);
const idSchema = z.uuid();
const pagination = z.strictObject({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(100))
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform(Number)
    .pipe(z.number().int().min(0).max(100_000))
    .optional(),
});

export interface InspectionApi {
  db: Database;
  verifyAccessToken: VerifyAccessToken;
  service: InspectionService;
  explain?: ExplainInspection;
  explanationModel?: string;
}

export function inspectionRoutes({
  db,
  verifyAccessToken,
  service,
  explain,
  explanationModel,
}: InspectionApi) {
  const router = Router();
  const limit = (count: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: count,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      keyGenerator: (_request, response) => response.locals.user.userId,
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
      },
    });
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.use(authenticate(db, verifyAccessToken), limit(120));
  router.post(
    '/',
    requireRole('ad_ops', 'admin'),
    limit(10),
    json({ limit: '2mb' }),
    async (req, res) => {
      const parsed = source.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          error: {
            code: 'INVALID_INPUT',
            message: 'Provide public HTTPS URL or XML as {type, value}.',
          },
        });
        return;
      }
      const { teamId, userId } = res.locals.user;
      const id = await service.submit(
        createInspectionRepository(db, teamId),
        parsed.data,
        userId,
      );
      if (!id) {
        res
          .set('Retry-After', '5')
          .status(503)
          .json({
            error: {
              code: 'QUEUE_FULL',
              message: 'The inspection queue is full.',
            },
          });
        return;
      }
      res.location(`/api/inspections/${id}`).status(202).json({ id });
    },
  );
  router.get('/', async (req, res) => {
    const parsed = pagination.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({
        error: {
          code: 'INVALID_PAGINATION',
          message: 'Provide a valid limit and offset.',
        },
      });
      return;
    }
    const { limit = 20, offset = 0 } = parsed.data;
    const repository = createInspectionRepository(db, res.locals.user.teamId);
    res.json({ items: await repository.list(limit, offset), limit, offset });
  });
  router.get('/access', (_req, res) => {
    res.json({
      role: res.locals.user.role,
      explanationsAvailable: Boolean(explain),
      explanationModel: explanationModel ?? null,
      explanationPromptVersion: explain ? promptVersion : null,
    });
  });
  router.post(
    '/:id/explain',
    requireRole('ad_ops', 'admin'),
    limit(5),
    async (req, res) => {
      const id = idSchema.safeParse(req.params.id);
      if (!id.success) {
        res.status(404).json({
          error: {
            code: 'NOT_FOUND',
            message: explanationErrors.NOT_FOUND.message,
          },
        });
        return;
      }
      if (!explain) {
        res.status(503).json({
          error: {
            code: 'EXPLAIN_DISABLED',
            message: 'Explanations are unavailable.',
          },
        });
        return;
      }
      const { teamId } = res.locals.user;
      const result = await explain(
        createInspectionRepository(db, teamId),
        teamId,
        id.data,
      );
      if ('code' in result && result.code) {
        const error = explanationErrors[result.code];
        res
          .status(error.status)
          .json({ error: { code: result.code, message: error.message } });
        return;
      }
      res.json(result);
    },
  );
  router.get('/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const repository = createInspectionRepository(db, res.locals.user.teamId);
    const inspection = id.success ? await repository.get(id.data) : null;
    if (!inspection) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Inspection not found.' },
      });
      return;
    }
    res.json(inspection);
  });
  router.delete('/:id', requireRole('admin'), async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const repository = createInspectionRepository(db, res.locals.user.teamId);
    if (!id.success || !(await repository.delete(id.data))) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Inspection not found.' },
      });
      return;
    }
    res.status(204).end();
  });
  return router;
}
