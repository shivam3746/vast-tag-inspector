import express from 'express';
import type { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { inspectionRoutes } from './inspection-routes.ts';
import type { InspectionApi } from './inspection-routes.ts';

export function createApp(inspections?: InspectionApi) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());

  app.get(['/', '/api/health'], (_request, response) => {
    response.json({ status: 'ok' });
  });

  if (inspections) app.use('/api/inspections', inspectionRoutes(inspections));
  app.use((_request, response) => {
    response
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found.' } });
  });

  const handleError: ErrorRequestHandler = (
    error: unknown,
    _request,
    response,
    next,
  ) => {
    if (response.headersSent) return next(error);
    const type = error instanceof Error && 'type' in error ? error.type : null;
    if (type === 'entity.too.large') {
      response.status(413).json({
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Request body exceeds the limit.',
        },
      });
    } else if (type === 'entity.parse.failed') {
      response.status(400).json({
        error: {
          code: 'INVALID_JSON',
          message: 'Request body is not valid JSON.',
        },
      });
    } else {
      response.status(500).json({
        error: { code: 'INTERNAL_ERROR', message: 'The request failed.' },
      });
    }
  };
  app.use(handleError);

  return app;
}
