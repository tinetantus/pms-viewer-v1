import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.APP_URL!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const { accounts, projectId } = JSON.parse(await readFile('local-data/test-accounts.json', 'utf8'));
async function call(path: string, body?: unknown) {
  const response = await fetch(`${base}/api/projects/${projectId}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: base, Cookie: accounts.qa.cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, 200, text.slice(0, 300));
  return JSON.parse(text);
}
let state = await call('');
const before = state.revisions.find((r: { sequence: number }) => r.sequence === 2),
  after = state.revisions.find((r: { sequence: number }) => r.sequence === 3);
const issue = await call('/issues', {
  title: 'Anchor proposal fixture',
  category: 'layout',
  severity: 'nonblocking',
  revision_id: before.id,
  page: 1,
  geometry: { kind: 'rectangle', x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
});
const run = await call('/comparisons', {
  before_id: before.id,
  after_id: after.id,
  page_map: [{ before: 1, after: 1 }],
});
for (let i = 0; i < 60; i++) {
  state = await call('');
  if (
    ['succeeded', 'partial', 'failed'].includes(
      state.comparisons.find((c: { id: string }) => c.id === run.id).state,
    )
  )
    break;
  await new Promise((r) => setTimeout(r, 1000));
}
const proposed = state.anchors.find(
  (a: { issue_id: string; revision_id: string }) =>
    a.issue_id === issue.id && a.revision_id === after.id,
);
assert.equal(proposed?.state, 'proposed');
assert.ok(proposed.source_anchor_id);
assert.equal(state.issues.find((i: { id: string }) => i.id === issue.id).status, 'open');
await call(`/issues/${issue.id}`, { action: 'reject_anchor', version: 1, revision_id: after.id });
state = await call('');
assert.equal(state.anchors.find((a: { id: string }) => a.id === proposed.id).state, 'unmapped');
await call(`/issues/${issue.id}`, {
  action: 'anchor',
  version: 2,
  revision_id: after.id,
  page: 1,
  geometry: { kind: 'rectangle', x: 0.25, y: 0.2, width: 0.2, height: 0.1 },
});
state = await call('');
assert.equal(state.anchors.find((a: { id: string }) => a.id === proposed.id).state, 'confirmed');
assert.equal(
  state.anchors.find((a: { id: string }) => a.id === proposed.source_anchor_id).geometry.x,
  0.2,
);
console.log(
  'PASS: worker proposes evidence-backed anchors without closing issues; reviewer rejects/replaces mapping while original remains immutable.',
);
