import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const browser = await chromium.launch({ headless: true });
const page = await (await browser.newContext()).newPage();
await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Instant Demo/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
const invs = await (await page.request.get(BASE + "/api/invoices")).json();
const rows = Array.isArray(invs) ? invs : (invs.invoices ?? []);
const t = rows.filter((i) => i.balance > 0).sort((a, b) => b.balance - a.balance)[0];
console.log("TARGET_ROW", JSON.stringify(t));
const j = await (await page.request.get(BASE + "/api/forecast?horizon=90")).json();
console.log("BASE_KEYS", Object.keys(j.baseline).join(",")); const days = j.baseline.days ?? j.baseline.points ?? []; console.log("SAMPLE", JSON.stringify(j.baseline).slice(0,300));
console.log("KEYS", Object.keys(j).join(","));
console.log("BASE_FIRST10", JSON.stringify(days.slice(0,10).map(x=>[x.date,x.balance,x.inflow]))); console.log("SIM_FIRST10", JSON.stringify(j.simulated.slice(0,10).map(x=>[x.date,x.balance,x.inflow])));  console.log("FIRST_DAYS", JSON.stringify(days.slice(0, 3).map((d) => [d.date, d.balance, d.inflow])));
console.log("NONNEG_DAYS", JSON.stringify(days.filter((d) => d.balance >= 0).map((d) => d.date)));
console.log("LAST_DAY", JSON.stringify(days.at(-1)?.date));
await browser.close();


