import { sql } from 'drizzle-orm';
import { connectDatabase } from './db.ts';

async function checkDatabase() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('Set DATABASE_URL before running the database check.');
    process.exitCode = 1;
    return;
  }

  try {
    const { db, close } = connectDatabase(connectionString);
    try {
      await db.execute(sql`select 1`);
      console.log('Drizzle connected to Postgres.');
    } finally {
      await close();
    }
  } catch {
    console.error(
      'Database check failed. Verify DATABASE_URL and database reachability.',
    );
    process.exitCode = 1;
  }
}

await checkDatabase();
