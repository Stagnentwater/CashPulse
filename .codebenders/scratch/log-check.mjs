import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const PAGES = ['/dashboard', '/customers', '/invoices', '/bills', '/forecast', '/messages'];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

const consoleLines = [];
page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err.message}`));

const results = [];

try {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('button', { hasText: 'Instant Demo' }).first().click();
  await page.waitForLoadState('networkidle');
  results.push({ path: '/login -> Instant Demo click', status: 'OK', url: page.url() });

  for (const p of PAGES) {
    try {
      const resp = await page.goto(`${BASE}${p}`, { waitUntil: 'networkidle' });
      results.push({ path: p, status: resp ? resp.status() : 'no response', url: page.url() });
    } catch (e) {
      results.push({ path: p, status: 'ERROR', error: e.message.split('\n')[0] });
    }
  }
} finally {
  await browser.close();
}

for (const r of results) console.log(JSON.stringify(r));
console.log(`console-messages-captured: ${consoleLines.length}`);
