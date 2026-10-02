import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { database } from '../packages/db';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL!).hostname));
const { accounts, projectId } = JSON.parse(await readFile('local-data/test-accounts.json', 'utf8'));
const db = database();
try {
  const job = (
    await db.query(
      "SELECT j.* FROM job j JOIN project p ON p.current_revision_id=j.target_id WHERE p.id=$1 AND j.kind='revision'",
      [projectId],
    )
  ).rows[0];
  assert.ok(job);
  async function wait(state: string) {
    for (let i = 0; i < 60; i++) {
      const row = (await db.query('SELECT state FROM job WHERE id=$1', [job.id])).rows[0];
      if (row.state === state) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new Error(`Job did not reach ${state}`);
  }
  async function action(action: string) {
    const response = await fetch(
      `${process.env.APP_URL}/api/projects/${projectId}/jobs/${job.id}`,
      {
        method: 'POST',
        headers: {
          Origin: process.env.APP_URL!,
          Cookie: accounts.designer.cookie,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      },
    );
    assert.equal(response.status, 200, await response.text());
  }
  // Simulate a crashed owner's expired lease; the live worker must reclaim it.
  await db.query(
    "UPDATE job SET state='running',attempts=1,lease_token=gen_random_uuid(),lease_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  await wait('succeeded');
  assert.equal(
    (await db.query('SELECT attempts FROM job WHERE id=$1', [job.id])).rows[0].attempts,
    2,
  );
  await db.query(
    "UPDATE job SET state='running',attempts=3,lease_until=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  await wait('failed');
  await action('retry');
  await wait('succeeded');
  await db.query("UPDATE job SET state='queued',available_at=now()+interval '1 hour' WHERE id=$1", [
    job.id,
  ]);
  await action('cancel');
  await wait('cancelled');
  await action('retry');
  await wait('succeeded');
  console.log(
    'PASS: expired lease reclamation, exhausted lease failure, explicit retry and queued cancellation.',
  );
} finally {
  await db.end();
}
