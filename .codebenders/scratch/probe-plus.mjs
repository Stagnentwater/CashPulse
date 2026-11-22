// Scratch probe: does the "+" exist in DOM text or only via CSS ::before? Not part of src/.
import { chromium } from 'playwright';

const BASE = 'http://localhost:3000';
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.locator('button', { hasText: 'Instant Demo' }).first().click();
await page.waitForURL(/\/dashboard\/?$/, { timeout: 20000 });

for (const [path, label] of [['/customers', 'Add Customer'], ['/invoices', 'New Invoice']]) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const info = await page.evaluate((lbl) => {
    const btn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes(lbl));
    if (!btn) return 'NOT FOUND';
    return {
      textContent: btn.textContent,
      before: getComputedStyle(btn, '::before').content,
      after: getComputedStyle(btn, '::after').content,
      visible: btn.offsetHeight > 0,
    };
  }, label);
  console.log(path, JSON.stringify(info));
  const plusMatch = await page.getByText(`+ ${label}`, { exact: false }).count();
  const plainMatch = await page.getByRole('button', { name: label }).count();
  console.log(`  getByText('+ ${label}') count=${plusMatch}; getByRole(button, '${label}') count=${plainMatch}`);
}
await browser.close();
