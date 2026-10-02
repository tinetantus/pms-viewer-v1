import EmbeddedPostgres from 'embedded-postgres';
import { access } from 'node:fs/promises';

if (process.env.NODE_ENV === 'production')
  throw new Error('Local development database is not a production service.');
const cluster = new EmbeddedPostgres({
  databaseDir: 'local-data/postgres',
  user: 'pms',
  password: process.env.LOCAL_DB_PASSWORD!,
  port: 55432,
  persistent: true,
  authMethod: 'scram-sha-256',
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});
try {
  await access('local-data/postgres/PG_VERSION');
} catch {
  await cluster.initialise();
}
await cluster.start();
const client = cluster.getPgClient();
await client.connect();
if (!(await client.query("SELECT 1 FROM pg_database WHERE datname='pms'")).rowCount)
  await client.query(
    "CREATE DATABASE pms ENCODING 'UTF8' TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'",
  );
await client.end();
console.log('Local PostgreSQL ready on 127.0.0.1:55432. Ctrl+C stops the instance.');
async function stop() {
  await cluster.stop();
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 60_000);
