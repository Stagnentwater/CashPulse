import { chromium } from "playwright";
import fs from "node:fs";
const FRONT = "http://localhost:3000";
const API = "http://localhost:8001";
const TARGET = "inv_7426dfd29110a22c";
const before = JSON.parse(fs.readFileSync(".codebenders/scratch/verify-scenario-before.json", "utf8"));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
page.setDefaultTimeout(90000);
await page.goto(FRONT + "/login");
await page.getByRole("button", { name: /Instant Demo/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
console.log("HEALTH_8001", (await page.request.get(API + "/api/health")).status());
const readBefore = await (await page.request.get(API + "/api/forecast/scenario")).json();
console.log("SCENARIO_BEFORE_8001_EQUALS_SAVED", JSON.stringify(readBefore) === JSON.stringify(before));
const base = await page.request.get(API + "/api/forecast?horizon=90");
const baseText = await base.text();
fs.writeFileSync(".codebenders/scratch/verify-forecast-baseline-8001.json", baseText);
console.log("BASELINE_8001_STATUS", base.status());
let r60 = "NOT_RUN";
try {
  const put = await page.request.put(API + "/api/forecast/scenario", { data: { ...before, invoiceDelayOverrides: { [TARGET]: 60 } } });
  console.log("PUT_60_8001_STATUS", put.status());
  const f60 = await page.request.get(API + "/api/forecast?horizon=90");
  const t60 = await f60.text();
  fs.writeFileSync(".codebenders/scratch/verify-forecast-60-8001.json", t60);
  console.log("FORECAST_60_8001_STATUS", f60.status());
} finally {
  const put = await page.request.put(API + "/api/forecast/scenario", { data: before });
  const now = await (await page.request.get(API + "/api/forecast/scenario")).json();
  console.log("RESTORE_8001 PUT=" + put.status() + " EQUAL=" + (JSON.stringify(now) === JSON.stringify(before)) + " NOW=" + JSON.stringify(now));
}
await browser.close();
console.log("DONE");
