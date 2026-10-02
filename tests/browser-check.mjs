import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';

const { accounts, projectId } = JSON.parse(await readFile('local-data/test-accounts.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  deviceScaleFactor: 1,
});
const errors = [];
const page = await context.newPage();
page.on('pageerror', (error) => errors.push(error.message));
await mkdir('artifacts/browser', { recursive: true });
try {
  await page.goto('http://localhost:3000/login');
  await page.screenshot({ path: 'artifacts/browser/login.png', fullPage: true });
  await page.getByLabel('Email address').fill(accounts.administrator.email);
  await page.getByLabel('Password', { exact: true }).fill(accounts.administrator.password);
  await page.getByRole('button', { name: 'Sign in', exact: false }).click();
  await page.waitForURL('http://localhost:3000/');
  await page.getByRole('heading', { name: 'Your proofing workspace' }).waitFor();
  await page.getByRole('heading', { name: 'Synthetic packaging proof' }).waitFor();
  await page.screenshot({ path: 'artifacts/browser/dashboard.png', fullPage: true });
  // Switch to the assigned reviewer using the authenticated test session.
  await context.clearCookies();
  await context.addCookies(
    accounts.marketing.cookie.split('; ').map((value) => {
      const index = value.indexOf('=');
      return {
        name: value.slice(0, index),
        value: value.slice(index + 1),
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Lax',
      };
    }),
  );
  await page.goto(`http://localhost:3000/projects/${projectId}`);
  await page.locator('canvas').waitFor();
  await page.waitForFunction(() => {
    const c = document.querySelector('canvas');
    return c && c.width > 0 && c.height > 0;
  });
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/browser/workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'rectangle', exact: true }).click();
  const bounds = await page.locator('.pdf-surface').boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + bounds.width * 0.18, bounds.y + bounds.height * 0.58);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * 0.48, bounds.y + bounds.height * 0.72, {
    steps: 8,
  });
  await page.mouse.up();
  await page.getByRole('heading', { name: 'Leave a precise request' }).waitFor();
  await page.getByLabel('Issue title').fill('Browser annotation alignment');
  await page
    .getByLabel('Description', { exact: true })
    .fill('Synthetic UI annotation created by browser verification.');
  await page.getByRole('button', { name: 'Create issue', exact: true }).click();
  await page.getByRole('heading', { name: 'Browser annotation alignment', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Rotate page' }).click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/browser/rotated-annotation.png', fullPage: true });
  await page.getByRole('button', { name: 'Rotate page' }).click();
  await page.getByRole('button', { name: 'Rotate page' }).click();
  await page.getByRole('button', { name: 'Rotate page' }).click();
  await page.getByLabel('Zoom', { exact: true }).selectOption('4');
  await page.waitForTimeout(900);
  const tile = await page.locator('canvas').evaluate((c) => ({ width: c.width, height: c.height }));
  assert.ok(tile.width * tile.height < 8_000_000);
  await page.screenshot({ path: 'artifacts/browser/high-zoom.png', fullPage: true });
  await page.getByRole('button', { name: 'Side by side' }).click();
  await page.getByRole('button', { name: 'Fit page', exact: true }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/browser/compare.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'artifacts/browser/mobile.png', fullPage: true });
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(
    'PASS: login, dashboard, PDF render, drawn/persisted annotation, rotation, 400% zoom pixel budget, compare and mobile screenshots.',
  );
} finally {
  await browser.close();
}
