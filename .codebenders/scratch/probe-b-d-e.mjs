// Read-only probe for steps b, d, e of e2e-check.mjs. Scratch file, not part of src/.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
const pageErrors = [];
page.on('pageerror', (err) => pageErrors.push(String(err && err.message ? err.message : err)));

// Same login steps as e2e-check.mjs step a
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.locator('button', { hasText: 'Instant Demo' }).first().click();
await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
console.log('URL after login: ' + page.url());

// ---- (b) dashboard ----
await page.waitForLoadState('networkidle');
await page.waitForTimeout(3000);
const dashText = await page.evaluate(() => document.body.innerText);
console.log('\n=== (b) DASHBOARD innerText first 1500 chars ===');
console.log(dashText.slice(0, 1500));
console.log('\n=== (b) label check ===');
for (const t of ['Cash in Bank', 'Total Owed to Me', 'Overdue Receivables', 'Cash Safe Until']) {
  const vis = await page.getByText(t, { exact: false }).first().isVisible().catch(() => false);
  console.log(`${t}: visible=${vis}, in innerText=${dashText.includes(t)}`);
}
const canvasCount = await page.locator('canvas').count();
const emptyDivs = await page.evaluate(() =>
  Array.from(document.querySelectorAll('div')).filter((d) => d.children.length === 0 && d.innerText.trim() === '' && d.offsetHeight > 0 && d.offsetHeight < 2000).length
);
console.log(`canvas elements=${canvasCount}, empty leaf divs with height=${emptyDivs}`);
const hydrating = await page.getByText('Application error', { exact: false }).count();
console.log(`"Application error" count=${hydrating}`);

// ---- (d) customers ----
await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const custButtons = await page.locator('button').allInnerTexts();
console.log('\n=== (d) CUSTOMERS button innerText list ===');
custButtons.forEach((b, i) => console.log(`[${i}] ${JSON.stringify(b)}`));
const custMatch = await page.getByText('+ Add Customer', { exact: false }).count();
console.log(`getByText('+ Add Customer', exact:false) matches=${custMatch}`);

// ---- (e) invoices ----
await page.goto(`${BASE}/invoices`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
const invButtons = await page.locator('button').allInnerTexts();
console.log('\n=== (e) INVOICES button innerText list ===');
invButtons.forEach((b, i) => console.log(`[${i}] ${JSON.stringify(b)}`));
const invMatch = await page.getByText('+ New Invoice', { exact: false }).count();
console.log(`getByText('+ New Invoice', exact:false) matches=${invMatch}`);

console.log('\npageerrors=' + pageErrors.length);
pageErrors.forEach((e) => console.log('pageerror: ' + e));
await browser.close();
