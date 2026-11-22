import { chromium } from "playwright";

const BASE = "http://localhost:3000";
const API = "http://localhost:8000";
const log = (...a) => console.log(...a);
const errors = [];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(60000);
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

const crunchTable = async () => {
  const card = page
    .locator("div", { has: page.getByText("Crunch summary", { exact: true }) })
    .filter({ has: page.locator("table") })
    .last();
  return (await card.locator("table").innerText()).trim();
};
const chartHtml = async () => {
  const w = page.locator(".recharts-wrapper").first();
  if ((await w.count()) === 0) return "NO_RECHARTS_WRAPPER";
  return await w.innerHTML();
};

let restoreStatus = "not run";
try {
  await page.goto(BASE + "/login");
  await page.getByRole("button", { name: /Instant Demo/ }).click();
  await page.waitForURL("**/dashboard", { timeout: 90000 });

  await page.goto(BASE + "/forecast");
  await page.getByRole("heading", { name: "Crunch summary" }).waitFor();
  await new Promise((r) => setTimeout(r, 2000));

  const beforeTable = await crunchTable();
  const beforeChart = await chartHtml();
  log("BEFORE_TABLE:\n" + beforeTable);

  const inv = await (await page.request.get(API + "/api/invoices")).json();
  const rows = Array.isArray(inv) ? inv : inv.invoices ?? [];
  const unpaid = rows.filter((r) => Number(r.balance) > 0).sort((a, b) => Number(b.balance) - Number(a.balance));
  if (!unpaid.length) throw new Error("no unpaid invoice");
  const target = unpaid[0];
  log("TARGET_INVOICE id=" + target.id + " balance=" + target.balance);

  const put1 = await page.request.put(BASE + "/api/forecast/scenario", {
    data: {
      horizonDays: 90,
      invoiceDelayOverrides: { [target.id]: 30 },
      globalLateDaysShift: 10,
      extraExpenseShock: null,
      includeMovingAvgRisk: true,
    },
  });
  log("PUT_SCENARIO_STATUS", put1.status(), (await put1.text()).slice(0, 300));

  const start = Date.now();
  let afterTable = beforeTable;
  let afterChart = beforeChart;
  while (Date.now() - start < 12000) {
    await new Promise((r) => setTimeout(r, 1000));
    afterTable = await crunchTable();
    afterChart = await chartHtml();
    if (afterTable !== beforeTable || afterChart !== beforeChart) break;
  }
  log("AFTER_TABLE (waited " + Math.round((Date.now() - start) / 1000) + "s):\n" + afterTable);

  const tableChanged = afterTable !== beforeTable;
  const chartChanged = afterChart !== beforeChart;
  const changeLines = afterTable.split("\n").filter((l) => /Change/i.test(l) || /[+-]?₹/.test(l));
  const nonZero = afterTable.split("\n").some((l) => /₹\s?[1-9]|[+-]\s?₹|\+₹|-₹/.test(l) && !/₹\s?0(\.0+)?\s*$/.test(l));
  log("TABLE_CHANGED=" + tableChanged + " CHART_CHANGED=" + chartChanged + " NONZERO_CHANGE_TEXT=" + nonZero);
  log("RESULT=" + (tableChanged || chartChanged ? "PASS" : "FAIL"));
} catch (e) {
  log("SCRIPT_ERROR: " + e.message);
  log("RESULT=FAIL");
} finally {
  try {
    const put2 = await page.request.put(BASE + "/api/forecast/scenario", {
      data: {
        horizonDays: 90,
        invoiceDelayOverrides: {},
        globalLateDaysShift: 0,
        extraExpenseShock: null,
        includeMovingAvgRisk: true,
      },
    });
    restoreStatus = "PUT " + put2.status();
  } catch (e) {
    restoreStatus = "restore failed: " + e.message;
  }
  log("RESTORE_STATUS " + restoreStatus);
  log("ERRORS " + (errors.length ? JSON.stringify(errors, null, 1) : "none"));
  await browser.close();
}
