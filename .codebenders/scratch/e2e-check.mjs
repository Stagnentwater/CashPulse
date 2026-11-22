// E2E smoke check for CashPulse. Scratch file, not part of src/.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
const consoleErrors = [];
const pageErrors = [];

function record(id, label, ok, reason) {
  results.push({ id, label, status: ok ? 'PASS' : 'FAIL', reason });
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

const future = '2030-12-31';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));

const visibleText = async (text, timeout = 15000) =>
  page.getByText(text, { exact: false }).first().waitFor({ state: 'visible', timeout });

// a. login via demo
await step('a', 'Instant Demo login -> /dashboard', async () => {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'Instant Demo' }).first().click();
  await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
  return `url=${page.url()}`;
});

// b. dashboard
await step('b', 'Dashboard KPIs, charts, no app error', async () => {
  await page.waitForLoadState('networkidle');
  const missing = [];
  for (const t of ['Cash in Bank', 'Total Owed to Me', 'Overdue Receivables', 'Cash Safe Until']) {
    await page.getByText(t).first().waitFor({ state: 'visible', timeout: 10000 });
    if (!(await page.getByText(t, { exact: false }).first().isVisible().catch(() => false))) missing.push(t);
  }
  if (missing.length) throw new Error(`missing KPI labels: ${missing.join(', ')}`);
  const charts = page.locator('.recharts-responsive-container');
  await charts.first().waitFor({ state: 'visible', timeout: 15000 });
  const n = await charts.count();
  let withSvg = 0;
  for (let i = 0; i < n; i++) {
    if ((await charts.nth(i).locator('svg').count()) > 0) withSvg++;
  }
  if (withSvg < 3) throw new Error(`only ${withSvg} recharts containers with svg (found ${n})`);
  if (await page.getByText('Application error', { exact: false }).count()) throw new Error('"Application error" text on page');
  return `charts with svg=${withSvg}/${n}`;
});

// c. reminder drawer
await step('c', 'Open reminder -> drawer -> Send via CashPulse Dispatch', async () => {
  await page.getByText('Open reminder', { exact: false }).first().click();
  await visibleText('Send via CashPulse Dispatch');
  await page.getByText('Send via CashPulse Dispatch', { exact: false }).first().click();
  await page.waitForTimeout(1500);
  return 'drawer shown and send clicked';
});

// d. customers
await step('d', 'Add customer "Test Patient"', async () => {
  await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Customers' }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Add Customer' }).first().click();
  await page.getByLabel('Name', { exact: false }).first().fill('Test Patient');
  await page.getByLabel('Phone', { exact: false }).first().fill('9876500099');
  await page.locator('form:visible button[type="submit"]').last().click();
  await visibleText('Test Patient');
  return 'row visible';
});

// e. invoices
await step('e', 'Create invoice 1000 -> new row', async () => {
  await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Who Owes Me' }).first().waitFor({ timeout: 15000 });
  const before = await page.locator('tbody tr').count();
  await page.getByRole('button', { name: 'New Invoice' }).first().click();
  const select = page.locator('form:visible select').first();
  await select.selectOption({ index: 1 });
  await page.getByLabel('Amount', { exact: false }).first().fill('1000');
  await page.locator('form:visible input[type="date"]').first().fill(future);
  await page.locator('form:visible button[type="submit"]').last().click();
  await page.waitForTimeout(2000);
  const after = await page.locator('tbody tr').count();
  if (after <= before) throw new Error(`row count ${before} -> ${after}`);
  return `rows ${before} -> ${after}`;
});

// f. bills
await step('f', 'Add bill 500 -> row', async () => {
  await page.goto(`${BASE}/bills`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Bills & Fixed Expenses' }).first().waitFor({ timeout: 15000 });
  const before = await page.locator('tbody tr').count();
  await page.getByText('+ Add Bill', { exact: false }).first().click();
  await page.getByLabel('Title', { exact: false }).first().fill('Test Bill');
  await page.getByLabel('Amount', { exact: false }).first().fill('500');
  await page.locator('form:visible input[type="date"]').first().fill(future);
  await page.locator('form:visible button[type="submit"]').last().click();
  await page.waitForTimeout(2000);
  const after = await page.locator('tbody tr').count();
  if (after <= before) throw new Error(`row count ${before} -> ${after}`);
  return `rows ${before} -> ${after}`;
});

// g. forecast
await step('g', 'Forecast Simulate Bad Day -> toast, chart renders', async () => {
  await page.goto(`${BASE}/forecast`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Forecast & What-If' }).first().waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Simulate Bad Day (5 Customers Late)' }).click();
  const toast = page.locator('[role="status"], [data-sonner-toast], [role="alert"]').first();
  await toast.waitFor({ state: 'visible', timeout: 8000 });
  const toastText = (await toast.innerText()).trim();
  const svgs = await page.locator('.recharts-responsive-container svg').count();
  if (svgs === 0) throw new Error('no chart svg after simulate');
  return `toast="${toastText.slice(0, 80)}" chart svgs=${svgs}`;
});

// h. messages
await step('h', 'Messages heading and at least one row', async () => {
  await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: 'Messages' }).first().waitFor({ timeout: 15000 });
  const rows = await page.locator('tbody tr').count();
  if (rows < 1) throw new Error('no rows');
  return `rows=${rows}`;
});

// i. sign out
await step('i', 'Sign Out -> /login', async () => {
  const signOut = page.getByText('Sign Out', { exact: false }).first();
  if (!(await signOut.isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /user|account|profile|menu/i }).first().click();
  }
  await page.getByText('Sign Out', { exact: false }).first().click();
  await page.waitForURL(/\/login\/?$/, { timeout: 15000 });
  return `url=${page.url()}`;
});

// j. reload login
await step('j', 'Reload /login without crash', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  if (await page.getByText('Application error', { exact: false }).count()) throw new Error('"Application error" on /login');
  if (!page.url().endsWith('/login')) throw new Error(`url=${page.url()}`);
  return `url=${page.url()}`;
});

await browser.close();

console.log('\n=== SUMMARY ===');
for (const r of results) console.log(`${r.id}\t${r.status}\t${r.label}\t${r.reason}`);
console.log(`\n=== CONSOLE ERRORS (${consoleErrors.length}) ===`);
consoleErrors.forEach((e) => console.log('console.error: ' + e));
console.log(`\n=== PAGE ERRORS (${pageErrors.length}) ===`);
pageErrors.forEach((e) => console.log('pageerror: ' + e));
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(`\nRESULT: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
