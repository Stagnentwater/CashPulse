// Mirrors e2e-check.mjs step c EXACTLY (no extra waits), over N trials, recording the button state at click time.
// Scratch file. Does NOT modify app code.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const TRIALS = Number(process.env.TRIALS || 3);
const browser = await chromium.launch({ headless: true });

for (let t = 1; t <= TRIALS; t++) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'Instant Demo' }).first().click();
  await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
  await page.waitForLoadState('networkidle');

  const openBefore = await page.getByText('Open reminder', { exact: false }).count();
  let step = 'open-reminder-click';
  try {
    await page.getByText('Open reminder', { exact: false }).first().click();
    step = 'visible-wait';
    await page.getByText('Send via CashPulse Dispatch', { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 });
    step = 'send-click';
    const state = await page.getByText('Send via CashPulse Dispatch', { exact: false }).first().evaluate((node) => {
      const btn = node.closest('button');
      const ta = document.getElementById('reminder-body');
      return { disabled: btn ? btn.disabled : null, bodyLen: ta ? ta.value.trim().length : null, tag: node.tagName };
    });
    console.log(`trial ${t}: openMatchesBeforeClick=${openBefore} stateAtClick=${JSON.stringify(state)}`);
    await page.getByText('Send via CashPulse Dispatch', { exact: false }).first().click({ timeout: 10000 });
    console.log(`trial ${t}: send click OK`);
  } catch (e) {
    console.log(`trial ${t}: FAILED at ${step} -> ` + String(e.message).split('\n').slice(0, 8).join(' | '));
  }
  await context.close();
}
await browser.close();
