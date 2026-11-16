import { createApp } from './app.ts';
import { connectDatabase } from './db.ts';
import {
  createInspectionRepository,
  initializeLocalTeam,
  LOCAL_TEAM_ID,
} from './inspection-repository.ts';
import { createInspectionService } from './inspection-service.ts';

const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? '3000');

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

async function start() {
  const connectionString = process.env.DATABASE_URL;
  const local = host === '127.0.0.1' || host === '::1';
  const connection =
    connectionString && local ? connectDatabase(connectionString) : null;
  try {
    const repository = connection
      ? createInspectionRepository(connection.db, LOCAL_TEAM_ID)
      : null;
    if (connection && repository) {
      await initializeLocalTeam(connection.db);
      await repository.recoverInterrupted();
    }
    const app = createApp(
      repository ? createInspectionService(repository) : undefined,
    );
    app.listen(port, host, () => {
      console.log(`VAST Tag Inspector API listening on http://${host}:${port}`);
    });
  } catch {
    if (connection) await connection.close();
    console.error(
      'Could not initialize the inspection database. Check DATABASE_URL and run npm run db:migrate.',
    );
    process.exitCode = 1;
  }
}

await start();
