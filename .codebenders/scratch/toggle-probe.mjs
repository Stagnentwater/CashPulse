import { projectCashflow } from "../../src/lib/financeEngine.ts";
import { addDays, toISODate, diffDays } from "../../src/lib/format.ts";

const today = new Date();
const todayISO = toISODate(today);
const dueISO = toISODate(addDays(today, 5));

function run(label, pastInvoiceCount, includeMovingAvgRisk) {
  const snap = {
    today: todayISO,
    bankBalance: 0,
    customers: [{ id: "c1", name: "Alpha", phone: "", relationshipTier: "REGULAR",
      pastInvoiceCount, pastLateCount: 0, movingAvgDelayDays: 10, createdAt: todayISO }],
    invoices: [{ id: "i1", invoiceNumber: "INV-1", customerId: "c1", serviceDescription: "x",
      amount: 10000, amountPaid: 0, issueDate: todayISO, dueDate: dueISO, status: "SENT",
      upiLink: "", createdBy: "USER" }],
    bills: [],
    whatIf: { horizonDays: 90, invoiceDelayOverrides: {}, globalLateDaysShift: 0,
      extraExpenseShock: null, includeMovingAvgRisk },
  };
  const { baseline } = projectCashflow(snap, 90);
  const day = baseline.find((d) => d.inflow > 0);
  console.log(JSON.stringify({
    label, pastInvoiceCount, includeMovingAvgRisk,
    todayISO, dueISO,
    landsOn: day ? day.date : null,
    landsOffsetFromToday: day ? diffDays(todayISO, day.date) : null,
    landsOffsetFromDue: day ? diffDays(dueISO, day.date) : null,
    inflowAmount: day ? day.inflow : 0,
  }));
}

run("A: pastCount=3, toggle TRUE", 3, true);
run("B: pastCount=3, toggle FALSE", 3, false);
run("C: pastCount=1, toggle TRUE", 1, true);
