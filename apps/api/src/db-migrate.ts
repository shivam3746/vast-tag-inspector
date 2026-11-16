import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { connectDatabase } from './db.ts';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Set DATABASE_URL before running migrations.');
  process.exitCode = 1;
} else {
  const { db, close } = connectDatabase(connectionString);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(
        new URL('../../../drizzle/', import.meta.url),
      ),
    });
    console.log('Database migrations applied.');
  } catch {
    console.error(
      'Database migration failed. Verify the database connection and migration privileges.',
    );
    process.exitCode = 1;
  } finally {
    await close();
  }
}
