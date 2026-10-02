// Run after integration.ts against its disposable local workspace.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = process.env.APP_URL!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const { accounts, projectId } = JSON.parse(await readFile('local-data/test-accounts.json', 'utf8'));
async function call(actor: string, path: string, body?: unknown, status = 200) {
  const response = await fetch(`${base}/api/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      Cookie: accounts[actor]?.cookie || '',
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  assert.equal(response.status, status, text.slice(0, 300));
  return JSON.parse(text);
}
const route = `projects/${projectId}`;
let state = await call('qa', route);
const issue = state.issues[0];
await call('qa', `${route}/issues/${issue.id}`, {
  action: 'comment',
  version: issue.version,
  note: 'Please confirm the revised copy.',
});
state = await call('qa', route);
const comment = state.comments.find(
  (c: { body: string }) => c.body === 'Please confirm the revised copy.',
);
await call('designer', `${route}/issues/${issue.id}`, {
  action: 'comment',
  version: state.issues[0].version,
  note: 'Confirmed in the candidate.',
  parent_id: comment.id,
});
state = await call('qa', route);
await call(
  'designer',
  `${route}/issues/${issue.id}`,
  {
    action: 'edit_comment',
    version: state.issues[0].version,
    comment_id: comment.id,
    note: 'Not the author',
  },
  403,
);
await call('qa', `${route}/issues/${issue.id}`, {
  action: 'edit_comment',
  version: state.issues[0].version,
  comment_id: comment.id,
  note: 'Please confirm copy and spacing.',
});
state = await call('qa', route);
assert.equal(state.comments.find((c: { id: string }) => c.id === comment.id).history.length, 1);
await call('qa', `${route}/issues/${issue.id}`, {
  action: 'anchor',
  version: state.issues[0].version,
  revision_id: state.project.current_revision_id,
  page: 1,
  geometry: { x: 0.2, y: 0.2, width: 0.2, height: 0.1 },
});
state = await call('qa', route);
assert.ok(state.anchors.some((a: { state: string }) => a.state === 'original'));
assert.ok(
  state.anchors.some(
    (a: { revision_id: string }) => a.revision_id === state.project.current_revision_id,
  ),
);
const invitation = await call('administrator', 'invitations', {
  email: `invite-${crypto.randomUUID()}@example.test`,
  role: 'viewer',
});
const token = invitation.url.split('#')[1];
const accept = { token, name: 'Invited Tester', password: crypto.randomUUID() };
await call('anonymous', 'invitations/accept', accept);
await call('anonymous', 'invitations/accept', accept, 400);
await call('qa', 'invitations', { email: 'unauthorized@example.test', role: 'administrator' }, 403);
await call('administrator', `members/${accounts.outsider.id}`, { active: false });
await call('outsider', 'me', undefined, 401);
await call('administrator', `members/${accounts.administrator.id}`, { active: false }, 409);
console.log(
  'PASS: threaded replies, author-only edits with history, preserved original anchors, one-use invitations, account disable and administrator protection.',
);
