import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
page.setDefaultTimeout(90000);
await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Instant Demo/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
await page.goto(BASE + "/forecast");
await page.waitForLoadState("networkidle");
await page.waitForTimeout(2000);
const all = await page.locator("body").innerText();
for (const label of ["Lowest Projected Balance", "Cash Gap to Cover"]) {
  const idx = all.indexOf(label);
  console.log("LABEL_FOUND", label, idx);
  console.log("BODY_CONTEXT", label, JSON.stringify(all.slice(idx, idx + 140)));
  const chars = [...all.slice(idx, idx + 140)].filter(c => /[-\u2212\u2012\u2013\u2014\u2010\u2011]/.test(c)).map(c => "U+" + c.codePointAt(0).toString(16).toUpperCase());
  console.log("MINUS_CHARS", label, JSON.stringify(chars));
}
const card = page.locator("text=Lowest Projected Balance").first().locator("xpath=..");
console.log("CARD_TEXT", JSON.stringify(await card.innerText()));
await browser.close();
console.log("DONE");
