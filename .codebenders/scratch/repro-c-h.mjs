import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const badResponses = [];
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', (err) => pageErrors.push(String(err && err.stack ? err.stack : err)));
page.on('response', (res) => { if (res.status() >= 400) badResponses.push(`${res.status()} ${res.request().method()} ${res.url()}`); });

// login
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.locator('button', { hasText: 'Instant Demo' }).first().click();
await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
console.log('LOGIN url=' + page.url());

// (c) reminder drawer
await page.waitForLoadState('networkidle');
await page.getByRole('button', { name: 'Open reminder' }).first().waitFor({ state: 'visible', timeout: 15000 });
await page.getByRole('button', { name: 'Open reminder' }).first().click();
await page.waitForTimeout(2000);
const drawerVisible = await page.getByText('Send via CashPulse Dispatch', { exact: false }).first().isVisible().catch(() => false);
console.log('C drawer "Send via CashPulse Dispatch" visible=' + drawerVisible);
const drawerButtons = await page.locator('[role="dialog"] button, .fixed button').allInnerTexts().catch(() => []);
console.log('C drawer buttons=' + JSON.stringify(drawerButtons.map((t) => t.trim()).filter(Boolean)));
try {
  await page.locator('button', { hasText: 'Send via CashPulse Dispatch' }).first().click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  console.log('C click OK');
} catch (err) {
  console.log('C click FAILED FULL ERROR:\n' + String(err.message));
}

// (h) messages
await page.goto(`${BASE}/messages`, { waitUntil: 'networkidle' });
await page.waitForLoadState('networkidle');
const bodyText = (await page.locator('body').innerText()).slice(0, 1500);
console.log('H messages body text (first 1500):\n' + bodyText);
const rows = await page.locator('table tbody tr').count();
console.log('H table body rows=' + rows);

console.log('CONSOLE_ERRORS=' + JSON.stringify(consoleErrors, null, 2));
console.log('PAGE_ERRORS=' + JSON.stringify(pageErrors, null, 2));
console.log('BAD_RESPONSES=' + JSON.stringify(badResponses, null, 2));

await browser.close();
