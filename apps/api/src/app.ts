import express from 'express';
import type { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { inspectionRoutes } from './inspection-routes.ts';
import type { InspectionService } from './inspection-service.ts';

export function createApp(service?: InspectionService) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());

  app.get(['/', '/api/health'], (_request, response) => {
    response.json({ status: 'ok' });
  });

  if (service) app.use('/api/inspections', inspectionRoutes(service));
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
