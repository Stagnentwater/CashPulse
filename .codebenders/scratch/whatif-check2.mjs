import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

const crunchTable = () => page.locator("table").filter({ hasText: "Days Below Zero" }).first();
const tableText = async () => { await crunchTable().waitFor(); return (await crunchTable().innerText()).trim(); };
const dbzChange = async () => {
  const row = crunchTable().locator("tr").filter({ hasText: "Days Below Zero" }).first();
  return (await row.locator("td").last().innerText()).trim();
};
const forecastCrunch = async (label) => {
  const r = await page.request.get(BASE + "/api/forecast?horizon=90");
  const j = await r.json();
  log(label, "baseline.days_below_zero=" + j.crunch?.baseline?.days_below_zero, "simulated.days_below_zero=" + j.crunch?.simulated?.days_below_zero);
};

await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Instant Demo/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
await page.goto(BASE + "/forecast");
await page.getByText("Crunch summary", { exact: true }).waitFor();
await page.waitForTimeout(1500);

log("BEFORE_TABLE_START\n" + await tableText() + "\nBEFORE_TABLE_END");
log("BEFORE_DBZ_CHANGE=" + await dbzChange());

const invs = await (await page.request.get(BASE + "/api/invoices")).json();
const rows = Array.isArray(invs) ? invs : (invs.invoices ?? []);
const target = rows.filter((i) => i.balance > 0).sort((a, b) => b.balance - a.balance)[0];
log("TARGET_INVOICE", JSON.stringify({ id: target?.id, customer: target?.customerName, balance: target?.balance }));
if (!target) throw new Error("no unpaid invoice");

const scenario = {
  horizonDays: 90,
  invoiceDelayOverrides: { [target.id]: 40 },
  globalLateDaysShift: 10,
  extraExpenseShock: null,
  includeMovingAvgRisk: true,
};
const put = await page.request.put(BASE + "/api/forecast/scenario", { data: scenario });
log("PUT_SCENARIO_STATUS", put.status(), (await put.text()).slice(0, 300));

const start = Date.now();
let after = null;
while (Date.now() - start < 12000) {
  await page.waitForTimeout(1000);
  after = await dbzChange();
  if (after !== "No change") break;
}
log("AFTER_WAIT_SECONDS", Math.round((Date.now() - start) / 1000));
log("AFTER_TABLE_START\n" + await tableText() + "\nAFTER_TABLE_END");
log("AFTER_DBZ_CHANGE=" + after);
await forecastCrunch("API_AFTER_SCENARIO");

const reset = {
  horizonDays: 90,
  invoiceDelayOverrides: {},
  globalLateDaysShift: 0,
  extraExpenseShock: null,
  includeMovingAvgRisk: true,
};
const putBack = await page.request.put(BASE + "/api/forecast/scenario", { data: reset });
log("PUT_RESET_STATUS", putBack.status());
await forecastCrunch("API_AFTER_RESET");

log("VERDICT=" + (after !== "No change" ? "PASS" : "FAIL") + " (Days Below Zero change cell = " + after + ")");
log("ERRORS_START");
for (const e of errors) log(e);
log(errors.length === 0 ? "none" : "ERRORS_END (" + errors.length + ")");
await browser.close();
