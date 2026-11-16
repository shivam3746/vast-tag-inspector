import { join } from 'node:path';
import express from 'express';
import type { ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { inspectionRoutes } from './inspection-routes.ts';
import type { InspectionApi } from './inspection-routes.ts';

interface BrowserConfig {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export function createApp(
  inspections?: InspectionApi,
  { directory, config }: { directory?: string; config?: BrowserConfig } = {},
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet(
      config
        ? {
            contentSecurityPolicy: {
              directives: {
                connectSrc: ["'self'", new URL(config.supabaseUrl).origin],
              },
            },
          }
        : {},
    ),
  );

  app.get('/api/health', (_request, response) => {
    response.json({ status: 'ok' });
  });
  app.get('/api/config', (_request, response) => {
    response.set('Cache-Control', 'no-store');
    if (config) {
      response.json(config);
    } else {
      response.status(503).json({
        error: {
          code: 'APP_NOT_CONFIGURED',
          message: 'Set up Supabase Auth and its publishable key to sign in.',
        },
      });
    }
  });

  if (inspections) app.use('/api/inspections', inspectionRoutes(inspections));
  if (directory) {
    app.get('/', (_request, response) =>
      response.sendFile(join(directory, 'index.html')),
    );
    app.use(
      '/assets',
      express.static(join(directory, 'assets'), {
        maxAge: '1y',
        immutable: true,
      }),
    );
  } else {
    app.get('/', (_request, response) => response.json({ status: 'ok' }));
  }
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
