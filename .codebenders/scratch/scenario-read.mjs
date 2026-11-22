// Read-only: logs in via UI, reads saved forecast scenario, saves snapshot. Scratch file.
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const BASE = 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.locator('button', { hasText: 'Instant Demo' }).first().click();
await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
const res = await page.request.get(`${BASE}/api/forecast/scenario`);
const body = await res.text();
console.log('GET /api/forecast/scenario status=' + res.status());
console.log(body);
writeFileSync('.codebenders/scratch/scenario-before.json', body);
await browser.close();
