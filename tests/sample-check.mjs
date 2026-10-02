// Opt-in private-artwork check; no source files or screenshots are committed.
import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { accounts } = JSON.parse(await readFile('local-data/sample-accounts.json', 'utf8'));
const projects = JSON.parse(await readFile('local-data/sample-projects.json', 'utf8'));
const base = 'http://localhost:3000';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies(
  accounts.administrator.cookie.split('; ').map((value) => {
    const index = value.indexOf('=');
    return {
      name: value.slice(0, index),
      value: value.slice(index + 1),
      url: base,
      httpOnly: true,
      sameSite: 'Lax',
    };
  }),
);
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const report = [];
await mkdir('artifacts/samples', { recursive: true });
try {
  for (const project of projects) {
    const start = performance.now();
    await page.goto(`${base}/projects/${project.id}`);
    await page.locator('canvas').waitFor();
    await page.waitForFunction(() => document.querySelector('canvas')?.width > 0);
    await page.getByRole('button', { name: 'Fit page', exact: true }).click();
    await page.waitForTimeout(700);
    await page.screenshot({ path: `artifacts/samples/${project.sku}.png` });
    await page.getByLabel('Zoom', { exact: true }).selectOption('4');
    await page.waitForTimeout(800);
    const tile = await page
      .locator('canvas')
      .evaluate((c) => ({ width: c.width, height: c.height }));
    assert.ok(tile.width * tile.height < 8_000_000);
    await page.screenshot({ path: `artifacts/samples/${project.sku}-zoom.png` });
    const workspace = await (
      await context.request.get(`${base}/api/projects/${project.id}`)
    ).json();
    const revisions = workspace.revisions.filter((r) => r.state === 'ready');
    assert.equal(revisions.length, 2);
    const result = await context.request.post(`${base}/api/projects/${project.id}/comparisons`, {
      headers: { Origin: base },
      data: { before_id: revisions[1].id, after_id: revisions[0].id },
    });
    assert.equal(result.status(), 200, await result.text());
    report.push({ sku: project.sku, view_check_ms: Math.round(performance.now() - start), tile });
  }
  assert.deepEqual(errors, []);
  await writeFile('artifacts/samples/report.json', JSON.stringify(report, null, 2));
  console.log(
    'PASS: four supplied proofs render at fit-page and 400% zoom with bounded canvases; comparisons queued.',
  );
} finally {
  await browser.close();
}
