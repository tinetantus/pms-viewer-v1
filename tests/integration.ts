import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { hashPassword } from 'better-auth/crypto';
import { database, transaction } from '../packages/db';
import type { Workspace } from '../packages/domain';

if (!new URL(process.env.DATABASE_URL!).hostname.match(/^(localhost|127\.0\.0\.1)$/))
  throw new Error('Integration fixtures require a local database.');
const base = process.env.APP_URL!;
const suffix = randomBytes(4).toString('hex');
const password = randomBytes(20).toString('hex');
const accounts: Record<string, { id: string; email: string; password: string; cookie: string }> =
  {};
await transaction(async (db) => {
  const org = crypto.randomUUID();
  await db.query('INSERT INTO organization(id,name) VALUES($1,$2)', [
    org,
    'Synthetic test workspace',
  ]);
  for (const role of ['administrator', 'designer', 'marketing', 'qa', 'outsider']) {
    const userId = crypto.randomUUID(),
      email = `${role}-${suffix}@example.test`;
    await db.query(
      'INSERT INTO "user"(id,name,email,"emailVerified","createdAt","updatedAt") VALUES($1,$2,$3,true,now(),now())',
      [userId, `${role[0]!.toUpperCase() + role.slice(1)} Tester`, email],
    );
    await db.query(
      'INSERT INTO account(id,"accountId","providerId","userId",password,"createdAt","updatedAt") VALUES($1,$2,\'credential\',$2,$3,now(),now())',
      [crypto.randomUUID(), userId, await hashPassword(password)],
    );
    await db.query('INSERT INTO member(user_id,organization_id,role) VALUES($1,$2,$3)', [
      userId,
      org,
      ['marketing', 'qa', 'outsider'].includes(role) ? 'reviewer' : role,
    ]);
    accounts[role] = { id: userId, email, password, cookie: '' };
  }
});
async function request(
  actor: string,
  path: string,
  body?: unknown,
  expected = 200,
  method?: string,
) {
  const response = await fetch(`${base}/api/${path}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      Origin: base,
      ...(accounts[actor]?.cookie ? { Cookie: accounts[actor]!.cookie } : {}),
      ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (Buffer.isBuffer(body) ? new Uint8Array(body) : JSON.stringify(body)) : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, expected, `${path}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
for (const [actor, account] of Object.entries(accounts)) {
  const login = () =>
    fetch(`${base}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: base },
      body: JSON.stringify({ email: account.email, password }),
    });
  let response = await login();
  while (response.status === 429) {
    const seconds = Math.min(60, Math.max(1, Number(response.headers.get('retry-after')) || 10));
    console.log(`Authentication limiter: respecting ${seconds}s retry interval`);
    await new Promise((resolve) => setTimeout(resolve, (seconds + 1) * 1000));
    response = await login();
  }
  assert.equal(response.status, 200, await response.text());
  account.cookie = response.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  assert.ok(account.cookie);
  await request(actor, 'me');
  // Exercise the production auth limiter without bypassing it (three sign-ins per ten seconds).
  await new Promise((resolve) => setTimeout(resolve, 4000));
}
console.log('PASS: real session authentication');
await request('anonymous', 'projects', undefined, 401);
await request(
  'anonymous',
  'auth/sign-up/email',
  { email: `public-${suffix}@example.test`, password, name: 'Public' },
  400,
);
const project = await request('administrator', 'projects', {
  name: 'Synthetic packaging proof',
  sku: `TEST-${suffix}`,
  product: 'Cereal drink',
  market: 'Thailand',
  language: 'Thai / English',
  pack_size: '180 ml',
});
const pid = project.id;
const workspace = () => request('administrator', `projects/${pid}`) as Promise<Workspace>;
for (const [actor, designer, reviewer, scopes] of [
  ['designer', true, true, []],
  ['marketing', false, true, ['marketing']],
  ['qa', false, true, ['qa']],
] as const) {
  const state = await workspace();
  await request('administrator', `projects/${pid}/members`, {
    user_id: accounts[actor]!.id,
    designer,
    reviewer,
    scopes,
    version: state.project.version,
  });
}
await request('outsider', `projects/${pid}`, undefined, 404);
const csrf = await fetch(`${base}/api/projects`, {
  method: 'POST',
  headers: {
    Cookie: accounts.administrator!.cookie,
    'Content-Type': 'application/json',
    Origin: 'https://untrusted.example',
  },
  body: JSON.stringify({ name: 'CSRF' }),
});
assert.equal(csrf.status, 403);
console.log('PASS: invite-only signup, project access and CSRF checks');
async function upload(file: string) {
  const bytes = await readFile(file);
  const intent = await request('designer', `projects/${pid}/uploads`, {
    filename: file.split('/').pop(),
    byte_size: bytes.length,
    notes: 'Synthetic test revision',
  });
  await request('designer', `projects/${pid}/uploads/${intent.id}`, bytes, 200, 'PUT');
  const results = await Promise.all([
    request('designer', `projects/${pid}/uploads/${intent.id}/finalize`, {}),
    request('designer', `projects/${pid}/uploads/${intent.id}/finalize`, {}),
  ]);
  assert.equal(results[0].id, results[1].id);
  return results[0].id as string;
}
async function ready(revisionId: string) {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    const state = await workspace(),
      r = state.revisions.find((r) => r.id === revisionId)!;
    if (r.state === 'ready') return state;
    assert.notEqual(r.state, 'failed', r.error || 'processing failed');
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error('Worker processing timed out');
}
const v1 = await upload('artifacts/fixtures/v1.pdf');
await ready(v1);
const denied = await fetch(`${base}/api/projects/${pid}/files/${v1}`, {
  headers: { Cookie: accounts.outside?.cookie || accounts.outsider!.cookie },
});
assert.equal(denied.status, 404);
const issue = await request('marketing', `projects/${pid}/issues`, {
  title: 'Correct the front-panel copy',
  description: 'Please apply the revised wording.',
  category: 'wording',
  severity: 'blocking',
  revision_id: v1,
  page: 1,
  geometry: { x: 0.15, y: 0.6, width: 0.35, height: 0.15, kind: 'rectangle' },
});
const v2 = await upload('artifacts/fixtures/v2.pdf');
await ready(v2);
let state = await workspace();
assert.deepEqual(
  state.revisions.map((r) => r.sequence),
  [2, 1],
);
await request('designer', `projects/${pid}/issues/${issue.id}`, {
  action: 'ready',
  version: state.issues[0]!.version,
  revision_id: v2,
});
state = await workspace();
await request(
  'designer',
  `projects/${pid}/issues/${issue.id}`,
  { action: 'verify', version: state.issues[0]!.version, revision_id: v2 },
  403,
);
await request('marketing', `projects/${pid}/issues/${issue.id}`, {
  action: 'verify',
  version: state.issues[0]!.version,
  revision_id: v2,
});
console.log(
  'PASS: immutable upload finalization, worker processing, issue verification and self-verification denial',
);
const comparison = await request('marketing', `projects/${pid}/comparisons`, {
  before_id: v1,
  after_id: v2,
});
let run;
const deadline = Date.now() + 120000;
while (Date.now() < deadline) {
  state = await workspace();
  run = state.comparisons.find((c) => c.id === comparison.id);
  if (['succeeded', 'partial', 'failed'].includes(run?.state || '')) break;
  await new Promise((r) => setTimeout(r, 1000));
}
assert.ok(
  run && ['succeeded', 'partial'].includes(run.state),
  run?.error || 'Comparison timed out',
);
assert.ok(state.findings.length);
const round = await request('designer', `projects/${pid}/review`, {
  action: 'submit',
  version: state.project.version,
  revision_id: v2,
});
for (const actor of ['marketing', 'qa']) {
  state = await workspace();
  await request(actor, `projects/${pid}/review`, {
    action: 'decision',
    version: state.project.version,
    revision_id: v2,
    round_id: round.id,
    scope: actor,
    decision: 'approve',
  });
}
state = await workspace();
await request(
  'qa',
  `projects/${pid}/review`,
  { action: 'finalize', version: state.project.version, revision_id: v2, round_id: round.id },
  409,
);
for (const finding of state.findings)
  await request('qa', `projects/${pid}/findings/${finding.id}`, {
    version: finding.version,
    disposition: 'expected',
    reason: 'Synthetic copy correction reviewed',
  });
state = await workspace();
if (run.state === 'partial') {
  await request('qa', `projects/${pid}/review`, {
    action: 'manual',
    version: state.project.version,
    revision_id: v2,
    round_id: round.id,
    note: 'Compared both synthetic pages manually.',
  });
  state = await workspace();
}
const staleVersion = state.project.version;
await request('qa', `projects/${pid}/review`, {
  action: 'finalize',
  version: state.project.version,
  revision_id: v2,
  round_id: round.id,
});
state = await workspace();
assert.equal(state.project.status, 'approved');
await request(
  'qa',
  `projects/${pid}/review`,
  { action: 'finalize', version: staleVersion, revision_id: v2, round_id: round.id },
  409,
);
const v3 = await upload('artifacts/fixtures/v2.pdf');
await ready(v3);
state = await workspace();
assert.equal(state.project.status, 'draft');
assert.ok(state.rounds.some((r) => r.state === 'approved' && r.revision_id === v2));
console.log(
  'PASS: comparison findings, approval gates, stale decisions and historical approval isolation',
);
await mkdir('local-data', { recursive: true });
await writeFile(
  'local-data/test-accounts.json',
  JSON.stringify({ accounts, projectId: pid }, null, 2),
  { mode: 0o600 },
);
console.log(`Synthetic workspace ready for browser checks: ${pid}`);
await database().end();
