// Explicit local feasibility helper. Copies private samples into ignored local storage via authenticated APIs.
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const base = process.env.APP_URL || 'http://localhost:3000';
if (new URL(base).hostname !== 'localhost')
  throw new Error('Sample import is restricted to localhost.');
const { accounts } = JSON.parse(await readFile('local-data/test-accounts.json', 'utf8'));
const source = process.argv[2];
if (!source) throw new Error('Pass the private sample directory.');
async function api(actor, url, body, method) {
  const r = await fetch(`${base}/api/${url}`, {
    method: method || (body ? 'POST' : 'GET'),
    headers: {
      Origin: base,
      Cookie: accounts[actor].cookie,
      ...(body && !Buffer.isBuffer(body) ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : undefined,
  });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}
const projects = [];
for (const sku of ['CDC', 'CDL', 'CDO', 'CDS']) {
  const files = (await readdir(source)).filter((n) => n.includes(`${sku}_`)).sort();
  if (!files.length) continue;
  const project = await api('administrator', 'projects', {
    name: `Balance cereal drink · ${sku}`,
    sku,
    product: 'Balance cereal drink',
    market: 'Thailand',
    language: 'Thai / English',
    pack_size: '180 ml',
  });
  for (const [actor, designer, reviewer, scopes] of [
    ['designer', true, false, []],
    ['marketing', false, true, ['marketing']],
    ['qa', false, true, ['qa']],
  ]) {
    const state = await api('administrator', `projects/${project.id}`);
    await api('administrator', `projects/${project.id}/members`, {
      user_id: accounts[actor].id,
      designer,
      reviewer,
      scopes,
      version: state.project.version,
    });
  }
  for (const filename of files) {
    const bytes = await readFile(path.join(source, filename));
    const intent = await api('designer', `projects/${project.id}/uploads`, {
      filename,
      byte_size: bytes.length,
      notes: 'Local feasibility sample; not an approved production revision.',
    });
    await api('designer', `projects/${project.id}/uploads/${intent.id}`, bytes, 'PUT');
    await api('designer', `projects/${project.id}/uploads/${intent.id}/finalize`, {});
  }
  projects.push({ id: project.id, sku });
  console.log(`Imported ${sku} privately for local fidelity checks.`);
}
await writeFile('local-data/sample-projects.json', JSON.stringify(projects, null, 2));
