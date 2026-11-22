// Diagnostic for e2e step c. Scratch file, not part of src/. Does NOT modify app code.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e && e.message ? e.message : e)));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.locator('button', { hasText: 'Instant Demo' }).first().click();
await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
await page.waitForLoadState('networkidle');
console.log('url after login:', page.url());

// step c, same selectors as e2e-check.mjs lines 68-70
const openCount = await page.getByText('Open reminder', { exact: false }).count();
console.log(`"Open reminder" matches before click: ${openCount}`);
await page.getByText('Open reminder', { exact: false }).first().click({ timeout: 15000 });
await page.waitForTimeout(1000);

const sendLoc = page.getByText('Send via CashPulse Dispatch', { exact: false });
const n = await sendLoc.count();
console.log('send-text matches (getByText, exact:false):', n);
for (let i = 0; i < Math.min(n, 5); i++) {
  const info = await sendLoc.nth(i).evaluate((node) => {
    const r = node.getBoundingClientRect();
    const btn = node.closest('button');
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      tag: node.tagName,
      inDialog: !!node.closest('[role="dialog"]'),
      box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
      buttonDisabled: btn ? btn.disabled : 'no-button-ancestor',
      topElementAtCenter: top ? `${top.tagName}.${String(top.className || '').slice(0, 60)}` : null,
      coveredByOther: !!top && !(node === top || node.contains(top) || (btn && btn.contains(top))),
    };
  });
  console.log(`match[${i}]`, JSON.stringify(info));
}

// Real click attempt on the button role locator, short timeout, to capture Playwright's own reason.
try {
  await page.locator('button', { hasText: 'Send via CashPulse Dispatch' }).first().click({ timeout: 8000 });
  console.log('CLICK RESULT: button clicked OK');
} catch (e) {
  console.log('CLICK RESULT: FAILED -> ' + String(e.message).split('\n').slice(0, 12).join(' | '));
}

await browser.close();
console.log('consoleErrors:', consoleErrors.length, 'pageErrors:', pageErrors.length);
pageErrors.forEach((e) => console.log('pageerror: ' + e));
