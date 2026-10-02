import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const { accounts } = JSON.parse(await readFile('local-data/test-accounts.json', 'utf8'));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext();
  await context.addCookies(
    accounts.administrator.cookie.split('; ').map((v) => {
      const i = v.indexOf('=');
      return {
        name: v.slice(0, i),
        value: v.slice(i + 1),
        url: 'http://localhost:3000',
        httpOnly: true,
        sameSite: 'Lax',
      };
    }),
  );
  const page = await context.newPage();
  await page.goto('http://localhost:3000');
  const opener = page.getByRole('button', { name: 'New project', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.ok(await dialog.evaluate((d) => d.contains(document.activeElement)));
  for (let i = 0; i < 18; i++) {
    await page.keyboard.press('Tab');
    assert.ok(await dialog.evaluate((d) => d.contains(document.activeElement)));
  }
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  assert.ok(await opener.evaluate((e) => e === document.activeElement));
  console.log(
    'PASS: dialog initial focus, tab containment, Escape dismissal and opener focus restoration.',
  );
} finally {
  await browser.close();
}
