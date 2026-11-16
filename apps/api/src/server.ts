import { createApp } from './app.ts';
import { createSupabaseVerifier } from './auth.ts';
import { connectDatabase } from './db.ts';
import { recoverExpiredInspections } from './inspection-repository.ts';
import type { InspectionApi } from './inspection-routes.ts';
import { createInspectionService } from './inspection-service.ts';
import { profiles } from './schema.ts';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '3000');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

async function start() {
  const connectionString = process.env.DATABASE_URL?.trim();
  const projectUrl = process.env.SUPABASE_URL?.trim();
  let closeDatabase: (() => Promise<void>) | undefined;
  try {
    let inspectionApi: InspectionApi | undefined;
    if (projectUrl) {
      if (!connectionString)
        throw new Error(
          'DATABASE_URL is required when SUPABASE_URL is configured.',
        );
      const verifyAccessToken = createSupabaseVerifier(projectUrl);
      const { db, close } = connectDatabase(connectionString);
      closeDatabase = close;
      await db.select({ userId: profiles.userId }).from(profiles).limit(1);
      const recover = () =>
        recoverExpiredInspections(db, new Date(Date.now() - 15 * 60_000));
      await recover();
      setInterval(() => {
        void recover().catch(() =>
          console.error('Could not recover expired inspections.'),
        );
      }, 60_000).unref();
      inspectionApi = {
        db,
        verifyAccessToken,
        service: createInspectionService(),
      };
    }
    createApp(inspectionApi).listen(port, host, () => {
      console.log(`VAST Tag Inspector API listening on http://${host}:${port}`);
    });
  } catch {
    if (closeDatabase) await closeDatabase();
    console.error(
      'Could not initialize inspections. Check SUPABASE_URL and DATABASE_URL and run npm run db:migrate.',
    );
    process.exitCode = 1;
  }
}

await start();
