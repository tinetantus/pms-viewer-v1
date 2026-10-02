import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { database, transaction } from '../../packages/db';
import { enqueueComparison } from '../../packages/db/jobs';
import { getObject, putObject } from '../web/src/lib/storage';
import type { Finding, PageInfo } from '../../packages/domain';
import { describeChanges, type AiResult } from '../../packages/domain/ai';
import { proposeAnchor, type MappingTransform } from '../../packages/viewer/mapping';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});
type Job = {
  id: string;
  project_id: string;
  target_id: string;
  kind: string;
  attempts: number;
  lease_token: string;
};
async function claim(): Promise<Job | undefined> {
  return transaction(async (db) => {
    const exhausted = await db.query(
      "UPDATE job SET state='failed',lease_until=NULL,error='Worker lease expired after three attempts.' WHERE state='running' AND lease_until<now() AND attempts>=3 RETURNING target_id,kind",
    );
    for (const job of exhausted.rows)
      await db.query(
        `UPDATE ${job.kind === 'revision' ? 'revision' : 'comparison'} SET state='failed',error='Worker lease expired after three attempts.' WHERE id=$1`,
        [job.target_id],
      );
    const result =
      await db.query(`WITH candidate AS (SELECT id FROM job WHERE (state='queued' AND available_at<=now()) OR (state='running' AND lease_until<now()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE job SET state='running',attempts=attempts+1,lease_token=gen_random_uuid(),lease_until=now()+interval '90 seconds',progress=10 WHERE id IN (SELECT id FROM candidate) RETURNING *`);
    return result.rows[0];
  });
}
async function processJob(job: Job) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'pms-'));
  const heartbeat = setInterval(() => {
    void database()
      .query(
        "UPDATE job SET lease_until=now()+interval '90 seconds' WHERE id=$1 AND lease_token=$2 AND state='running'",
        [job.id, job.lease_token],
      )
      .catch(() => undefined);
  }, 20000);
  try {
    const request: Record<string, unknown> = { kind: job.kind, output: path.join(tmp, 'output') };
    const entity = (
      await database().query(
        `SELECT * FROM ${job.kind === 'revision' ? 'revision' : 'comparison'} WHERE id=$1`,
        [job.target_id],
      )
    ).rows[0];
    if (job.kind === 'revision') {
      await database().query("UPDATE revision SET state='processing' WHERE id=$1", [job.target_id]);
      request.source = path.join(tmp, 'source');
      await writeFile(request.source as string, await getObject(entity.object_key));
    } else {
      await database().query("UPDATE comparison SET state='running' WHERE id=$1", [job.target_id]);
      for (const side of ['before', 'after']) {
        const revision = (
          await database().query('SELECT object_key FROM revision WHERE id=$1 AND project_id=$2', [
            entity[`${side}_id`],
            job.project_id,
          ])
        ).rows[0];
        request[side] = path.join(tmp, side);
        await writeFile(request[side] as string, await getObject(revision.object_key));
      }
      request.config = entity.config;
    }
    const input = path.join(tmp, 'request.json');
    await writeFile(input, JSON.stringify(request));
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        process.env.PYTHON_EXECUTABLE || 'python',
        [process.env.PROCESSOR_PATH || path.resolve('services/processor/process.py'), input],
        {
          windowsHide: true,
          stdio: ['ignore', 'ignore', 'pipe'],
          env: {
            PATH: process.env.PATH,
            SystemRoot: process.env.SystemRoot,
            WINDIR: process.env.WINDIR,
            TEMP: tmp,
            TMP: tmp,
            PDF_MAX_PAGES: process.env.PDF_MAX_PAGES || '50',
            PYTHONUTF8: '1',
          },
        },
      );
      let error = '';
      child.stderr.on('data', (chunk) => {
        if (error.length < 2000) error += chunk.toString();
      });
      const timer = setTimeout(
        () => {
          child.kill('SIGKILL');
        },
        Number(process.env.RENDER_TIMEOUT_SECONDS || 120) * 1000,
      );
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(error.trim() || 'Processing timed out or was interrupted.'));
      });
    });
    const output = path.join(tmp, 'output');
    const result = JSON.parse(await readFile(path.join(output, 'result.json'), 'utf8'));
    if (job.kind === 'comparison') {
      for (const finding of result.findings) finding.id = crypto.randomUUID();
      let ai: AiResult = {
        status: 'disabled',
        suggestions: [],
        prompt_version: 'packaging-evidence-v1',
        elapsed_ms: 0,
      };
      if (entity.config.ai_enabled) {
        const permitted =
          process.env.AI_ENABLED === 'true' && process.env.AI_ARTWORK_POLICY_ACCEPTED === 'true';
        const reserved =
          permitted &&
          (await transaction(async (db) => {
            await db.query('SELECT pg_advisory_xact_lock(416304)');
            const count = (
              await db.query(
                "SELECT count(*)::int n FROM ai_usage WHERE created_at>now()-interval '24 hours'",
              )
            ).rows[0].n;
            if (count >= Math.max(0, Number(process.env.AI_MAX_CALLS_PER_DAY || 0))) return false;
            return Boolean(
              (
                await db.query(
                  'INSERT INTO ai_usage(comparison_id,provider,model) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING comparison_id',
                  [
                    job.target_id,
                    entity.config.ai_provider || 'unconfigured',
                    entity.config.ai_model || 'unconfigured',
                  ],
                )
              ).rowCount,
            );
          }));
        if (reserved) {
          const regions = [];
          for (const finding of (result.findings as Finding[])
            .filter((f) => f.evidence.before_crop && f.evidence.after_crop)
            .slice(0, 12)) {
            const before = await readFile(path.join(output, finding.evidence.before_crop!)),
              after = await readFile(path.join(output, finding.evidence.after_crop!));
            if (before.length + after.length <= 2_000_000)
              regions.push({ id: finding.id, before, after });
          }
          const issues = (
            await database().query(
              'SELECT id,title,description FROM issue WHERE project_id=$1 ORDER BY updated_at DESC LIMIT 30',
              [job.project_id],
            )
          ).rows;
          ai = await describeChanges(
            {
              enabled: true,
              policyAccepted: permitted,
              provider: entity.config.ai_provider,
              model: entity.config.ai_model,
              apiKey: process.env.AI_API_KEY,
              maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 2000),
            },
            regions,
            issues,
          );
          await database().query(
            'UPDATE ai_usage SET state=$2,metadata=$3 WHERE comparison_id=$1',
            [job.target_id, ai.status, JSON.stringify({ ...ai, suggestions: undefined })],
          );
          for (const suggestion of ai.suggestions) {
            const finding = result.findings.find((f: Finding) => f.id === suggestion.region_id);
            if (finding) finding.evidence.ai = suggestion;
          }
        } else
          ai = {
            ...ai,
            status: 'failed',
            error:
              'AI is disabled, consent is missing, or the daily call budget has been reached; interrupted calls are not automatically repeated.',
          };
      }
      result.coverage.ai = { ...ai, suggestions: undefined };
    }
    // Attempt-specific immutable keys prevent a stale worker from overwriting current evidence.
    const prefix = `${job.project_id}/generated/${job.target_id}/${job.lease_token}`;
    for (const file of await readdir(output))
      if (file.endsWith('.png'))
        await putObject(`${prefix}/${file}`, await readFile(path.join(output, file)), 'image/png');
    await transaction(async (db) => {
      await db.query('SELECT id FROM project WHERE id=$1 FOR UPDATE', [job.project_id]);
      const owned = await db.query(
        "SELECT 1 FROM job WHERE id=$1 AND lease_token=$2 AND state='running' AND lease_until>now() FOR UPDATE",
        [job.id, job.lease_token],
      );
      if (!owned.rowCount) return;
      if (job.kind === 'revision') {
        const pages = result.pages.map((p: PageInfo) => ({
          ...p,
          thumbnail: `${prefix}/${p.thumbnail}`,
        }));
        await db.query("UPDATE revision SET state='ready',pages=$2,error=NULL WHERE id=$1", [
          job.target_id,
          JSON.stringify(pages),
        ]);
        const previous = (
          await db.query(
            "SELECT id,sha256 FROM revision WHERE project_id=$1 AND sequence<$2 AND state='ready' ORDER BY sequence DESC LIMIT 1",
            [job.project_id, entity.sequence],
          )
        ).rows[0];
        if (previous)
          await enqueueComparison(db, job.project_id, previous, entity, entity.uploaded_by);
      } else {
        const anchors = (
          await db.query(
            "SELECT * FROM anchor WHERE project_id=$1 AND revision_id=$2 AND state IN ('original','confirmed')",
            [job.project_id, entity.before_id],
          )
        ).rows;
        for (const anchor of anchors) {
          const transform = (result.coverage.transforms as MappingTransform[]).find(
            (t) => t.before === anchor.page,
          );
          const proposed = transform ? proposeAnchor(anchor.geometry, transform) : null;
          if (proposed && transform)
            await db.query(
              "INSERT INTO anchor(id,project_id,issue_id,revision_id,page,geometry,state,created_by,source_anchor_id,confidence,evidence) VALUES($1,$2,$3,$4,$5,$6,'proposed',$7,$8,$9,$10) ON CONFLICT(issue_id,revision_id) DO NOTHING",
              [
                crypto.randomUUID(),
                job.project_id,
                anchor.issue_id,
                entity.after_id,
                transform.after,
                JSON.stringify(proposed),
                entity.created_by,
                anchor.id,
                transform.confidence,
                JSON.stringify({ comparison_id: job.target_id, transform }),
              ],
            );
        }
        await db.query('DELETE FROM finding WHERE comparison_id=$1', [job.target_id]);
        for (const f of result.findings as Finding[]) {
          const evidence = {
            ...f.evidence,
            before_crop: f.evidence.before_crop ? `${prefix}/${f.evidence.before_crop}` : undefined,
            after_crop: f.evidence.after_crop ? `${prefix}/${f.evidence.after_crop}` : undefined,
          };
          await db.query(
            'INSERT INTO finding(id,project_id,comparison_id,page,geometry,kind,evidence) VALUES($1,$2,$3,$4,$5,$6,$7)',
            [
              f.id,
              job.project_id,
              job.target_id,
              f.page,
              JSON.stringify(f.geometry),
              f.kind,
              JSON.stringify(evidence),
            ],
          );
        }
        await db.query('UPDATE comparison SET state=$2,coverage=$3,error=NULL WHERE id=$1', [
          job.target_id,
          result.state,
          JSON.stringify(result.coverage),
        ]);
      }
      await db.query(
        "UPDATE job SET state='succeeded',progress=100,lease_until=NULL,error=NULL WHERE id=$1",
        [job.id],
      );
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Processing failed';
    await transaction(async (db) => {
      const owned = await db.query(
        "SELECT 1 FROM job WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE",
        [job.id, job.lease_token],
      );
      if (!owned.rowCount) return;
      const retry = job.attempts < 3;
      await db.query(
        "UPDATE job SET state=$2,error=$3,lease_until=NULL,available_at=now()+interval '15 seconds' WHERE id=$1",
        [job.id, retry ? 'queued' : 'failed', message],
      );
      await db.query(
        `UPDATE ${job.kind === 'revision' ? 'revision' : 'comparison'} SET state=$2,error=$3 WHERE id=$1`,
        [job.target_id, retry ? 'queued' : 'failed', message],
      );
    });
    console.error(JSON.stringify({ job: job.id, stage: 'processing', status: 'failed' }));
  } finally {
    clearInterval(heartbeat);
    const resolved = path.resolve(tmp),
      root = path.resolve(os.tmpdir()) + path.sep;
    if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('pms-'))
      throw new Error('Refusing unsafe temporary directory cleanup');
    await rm(resolved, { recursive: true, force: true });
  }
}
console.log('Packaging worker ready.');
while (!stopping) {
  try {
    const job = await claim();
    if (job) await processJob(job);
    else await new Promise((r) => setTimeout(r, 1000));
  } catch {
    console.error(JSON.stringify({ stage: 'queue', status: 'unavailable' }));
    await new Promise((r) => setTimeout(r, 5000));
  }
}
await database().end();
