import { readFile, readdir } from 'node:fs/promises';
import { getMigrations } from 'better-auth/db/migration';
import { auth } from '../apps/web/src/lib/auth';
import { database, transaction } from '../packages/db';

await (await getMigrations(auth().options)).runMigrations();
await transaction(async (db) => {
  await db.query('SELECT pg_advisory_xact_lock(416302)');
  await db.query(
    'CREATE TABLE IF NOT EXISTS schema_migration (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
  );
  for (const name of (await readdir('packages/db/migrations'))
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    if ((await db.query('SELECT 1 FROM schema_migration WHERE name=$1', [name])).rowCount) continue;
    await db.query(await readFile(`packages/db/migrations/${name}`, 'utf8'));
    await db.query('INSERT INTO schema_migration(name) VALUES($1)', [name]);
    console.log(`Applied ${name}`);
  }
});
await database().end();
