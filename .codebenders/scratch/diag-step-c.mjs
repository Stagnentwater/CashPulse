// Step-c-only diagnostic for the e2e failure. Scratch file, not part of src/.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e.message || e)));

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.locator('button', { hasText: 'Instant Demo' }).first().click();
await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
await page.waitForLoadState('networkidle');

const openBtn = page.getByText('Open reminder', { exact: false });
console.log('before click: Open reminder count =', await openBtn.count());
await openBtn.first().waitFor({ state: 'visible', timeout: 15000 }).catch((e) => console.log('wait open btn:', e.message.split('\n')[0]));
console.log('open btn visible =', await openBtn.first().isVisible().catch(() => false));

const t0 = Date.now();
try {
  await openBtn.first().click({ timeout: 10000 });
  console.log('open click ok in', Date.now() - t0, 'ms');
} catch (e) {
  console.log('OPEN CLICK FAILED:', e.message.split('\n')[0]);
}

const sendSel = page.getByText('Send via CashPulse Dispatch', { exact: false });
try {
  await sendSel.first().waitFor({ state: 'visible', timeout: 10000 });
  console.log('send button visible; count =', await sendSel.count());
  const info = await sendSel.first().evaluate((el) => ({
    tag: el.tagName, disabled: el.disabled, type: el.getAttribute('type'),
    inDialog: !!el.closest('[role="dialog"], aside, [data-state]'),
  }));
  console.log('send button state:', JSON.stringify(info));
  const bodyLen = await page.locator('#reminder-body').inputValue({ timeout: 3000 }).then((v) => v.trim().length).catch(() => 'no textarea');
  console.log('reminder body length =', bodyLen);
  await sendSel.first().click({ timeout: 10000 });
  console.log('send click ok');
} catch (e) {
  console.log('SEND STEP FAILED:', e.message.split('\n')[0]);
  console.log('drawer text sample:', (await page.locator('aside').first().innerText().catch(() => 'no aside')).slice(0, 300));
}
console.log('page errors:', pageErrors.length, pageErrors.slice(0, 3));
await browser.close();
