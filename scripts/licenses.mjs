import { readFile, writeFile } from 'node:fs/promises';
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const counts = new Map();
const unresolved = [];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location.includes('node_modules/') || entry.link) continue;
  let license = entry.license;
  if (!license)
    try {
      license = JSON.parse(await readFile(`${location}/package.json`, 'utf8')).license;
    } catch {}
  if (typeof license === 'object') license = license.type;
  if (!license) unresolved.push(location);
  const key = license || 'Not declared';
  counts.set(key, (counts.get(key) || 0) + 1);
}
const text = `# Dependency licence inventory\n\nGenerated from the committed npm lockfile and installed package metadata. This is a metadata inventory, not legal advice or a replacement for distributing required notices. Production image verification must retain bundled licence files.\n\n| Declared licence | Package entries |\n| --- | ---: |\n${[
  ...counts,
]
  .sort()
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join(
    '\n',
  )}\n\nUndeclared entries: ${unresolved.length ? unresolved.join(', ') : 'none'}.\n\nPython runtime dependencies are pinned in services/processor/requirements.txt. PDFium includes third-party notices; retain the installed package licence directories in container images. Review their licences before distributing an image outside the organization.\n`;
await writeFile('docs/dependency-licenses.md', text);
console.log(JSON.stringify({ counts: Object.fromEntries(counts), undeclared: unresolved }));
