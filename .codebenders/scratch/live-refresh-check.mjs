// Live-refresh verification. Same browser context for pages and API calls. No page reloads after the initial load.
import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const API = "http://localhost:8000";
const POLL_MS = 12000;
const log = (...a) => console.log(...a);

const isoLocal = (offsetDays) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

// Walks up from the label element until an ancestor contains a rupee amount.
async function readKpi(page, label) {
  const loc = page.getByText(label, { exact: true }).first();
  await loc.waitFor();
  return loc.evaluate((el) => {
    let node = el;
    while (node) {
      const t = node.innerText || "";
      const m = t.match(/₹\s?[\d,]+(?:\.\d+)?/);
      if (m) return m[0];
      node = node.parentElement;
    }
    return null;
  });
}

const consoleErrors = {};
const apiFailures = {};
function attachDiagnostics(page, name) {
  consoleErrors[name] = [];
  apiFailures[name] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors[name].push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors[name].push("PAGEERROR: " + err.message));
  page.on("response", (res) => {
    if (res.url().includes("/api/") && res.status() >= 400) {
      apiFailures[name].push(`${res.status()} ${res.request().method()} ${res.url()}`);
    }
  });
}

async function pollUntil(label, readFn, before) {
  const start = Date.now();
  let last = before;
  let changedAt = null;
  while (Date.now() - start < POLL_MS) {
    await new Promise((r) => setTimeout(r, 1000));
    last = await readFn();
    if (changedAt === null && JSON.stringify(last) !== JSON.stringify(before)) {
      changedAt = Math.round((Date.now() - start) / 1000);
    }
  }
  log(`${label} POLL_END after ${POLL_MS / 1000}s, changedAt=${changedAt}`);
  return { last, changed: changedAt !== null };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(60000);
attachDiagnostics(page, "dashboard");

// Login
await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Instant Demo/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
await page.getByText("Total Owed to Me", { exact: true }).waitFor();
await new Promise((r) => setTimeout(r, 2000));

// ---------- CHECK 1: dashboard ----------
const dashBefore = await readKpi(page, "Total Owed to Me");
log("DASH_BEFORE Total Owed to Me =", dashBefore);

const invRes = await page.request.get(API + "/api/invoices");
const invs = await invRes.json();
const rows = Array.isArray(invs) ? invs : invs.invoices ?? [];
log("INVOICES_API_STATUS", invRes.status(), "COUNT", rows.length, "KEYS", JSON.stringify(Object.keys(rows[0] ?? {})));
const target = rows.find((i) => i.balance > 0);
log("TARGET_INVOICE", JSON.stringify(target ?? null));
if (!target) throw new Error("no invoice with balance > 0 to pay");

const pay = await page.request.post(`${API}/api/invoices/${target.id}/payments`, { data: { amount: target.balance } });
log("PAYMENT_STATUS", pay.status(), (await pay.text()).slice(0, 300));

const dash = await pollUntil("DASH", () => readKpi(page, "Total Owed to Me"), dashBefore);
log("DASH_AFTER Total Owed to Me =", dash.last, "RESULT=" + (dash.changed ? "PASS" : "FAIL"));

// ---------- CHECK 2: forecast ----------
const fpage = await context.newPage();
attachDiagnostics(fpage, "forecast");
await fpage.goto(BASE + "/forecast");
await fpage.getByText("Lowest Projected Balance", { exact: true }).waitFor();
await new Promise((r) => setTimeout(r, 2000));
const fcLabel = "Lowest Projected Balance";
const fcBefore = await readKpi(fpage, fcLabel);
const fcGapBefore = await readKpi(fpage, "Cash Gap to Cover");
const fcApiBefore = await (await fpage.request.get(API + "/api/forecast")).text();
log("FORECAST_BEFORE", fcLabel, "=", fcBefore, "| Cash Gap =", fcGapBefore);
log("FORECAST_API_BEFORE", fcApiBefore.slice(0, 500));

const TITLE = "Live refresh check";
const billRes = await fpage.request.post(API + "/api/bills", {
  data: { title: TITLE, category: "SUPPLIER", amount: 500, dueDate: isoLocal(3), isRecurringMonthly: false, isDeferrable: false },
});
log("BILL_STATUS", billRes.status(), (await billRes.text()).slice(0, 300));

const fc = await pollUntil(
  "FORECAST",
  async () => [await readKpi(fpage, fcLabel), await readKpi(fpage, "Cash Gap to Cover")],
  [fcBefore, fcGapBefore]
);
const fcApiAfter = await (await fpage.request.get(API + "/api/forecast")).text();
log("FORECAST_AFTER", fcLabel, "=", fc.last[0], "| Cash Gap =", fc.last[1], "RESULT=" + (fc.changed ? "PASS" : "FAIL"));
log("FORECAST_API_AFTER", fcApiAfter.slice(0, 500));

// ---------- CHECK 3: invoices ----------
const ipage = await context.newPage();
attachDiagnostics(ipage, "invoices");
await ipage.goto(BASE + "/invoices");
await ipage.getByRole("table").waitFor();
await new Promise((r) => setTimeout(r, 2000));
const countRows = () => ipage.locator("tbody tr", { hasText: /INV-\d{4}-\d{3}/ }).count();
const rowsBefore = await countRows();
log("INVOICE_ROWS_BEFORE", rowsBefore);

const customers = await (await ipage.request.get(API + "/api/customers")).json();
const cust = Array.isArray(customers) ? customers : customers.customers ?? [];
if (!cust.length) throw new Error("no customers");
const invCreate = await ipage.request.post(API + "/api/invoices", {
  data: { customerId: cust[0].id, amount: 700, dueDate: isoLocal(5) },
});
const created = await invCreate.json();
log("INVOICE_CREATE_STATUS", invCreate.status(), "NUMBER", created.invoiceNumber, "ID", created.id);

const start = Date.now();
let foundAt = null;
while (Date.now() - start < POLL_MS) {
  await new Promise((r) => setTimeout(r, 1000));
  const body = await ipage.locator("body").innerText();
  if (foundAt === null && body.includes(created.invoiceNumber)) foundAt = Math.round((Date.now() - start) / 1000);
}
const rowsAfter = await countRows();
log("INVOICE_ROWS_AFTER", rowsAfter, "NEW_NUMBER_VISIBLE_AT", foundAt, "RESULT=" + (foundAt !== null ? "PASS" : "FAIL"));

await browser.close();

log("CONSOLE_ERRORS", JSON.stringify(consoleErrors, null, 1));
log("API_FAILURES", JSON.stringify(apiFailures, null, 1));
log("DONE");
