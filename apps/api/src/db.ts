import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.ts';

export type Database = ReturnType<typeof connectDatabase>['db'];

export function connectDatabase(connectionString: string) {
  const client = postgres(connectionString, {
    connect_timeout: 5,
    max: 1,
    prepare: false,
  });

  return {
    db: drizzle(client, { schema }),
    close: () => client.end({ timeout: 5 }),
  };
}
