import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const results = [];
const consoleLines = [];
const record = (step, ok, evidence) => {
  results.push({ step, status: ok ? 'PASS' : 'FAIL', evidence });
  console.log(`${step}: ${ok ? 'PASS' : 'FAIL'} :: ${evidence}`);
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') consoleLines.push(`[console.error] ${m.text()}`); });
page.on('pageerror', (e) => consoleLines.push(`[pageerror] ${e.message}`));

const settle = () => page.waitForLoadState('networkidle');

async function step(name, fn) {
  try { await fn(); } catch (e) { record(name, false, `exception: ${e.message.split('\n')[0]}`); }
}

try {
  // ---------- A ----------
  await step('A', async () => {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('button', { hasText: 'Instant Demo' }).first().click();
    await page.waitForURL(/\/dashboard$/, { timeout: 10000 });
    await settle();
    await page.getByRole('link', { name: 'Customers', exact: true }).click();
    await page.waitForURL(/\/customers$/, { timeout: 10000 });
    await settle();
    const firstName = (await page.locator('tbody tr td').first().innerText()).trim();
    console.log(`A: first customer before add = "${firstName}"`);
    await page.getByRole('button', { name: 'Add Customer', exact: true }).first().click();
    await page.locator('#cust-name').fill('Persist Check');
    await page.locator('#cust-phone').fill('9876500077');
    await page.locator('form:has(#login-email) button[type="submit"], form:has(#signup-name) button[type="submit"], form:has(#cust-name) button[type="submit"]').first().click();
    await page.getByText('Persist Check', { exact: true }).first().waitFor({ timeout: 5000 });
    await page.reload({ waitUntil: 'networkidle' });
    const url = page.url();
    const present = await page.getByText('Persist Check', { exact: true }).count();
    record('A', url.endsWith('/customers') && present > 0,
      `after reload url=${url}, "Persist Check" matches=${present}`);
  });

  // ---------- B ----------
  const stamp = Date.now();
  const email = `owner-${stamp}@example.test`;
  await step('B', async () => {
    await page.goto(`${BASE}/signup`, { waitUntil: 'networkidle' });
    await page.locator('#signup-name').fill('Test Clinic Owner');
    await page.locator('#signup-clinic').fill('Test Clinic');
    await page.locator('#signup-email').fill(email);
    await page.locator('#signup-password').fill('secret123');
    await page.locator('form:has(#login-email) button[type="submit"], form:has(#signup-name) button[type="submit"], form:has(#cust-name) button[type="submit"]').first().click();
    await page.waitForURL(/\/dashboard$/, { timeout: 10000 });
    await settle();
    await page.getByText('Cash in Bank', { exact: false }).first().waitFor({ timeout: 10000 }).catch(() => {}); const dash = await page.getByText('Cash in Bank', { exact: false }).count();
    record('B-dashboard', dash > 0 && page.url().endsWith('/dashboard'),
      `url=${page.url()}, "Cash in Bank" matches=${dash}`);
    await page.getByRole('link', { name: 'Customers', exact: true }).click();
    await page.waitForURL(/\/customers$/, { timeout: 10000 });
    await settle();
    const body = (await page.locator('main').first().innerText()).replace(/\s+/g, ' ');
    const hasAnanya = /Ananya/.test(body);
    const emptyState = body.includes('No customers yet');
    const rows = await page.locator('tbody tr').count();
    record('B-empty', !hasAnanya && rows === 0,
      `ananya=${hasAnanya}, tableRows=${rows}, emptyStateShown=${emptyState}, mainText="${body.slice(0, 200)}"`);
  });

  // ---------- C ----------
  await step('C', async () => {
    await page.getByRole('button', { name: /Open user menu/ }).click();
    const menuItem = page.getByRole('menuitem');
    const signOutText = (await menuItem.innerText()).trim();
    console.log(`C: sign-out control text = "${signOutText}"`);
    await menuItem.click();
    await page.waitForURL(/\/login$/, { timeout: 10000 });
    record('C-signout', true, `sign-out control "${signOutText}", url=${page.url()}`);

    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill('secret123');
    await page.locator('form:has(#login-email) button[type="submit"], form:has(#signup-name) button[type="submit"], form:has(#cust-name) button[type="submit"]').first().click();
    await page.waitForURL(/\/dashboard$/, { timeout: 10000 });
    record('C-login', true, `url=${page.url()}`);

    // sign out again, then try the wrong password
    await page.getByRole('button', { name: /Open user menu/ }).click();
    await page.getByRole('menuitem').click();
    await page.waitForURL(/\/login$/, { timeout: 10000 });
    await page.locator('#login-email').fill(email);
    await page.locator('#login-password').fill('wrong-password');
    await page.locator('form:has(#login-email) button[type="submit"], form:has(#signup-name) button[type="submit"], form:has(#cust-name) button[type="submit"]').first().click();
    const errToast = await page.getByText('Incorrect email or password.', { exact: true }).first().waitFor({ timeout: 5000 }).then(() => true).catch(() => false); console.log('C-wrong: error toast visible = ' + errToast);
    const toast = (await page.locator('[data-sonner-toast]').allInnerTexts()).join(' | ');
    const stayed = page.url().endsWith('/login');
    record('C-wrong', stayed && /Incorrect email or password/.test(toast),
      `url=${page.url()}, toast="${toast}"`);
  });

  // ---------- D (fresh context) ----------
  await step('D', async () => {
    const ctx2 = await browser.newContext();
    const p2 = await ctx2.newPage();
    const errs = [];
    p2.on('console', (m) => { if (m.type() === 'error') errs.push(`[console.error] ${m.text()}`); });
    p2.on('pageerror', (e) => errs.push(`[pageerror] ${e.message}`));
    await p2.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await p2.locator('button', { hasText: 'Instant Demo' }).first().click();
    let reached = true;
    try {
      await p2.waitForURL(/\/dashboard$/, { timeout: 10000 });
    } catch { reached = false; }
    record('D', reached, `final url=${p2.url()}, errors=${JSON.stringify(errs)}`);
    await ctx2.close();
  });
} finally {
  console.log('--- console/pageerror from main context ---');
  for (const l of consoleLines) console.log(l);
  await browser.close();
}

const failed = results.filter((r) => r.status === 'FAIL');
console.log(`SUMMARY: ${results.length - failed.length} PASS, ${failed.length} FAIL`);
process.exit(failed.length ? 1 : 0);
