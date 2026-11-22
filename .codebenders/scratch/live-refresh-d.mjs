// Step D: live refresh check. For /customers, /bills, /messages: open page, count tbody rows,
// create ONE record via the API (same session), wait 6s with NO reload, recount. Scratch file.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const FUTURE = '2030-12-31';
const stamp = Date.now().toString().slice(-6);
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();

const login = await context.newPage();
await login.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await login.locator('button', { hasText: 'Instant Demo' }).first().click();
await login.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });
await login.close();

const customers = await (await context.request.get(`${BASE}/api/customers`)).json();
const customerId = customers[0].id;

const cases = [
  {
    name: 'customers', path: '/customers',
    ready: 'Customers',
    create: () => context.request.post(`${BASE}/api/customers`, { data: { name: `Live Refresh ${stamp}`, phone: '9876500077' } }),
  },
  {
    name: 'bills', path: '/bills',
    ready: 'Bills & Fixed Expenses',
    create: () => context.request.post(`${BASE}/api/bills`, { data: { title: `Live Refresh Bill ${stamp}`, category: 'SUPPLIER', amount: 300, dueDate: FUTURE } }),
  },
  {
    name: 'messages', path: '/messages',
    ready: 'Messages',
    create: () => context.request.post(`${BASE}/api/messages`, { data: { customerId, channel: 'WHATSAPP', tone: 'GENTLE', body: `Live refresh ${stamp}` } }),
  },
];

for (const c of cases) {
  const page = await context.newPage();
  await page.goto(`${BASE}${c.path}`, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: c.ready }).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  const before = await page.locator('tbody tr').count();
  const res = await c.create();
  const createStatus = res.status();
  await page.waitForTimeout(6000); // no reload
  const after = await page.locator('tbody tr').count();
  console.log(`${c.name}\tpath=${c.path}\tcreateStatus=${createStatus}\trowsBefore=${before}\trowsAfter6s=${after}\t${after > before ? 'PASS' : 'FAIL'}`);
  await page.close();
}
await browser.close();
