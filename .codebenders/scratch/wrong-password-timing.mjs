import { chromium } from 'playwright';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto('http://localhost:3000/login', { waitUntil: 'networkidle' });
await page.fill('#login-email', 'ananya@physiocare.demo');
await page.fill('#login-password', 'wrong-password');
await page.locator('form button[type="submit"]').click();
const start = Date.now();
for (const ms of [500, 1500, 2500, 3500, 4500, 5500]) {
  const wait = ms - (Date.now() - start);
  if (wait > 0) await page.waitForTimeout(wait);
  const n = await page.locator('[data-sonner-toast][data-type="error"]').count();
  const text = n ? (await page.locator('[data-sonner-toast][data-type="error"]').first().innerText()).trim() : '';
  console.log(`T=${ms}ms error_toasts=${n} text=${JSON.stringify(text)} url=${page.url()}`);
}
await browser.close();
