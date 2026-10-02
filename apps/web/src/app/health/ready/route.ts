import { database } from '../../../../../../packages/db';
import { storageReady } from '@/lib/storage';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    await database().query('SELECT 1 FROM schema_migration LIMIT 1');
    await storageReady();
    return Response.json({ status: 'ready' });
  } catch {
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
}
