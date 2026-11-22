import { chromium } from "playwright";
import fs from "node:fs";
const BASE = "http://localhost:3000";
const TARGET = "inv_7426dfd29110a22c";
const before = JSON.parse(fs.readFileSync(".codebenders/scratch/verify-scenario-before.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(90000);
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

const readTable = async () => {
  const table = page.locator("table").filter({ hasText: /Days below zero/i }).first();
  await table.waitFor();
  const headers = await table.locator("thead th").allInnerTexts();
  const rows = await table.locator("tbody tr").evaluateAll((trs) =>
    trs.map((tr) => Array.from(tr.querySelectorAll("th,td")).map((c) => c.innerText.trim())));
  return { headers, rows };
};

let restoreResult = "NOT_ATTEMPTED";
try {
  await page.goto(BASE + "/login");
  await page.getByRole("button", { name: /Instant Demo/ }).click();
  await page.waitForURL("**/dashboard", { timeout: 90000 });
  await page.goto(BASE + "/forecast");
  await page.getByText("Crunch summary", { exact: true }).waitFor();
  await page.waitForTimeout(1500);
  const t0 = await readTable();
  console.log("BASELINE_HEADERS", JSON.stringify(t0.headers));
  console.log("BASELINE_ROWS", JSON.stringify(t0.rows));

  const scen = { ...before, invoiceDelayOverrides: { [TARGET]: 60 } };
  const put = await page.request.put(BASE + "/api/forecast/scenario", { data: scen });
  console.log("PUT_60_STATUS", put.status(), (await put.text()).slice(0, 400));

  await page.reload();
  await page.getByText("Crunch summary", { exact: true }).waitFor();
  await page.waitForTimeout(3000);
  const t1 = await readTable();
  console.log("AFTER60_HEADERS", JSON.stringify(t1.headers));
  console.log("AFTER60_ROWS", JSON.stringify(t1.rows));

  const fc = await page.request.get(BASE + "/api/forecast?horizon=90");
  const fcText = await fc.text();
  fs.writeFileSync(".codebenders/scratch/verify-forecast-60.json", fcText);
  console.log("FORECAST_60_STATUS", fc.status());
} catch (e) {
  console.log("CHECK_ERROR", e.message);
} finally {
  const put = await page.request.put(BASE + "/api/forecast/scenario", { data: before });
  const back = await page.request.get(BASE + "/api/forecast/scenario");
  const backJson = await back.json();
  const same = JSON.stringify(backJson) === JSON.stringify(before);
  restoreResult = `PUT=${put.status()} GET_EQUAL_TO_BEFORE=${same} NOW=${JSON.stringify(backJson)}`;
  console.log("RESTORE", restoreResult);
}
console.log("ERRORS_START");
for (const e of errors) console.log(e);
console.log("ERRORS_END count=" + errors.length);
await browser.close();
console.log("DONE");
