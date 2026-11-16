import { MAX_XML_BYTES } from '@vast-tag/vast-core';
import { Router, json } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
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

export function inspectionRoutes(service: InspectionService) {
  const router = Router();
  const limit = (count: number) =>
    rateLimit({
      windowMs: 60_000,
      limit: count,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      message: {
        error: { code: 'RATE_LIMITED', message: 'Too many requests.' },
      },
    });
  router.use(limit(120));
  router.post('/', limit(10), json({ limit: '2mb' }), async (req, res) => {
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
    const id = await service.submit(parsed.data);
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
  });
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
    res.json({ items: await service.list(limit, offset), limit, offset });
  });
  router.get('/:id', async (req, res) => {
    const id = idSchema.safeParse(req.params.id);
    const inspection = id.success ? await service.get(id.data) : null;
    if (!inspection) {
      res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Inspection not found.' },
      });
      return;
    }
    res.json(inspection);
  });
  return router;
}
