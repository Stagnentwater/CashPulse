import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const log = (...a) => console.log(...a);
const TITLE = "Live check bill 1000";

async function readKpi(page, label) {
  const loc = page.getByText(label, { exact: true }).first();
  await loc.waitFor();
  return loc.evaluate((el) => {
    let node = el;
    while (node) {
      const t = node.innerText || "";
      const m = t.match(/₹\s?[\d,]+(?:\.\d+)?/);
      if (m) return { amount: m[0], cardText: t.replace(/\s+/g, " ").trim() };
      node = node.parentElement;
    }
    return null;
  });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(60000);

await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Instant Demo/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
await page.getByText("Total Owed to Me", { exact: true }).waitFor();
await page.waitForTimeout(2000);

const KP = ["Total Owed to Me", "Overdue Receivables"];
const snap = async (p) => ({ owed: await readKpi(p, KP[0]), overdue: await readKpi(p, KP[1]) });

const before = await snap(page);
log("BEFORE", JSON.stringify(before));

const invs = await (await page.request.get(BASE + "/api/invoices")).json();
const rows = Array.isArray(invs) ? invs : (invs.invoices ?? []);
log("INVOICE_COUNT", rows.length, "KEYS", JSON.stringify(Object.keys(rows[0] ?? {})));
for (const i of rows.filter((x) => /Rajesh/.test(x.customerName ?? ""))) {
  log("RAJESH_ROW", JSON.stringify({ id: i.id, num: i.invoiceNumber, balance: i.balance, daysOverdue: i.daysOverdue, status: i.status }));
}
const target =
  rows.find((i) => /Rajesh/.test(i.customerName ?? "") && i.balance > 0 && i.daysOverdue > 0) ??
  rows.find((i) => i.balance > 0);
log("TARGET", JSON.stringify(target ?? null));
if (!target) throw new Error("no Rajesh invoice with balance > 0");

const pay = await page.request.post(`${BASE}/api/invoices/${target.id}/payments`, { data: { amount: target.balance } });
log("PAYMENT_STATUS", pay.status(), (await pay.text()).slice(0, 300));

// Step 4 setup: forecast page open in a second tab before the bill exists.
const forecastTab = await context.newPage();
await forecastTab.goto(BASE + "/forecast");
await forecastTab.waitForLoadState("networkidle");
log("FORECAST_TAB_HAS_BILL_BEFORE", (await forecastTab.locator("body").innerText()).includes(TITLE));

// Step 3: poll the ORIGINAL dashboard page for 15s, no reload.
const start = Date.now();
let last = before;
while (Date.now() - start < 15000) {
  await page.waitForTimeout(3000);
  last = await snap(page);
  log("POLL", Math.round((Date.now() - start) / 1000) + "s", JSON.stringify(last));
}
const changed = JSON.stringify(last) !== JSON.stringify(before);
log("DASHBOARD_AFTER_15S_NO_RELOAD", JSON.stringify(last), "CHANGED=" + changed);
await page.reload();
await page.getByText("Total Owed to Me", { exact: true }).waitFor();
await page.waitForTimeout(2000);
log("DASHBOARD_AFTER_RELOAD", JSON.stringify(await snap(page)));

// Step 4: bill due in 3 days, amount 1000; check forecast tab without reload.
const dueDate = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
const bill = await page.request.post(BASE + "/api/bills", {
  data: { title: TITLE, category: "SUPPLIER", amount: 1000, dueDate, isRecurringMonthly: false, isDeferrable: false },
});
log("BILL_STATUS", bill.status(), (await bill.text()).slice(0, 300));

await forecastTab.waitForTimeout(15000);
log("FORECAST_TAB_HAS_BILL_AFTER_15S_NO_RELOAD", (await forecastTab.locator("body").innerText()).includes(TITLE));

await browser.close();
log("DONE");


