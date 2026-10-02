import { mkdir, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';

try {
  await access('.env');
  console.log('.env exists; preserving configuration.');
} catch {
  const password = randomBytes(24).toString('hex');
  const python = path
    .resolve(process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python')
    .replaceAll('\\', '/');
  const env = `APP_URL=http://localhost:3000\nDATABASE_URL=postgresql://pms:${password}@127.0.0.1:55432/pms\nLOCAL_DB_PASSWORD=${password}\nAUTH_SECRET=${randomBytes(48).toString('hex')}\nSTORAGE_DRIVER=local\nLOCAL_STORAGE_PATH=${path.resolve('local-data/storage').replaceAll('\\', '/')}\nPROCESSOR_PATH=${path.resolve('services/processor/process.py').replaceAll('\\', '/')}\nPYTHON_EXECUTABLE=${python}\nAI_ENABLED=false\n`;
  await mkdir('local-data', { recursive: true });
  await writeFile('.env', env, { mode: 0o600, flag: 'wx' });
  await writeFile('apps/web/.env.local', env, { mode: 0o600, flag: 'wx' });
  console.log(
    'Created ignored local configuration with random credentials. Start npm run local:db, then npm run db:migrate.',
  );
}
