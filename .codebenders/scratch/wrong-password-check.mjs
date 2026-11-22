// Wrong-password toast check for CashPulse login. Scratch file.
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#login-email', 'ananya@physiocare.demo');
await page.fill('#login-password', 'wrong-password');
await page.locator('form button[type="submit"]').click();
await page.waitForTimeout(5000);

const urlAfterWrong = page.url();
const bodyText = await page.innerText('body');
const toastEls = page.locator('[role="status"], [class*="toast"], [data-sonner-toast]');
const toasts = [];
for (let i = 0; i < (await toastEls.count()); i++) {
  const el = toastEls.nth(i);
  if (await el.isVisible().catch(() => false)) toasts.push((await el.innerText()).trim());
}

console.log(`WRONG_URL=${urlAfterWrong}`);
console.log(`WRONG_URL_ENDS_LOGIN=${urlAfterWrong.replace(/[?#].*$/, '').endsWith('/login')}`);
console.log(`WRONG_HAS_INCORRECT_TEXT=${bodyText.includes('Incorrect email or password')}`);
console.log(`WRONG_HAS_EMAIL_OR_PASSWORD_IS_INCORRECT=${bodyText.includes('Email or password is incorrect')}`);
console.log(`WRONG_TOAST_TEXTS=${JSON.stringify(toasts)}`);

// Correct login on the same page, to confirm the fix did not break it.
await page.fill('#login-password', 'demo1234');
await page.locator('form button[type="submit"]').click();
try {
  await page.waitForURL(/\/dashboard\/?$/, { timeout: 10000 });
} catch (e) {
  // fall through; URL printed below shows the result
}
console.log(`CORRECT_URL=${page.url()}`);
console.log(`CORRECT_URL_ENDS_DASHBOARD=${/\/dashboard\/?([?#].*)?$/.test(page.url())}`);

await browser.close();
