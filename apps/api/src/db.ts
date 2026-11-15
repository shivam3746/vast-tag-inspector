import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

export function connectDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    connect_timeout: 5,
    max: 1,
    prepare: false,
  });

  return {
    db: drizzle(client),
    close: () => client.end({ timeout: 5 }),
  };
}
