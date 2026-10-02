import { Pool, type PoolClient } from 'pg';

const globalDb = globalThis as unknown as { pmsPool?: Pool };
export function database() {
  if (!process.env.DATABASE_URL)
    throw new Error('DATABASE_URL is required. Run npm run local:setup.');
  return (globalDb.pmsPool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    connectionTimeoutMillis: 5000,
    statement_timeout: 15000,
  }));
}
export type Connection = Pick<PoolClient, 'query'>;
export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
