import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.APP_URL!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const { accounts, projectId } = JSON.parse(await readFile('local-data/test-accounts.json', 'utf8'));
async function call(actor: string, path: string, body?: unknown, status = 200) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Origin: base, Cookie: accounts[actor].cookie, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, status, text.slice(0, 300));
  return JSON.parse(text);
}
const route = `projects/${projectId}`;
let state = await call('qa', route);
const finding = state.findings.find((f: { issue_id: string | null }) => !f.issue_id);
assert.ok(finding);
const comparison = state.comparisons.find((c: { id: string }) => c.id === finding.comparison_id);
const payload = {
  title: 'Linked comparison finding',
  category: 'qa',
  severity: 'blocking',
  revision_id: comparison.after_id,
  page: finding.page,
  geometry: finding.geometry,
  finding_id: finding.id,
  finding_version: finding.version,
};
await call('administrator', `${route}/issues`, payload, 403);
const created = await call('qa', `${route}/issues`, payload);
await call('qa', `${route}/issues`, payload, 409);
state = await call('qa', route);
const linked = state.findings.find((f: { id: string }) => f.id === finding.id);
assert.equal(linked.issue_id, created.id);
assert.equal(linked.disposition, 'needs_attention');
await call(
  'qa',
  `${route}/findings/${finding.id}`,
  {
    version: linked.version,
    disposition: 'expected',
    reason: 'Invalid foreign issue reference',
    issue_id: crypto.randomUUID(),
  },
  400,
);
const issue = state.issues.find((i: { id: string }) => i.id === created.id);
await call('qa', `${route}/issues/${created.id}`, {
  action: 'comment',
  version: issue.version,
  note: '@Designer Tester please check',
  mentions: [accounts.designer.id],
});
const notifications = await call('designer', 'notifications');
assert.ok(notifications.some((n: { message: string }) => n.message.includes('mentioned you')));
state = await call('qa', route);
await call('administrator', `${route}/members`, {
  version: state.project.version,
  user_id: accounts.marketing.id,
  designer: false,
  reviewer: false,
  scopes: [],
  remove: true,
});
await call('marketing', route, undefined, 404);
state = await call('qa', route);
await call('administrator', `${route}/members`, {
  version: state.project.version,
  user_id: accounts.marketing.id,
  designer: false,
  reviewer: true,
  scopes: ['marketing'],
});
const filtered = await call('administrator', `projects?assignee=${accounts.marketing.id}`);
assert.ok(filtered.projects.some((p: { id: string }) => p.id === projectId));
console.log(
  'PASS: atomic issue/finding links, duplicate prevention, foreign-ID rejection, targeted mentions, project access removal/restoration and assignment filtering.',
);
