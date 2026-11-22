// Stage 1 add-on browser check. Scratch file, not part of src/.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
const consoleErrors = [];
const pageErrors = [];

function record(id, label, ok, reason) {
  results.push({ id, label, ok, reason });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${id} ${label} -- ${reason}`);
}

async function step(id, label, fn) {
  try {
    const reason = await fn();
    record(id, label, true, reason || 'ok');
  } catch (err) {
    record(id, label, false, String(err && err.message ? err.message : err).split('\n')[0]);
  }
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));

// Login via Instant Demo
await step('login', 'Instant Demo login -> /dashboard', async () => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'Instant Demo' }).first().click();
  await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
  return `url=${page.url()}`;
});

// (a) View Receipt -> UPI payment QR image
await step('a', 'Invoices: View Receipt shows canvas[aria-label="UPI payment QR"]', async () => {
  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  const btn = page.getByRole('button', { name: 'View Receipt' }).first();
  await btn.waitFor({ state: 'visible', timeout: 15000 });
  await btn.click();
  const qr = page.locator('canvas[aria-label="UPI payment QR"]');
  await qr.first().waitFor({ state: 'visible', timeout: 10000 });
  const count = await qr.count();
  // close the receipt
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return `img count=${count}`;
});

// (b) Record Payment -> Simulate Patient Paid via UPI
await step('b', 'Invoices: Record Payment shows "Simulate Patient Paid", click refreshes balance', async () => {
  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  const row = page
    .locator('tbody tr')
    .filter({ has: page.locator('button:not([disabled])', { hasText: 'Record Payment' }) })
    .first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const invNo = (await row.locator('td').nth(1).innerText()).trim();
  const amountBefore = (await row.locator('td').nth(2).innerText()).trim().replace(/\s+/g, ' ');
  console.log(`b: invoice=${invNo} amountDue BEFORE="${amountBefore}"`);

  await row.getByRole('button', { name: 'Record Payment' }).click();
  const sim = page.getByRole('button', { name: /Simulate Patient Paid/ }).first();
  await sim.waitFor({ state: 'visible', timeout: 10000 });
  const modalBal = await page.locator('text=balance due').first().locator('xpath=..').innerText();
  console.log(`b: modal balance text="${modalBal.replace(/\s+/g, ' ').trim()}"`);

  await sim.click();
  const toast = page.getByText(/UPI payment of .* received/).first();
  let toastText = '(no toast seen)';
  try {
    await toast.waitFor({ state: 'visible', timeout: 15000 });
    toastText = (await toast.innerText()).trim();
  } catch (e) {
    toastText = '(no toast seen within 15s)';
  }
  await page.waitForTimeout(1500);

  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  const row2 = page.locator('tbody tr').filter({ hasText: invNo }).first();
  await row2.waitFor({ state: 'visible', timeout: 15000 });
  const amountAfter = (await row2.locator('td').nth(2).innerText()).trim().replace(/\s+/g, ' ');
  console.log(`b: toast="${toastText}"`);
  console.log(`b: invoice=${invNo} amountDue AFTER="${amountAfter}"`);
  if (amountAfter === amountBefore) {
    throw new Error(`balance unchanged after Simulate Patient Paid: before="${amountBefore}" after="${amountAfter}"`);
  }
  return `before="${amountBefore}" after="${amountAfter}" toast="${toastText}"`;
});

// (c) Customers profile drawer -> Message log
await step('c', 'Customers: profile drawer shows "Message log"', async () => {
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' });
  const row = page.locator('tbody tr').filter({ has: page.locator('td') }).first();
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const name = (await row.locator('td').nth(0).innerText()).trim();
  await row.locator('td').nth(0).click();
  const heading = page.getByText('Message log', { exact: true }).first();
  await heading.waitFor({ state: 'visible', timeout: 10000 });
  const section = await page.locator('h3', { hasText: 'Message log' }).first().locator('xpath=..').innerText();
  const noMsgs = await page.getByText('No messages sent yet').first().isVisible().catch(() => false);
  console.log(`c: customer="${name}" message-log section="${section.replace(/\s+/g, ' ').trim()}"`);
  console.log(`c: "No messages sent yet" visible=${noMsgs}`);
  return `customer="${name}" ${noMsgs ? 'shows "No messages sent yet"' : 'shows message rows'}`;
});

await browser.close();

console.log('\n=== CONSOLE ERRORS (' + consoleErrors.length + ') ===');
for (const e of consoleErrors) console.log('[console.error] ' + e);
console.log('\n=== PAGE ERRORS (' + pageErrors.length + ') ===');
for (const e of pageErrors) console.log('[pageerror] ' + e);

const passed = results.filter((r) => r.ok).length;
console.log(`\nRESULT: ${passed} passed, ${results.length - passed} failed`);
process.exit(passed === results.length ? 0 : 1);
