import { chromium } from "playwright";
const BASE = "http://localhost:3000";
const TID = "inv_7426dfd29110a22c";
const orig = (await import("node:fs")).readFileSync(".codebenders/scratch/orig-scenario.json", "utf8");
const origJ = JSON.parse(orig);
const mk = (d) => ({ horizonDays: 90, invoiceDelayOverrides: { [TID]: d }, globalLateDaysShift: 0, extraExpenseShock: null, includeMovingAvgRisk: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(60000);
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
await page.goto(BASE + "/login");
await page.getByRole("button", { name: /Instant Demo/ }).click();
await page.waitForURL("**/dashboard", { timeout: 90000 });
const table = () => page.locator("table").filter({ hasText: "Days Below Zero" }).first();
const rowsOf = async () => {
  const out = {};
  const trs = table().locator("tr");
  const n = await trs.count();
  for (let i = 0; i < n; i++) {
    const cells = await trs.nth(i).locator("th,td").allInnerTexts();
    if (cells.length) out[cells[0].trim()] = cells.slice(1).map((c) => c.trim());
  }
  return out;
};
const run = async (label, delay) => {
  const put = await page.request.put(BASE + "/api/forecast/scenario", { data: mk(delay) });
  console.log(label, "PUT_STATUS", put.status());
  await page.goto(BASE + "/forecast");
  await page.getByText("Crunch summary", { exact: true }).waitFor();
  await table().waitFor();
  await page.waitForTimeout(2000);
  const r = await rowsOf();
  console.log(label, "ROWS", JSON.stringify(r));
  console.log(label, "HAS_NAN", /NaN/.test(await table().innerText()));
};
try {
  await run("CASE_60", 60);
  await run("CASE_95", 95);
} finally {
  const put = await page.request.put(BASE + "/api/forecast/scenario", { data: origJ });
  const back = await (await page.request.get(BASE + "/api/forecast/scenario")).json();
  console.log("RESTORE_PUT_STATUS", put.status(), "READBACK", JSON.stringify(back));
  console.log("ERRORS", JSON.stringify(errors));
  await browser.close();
}
