import { createHash } from 'node:crypto';
import type { Connection } from './index';
import type { Geometry } from '../domain';
export async function enqueueComparison(
  db: Connection,
  projectId: string,
  before: { id: string; sha256: string },
  after: { id: string; sha256: string },
  actor: string,
  exclusions: { page: number; geometry: Geometry }[] = [],
  pageMap: { before: number; after: number }[] = [],
) {
  const config = {
    before_id: before.id,
    after_id: after.id,
    exclusions,
    page_map: pageMap,
    algorithm: 'pixel-regions-v1',
    before_sha: before.sha256,
    after_sha: after.sha256,
    exclude_native_annotations: true,
    ai_enabled: process.env.AI_ENABLED === 'true',
    ai_provider: process.env.AI_PROVIDER || null,
    ai_model: process.env.AI_MODEL || null,
    prompt_version: 'packaging-evidence-v1',
  };
  const key = createHash('sha256').update(JSON.stringify({ projectId, config })).digest('hex');
  const comparisonId = crypto.randomUUID();
  const result = await db.query(
    'INSERT INTO comparison(id,project_id,before_id,after_id,config,created_by,run_key) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(run_key) DO NOTHING RETURNING id',
    [comparisonId, projectId, before.id, after.id, JSON.stringify(config), actor, key],
  );
  if (!result.rowCount)
    return (await db.query('SELECT id FROM comparison WHERE run_key=$1', [key])).rows[0]
      .id as string;
  await db.query("INSERT INTO job(id,project_id,target_id,kind) VALUES($1,$2,$3,'comparison')", [
    crypto.randomUUID(),
    projectId,
    comparisonId,
  ]);
  return comparisonId;
}
