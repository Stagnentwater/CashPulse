// Pure money math for CashPulse. No I/O, no LLM, no React.
// All balances, overdue days, aging, delay risk and 30-90 day projections live here.

import type {
  Customer,
  Invoice,
  InvoiceStatus,
  RiskLevel,
  UpcomingBill,
  WhatIfScenario,
} from "../types/domain";
import {
  addDays,
  diffDays,
  formatDateShort,
  formatINR,
  parseISODate,
  toISODate,
} from "./format";

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// ---------- Types ----------

/** Everything the engine needs, plus the reference "today" as YYYY-MM-DD. */
export interface EngineSnapshot {
  today: string;
  bankBalance: number;
  customers: Customer[];
  invoices: Invoice[];
  bills: UpcomingBill[];
  whatIf: WhatIfScenario;
}

/** One line in a day's inflow or outflow list. */
export interface FlowItem {
  kind: "INVOICE" | "BILL" | "SHOCK";
  refId: string;
  label: string;
  amount: number;
}

export interface ProjectionDay {
  date: string;
  inflow: number;
  outflow: number;
  balance: number;
  inflows: FlowItem[];
  outflows: FlowItem[];
}

export interface BillOccurrence {
  billId: string;
  title: string;
  amount: number;
  date: string;
  isDeferrable: boolean;
  deferred: boolean;
}

export interface CrunchSummary {
  firstCrunchDate: string | null;
  lowestBalance: number;
  lowestBalanceDate: string | null;
  shortfallAmount: number;
  cashSafeUntil: string | null;
}

export type AgingKey = "UPCOMING" | "D1_7" | "D8_15" | "D16_PLUS";

export interface AgingBucket {
  key: AgingKey;
  label: string;
  total: number;
  count: number;
  invoiceIds: string[];
}

export interface MonthSummary {
  month: string; // YYYY-MM
  label: string; // e.g. "Jun 2026"
  inflow: number;
  outflow: number;
  net: number;
}

export interface PriorityAlert {
  id: string;
  rank: number;
  severity: "critical" | "warning" | "info";
  title: string;
  detail: string;
  amountAtStake: number;
  billId?: string;
  invoiceId?: string;
  customerId?: string;
}

export interface ApplyPaymentResult {
  applied: number;
  invoice: { amountPaid: number; status: InvoiceStatus };
  customer: { pastInvoiceCount: number; pastLateCount: number; movingAvgDelayDays: number };
}

// ---------- Small helpers ----------

/** Rounds to one decimal place. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** Adds k months to a YYYY-MM-DD date, clamping the day to the month's length. */
function addMonthsClamped(iso: string, k: number): string {
  const d = parseISODate(iso);
  const target = new Date(d.getFullYear(), d.getMonth() + k, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  const day = Math.min(d.getDate(), lastDay);
  return toISODate(new Date(target.getFullYear(), target.getMonth(), day));
}

// ---------- Snapshot ----------

/** Builds an engine snapshot. `today` is the local calendar date; callers pass it explicitly. */
export function makeSnapshot(
  source: {
    bankBalance: number;
    customers: Customer[];
    invoices: Invoice[];
    bills: UpcomingBill[];
    whatIf: WhatIfScenario;
  },
  today: Date,
): EngineSnapshot {
  return { ...source, today: toISODate(today) };
}

// ---------- Invoices ----------

/** Unpaid amount on an invoice, never negative. */
export function invoiceBalanceDue(invoice: Invoice): number {
  return Math.max(0, invoice.amount - invoice.amountPaid);
}

/** Days past due date while a balance remains; 0 otherwise. */
export function invoiceDaysOverdue(invoice: Invoice, today: string): number {
  if (invoiceBalanceDue(invoice) > 0 && invoice.dueDate < today) {
    return diffDays(invoice.dueDate, today);
  }
  return 0;
}

/** Client payment habit. Needs at least 2 past invoices to be meaningful. */
export function clientDelayRisk(customer: Customer): {
  label: string;
  risk: RiskLevel | null;
  avgDaysLate: number | null;
} {
  if (customer.pastInvoiceCount < 2) {
    return { label: "Limited history", risk: null, avgDaysLate: null };
  }
  const avg = customer.movingAvgDelayDays;
  const risk: RiskLevel = avg <= 5 ? "Low" : avg <= 15 ? "Medium" : "High";
  return { label: `${risk} risk (avg ${Math.round(avg)}d late)`, risk, avgDaysLate: avg };
}

// ---------- Bills ----------

/**
 * Expands bills into dated outflows within [fromISO, toISO].
 * Recurring bills repeat monthly from their dueDate. deferredDays shifts each date.
 * Paid bills produce no occurrences.
 */
export function expandBillOccurrences(
  bills: UpcomingBill[],
  fromISO: string,
  toISO: string,
): BillOccurrence[] {
  const out: BillOccurrence[] = [];
  for (const bill of bills) {
    if (bill.isPaid) continue;
    const deferred = bill.deferredDays > 0;
    const push = (baseISO: string) => {
      const date = toISODate(addDays(baseISO, bill.deferredDays));
      if (date >= fromISO && date <= toISO) {
        out.push({
          billId: bill.id,
          title: bill.title,
          amount: bill.amount,
          date,
          isDeferrable: bill.isDeferrable,
          deferred,
        });
      }
    };

    if (!bill.isRecurringMonthly) {
      push(bill.dueDate);
      continue;
    }

    // Start a couple of months before the window to allow for deferral shifts.
    const from = parseISODate(bill.dueDate);
    const to = parseISODate(fromISO);
    const monthsBetween = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
    const startK = Math.max(0, monthsBetween - 2);
    for (let k = startK; ; k++) {
      const base = addMonthsClamped(bill.dueDate, k);
      if (base > toISO && toISODate(addDays(base, bill.deferredDays)) > toISO) break;
      push(base);
    }
  }
  return out;
}

// ---------- Cashflow projection ----------

/**
 * Day-by-day projection for `horizonDays` days starting at snapshot.today.
 * Baseline: invoices land on dueDate + round(movingAvgDelayDays).
 * Simulated: adds global shift, per-invoice overrides and the expense shock.
 * Receipts expected before today are pushed to today + 7.
 */
export function projectCashflow(
  snapshot: EngineSnapshot,
  horizonDays: 30 | 60 | 90,
): { baseline: ProjectionDay[]; simulated: ProjectionDay[] } {
  const { today, bankBalance, customers, invoices, bills, whatIf } = snapshot;
  const dates = Array.from({ length: horizonDays }, (_, i) => toISODate(addDays(today, i)));
  const endISO = dates[dates.length - 1];
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const open = invoices.filter((inv) => invoiceBalanceDue(inv) > 0);
  const occurrences = expandBillOccurrences(bills, today, endISO);

  const build = (simulated: boolean): ProjectionDay[] => {
    const inflowsByDay: FlowItem[][] = dates.map(() => []);
    const outflowsByDay: FlowItem[][] = dates.map(() => []);

    // Index of an ISO date within the horizon, or -1 if outside it.
    const indexOf = (iso: string) => {
      const idx = diffDays(today, iso);
      return idx >= 0 && idx < horizonDays ? idx : -1;
    };

    for (const inv of open) {
      const cust = customerById.get(inv.customerId);
      let shift = cust && whatIf.includeMovingAvgRisk && cust.pastInvoiceCount >= 2 ? Math.round(cust.movingAvgDelayDays) : 0;
      if (simulated) {
        shift += whatIf.globalLateDaysShift + (whatIf.invoiceDelayOverrides[inv.id] ?? 0);
      }
      const expected = toISODate(addDays(inv.dueDate, shift));
      // A receipt that is already past is assumed to land in a week.
      const receipt = diffDays(expected, today) > 0 ? toISODate(addDays(today, 7)) : expected;
      const idx = indexOf(receipt);
      if (idx >= 0) {
        inflowsByDay[idx].push({
          kind: "INVOICE",
          refId: inv.id,
          label: `${cust?.name ?? "Customer"} · ${inv.invoiceNumber}`,
          amount: invoiceBalanceDue(inv),
        });
      }
    }

    for (const occ of occurrences) {
      const idx = indexOf(occ.date);
      if (idx >= 0) {
        outflowsByDay[idx].push({ kind: "BILL", refId: occ.billId, label: occ.title, amount: occ.amount });
      }
    }

    const shock = whatIf.extraExpenseShock;
    if (simulated && shock && shock.dayOffset >= 0 && shock.dayOffset < horizonDays) {
      outflowsByDay[shock.dayOffset].push({ kind: "SHOCK", refId: "shock", label: shock.title, amount: shock.amount });
    }

    // Roll the balance forward from bank cash.
    let balance = bankBalance;
    return dates.map((date, i) => {
      const inflows = inflowsByDay[i];
      const outflows = outflowsByDay[i];
      const inflow = inflows.reduce((s, f) => s + f.amount, 0);
      const outflow = outflows.reduce((s, f) => s + f.amount, 0);
      balance += inflow - outflow;
      return { date, inflow, outflow, balance, inflows, outflows };
    });
  };

  return { baseline: build(false), simulated: build(true) };
}

/**
 * Finds the first day the balance goes below zero and the lowest balance.
 * cashSafeUntil is the day before the first crunch. If there is no crunch it is the last day.
 * It is null when the crunch starts on day one or the list is empty.
 */
export function detectCrunch(days: ProjectionDay[]): CrunchSummary {
  if (days.length === 0) {
    return {
      firstCrunchDate: null,
      lowestBalance: 0,
      lowestBalanceDate: null,
      shortfallAmount: 0,
      cashSafeUntil: null,
    };
  }

  let lowest = days[0];
  for (const d of days) {
    if (d.balance < lowest.balance) lowest = d;
  }

  const firstNeg = days.findIndex((d) => d.balance < 0);
  let cashSafeUntil: string | null;
  if (firstNeg === -1) {
    cashSafeUntil = days[days.length - 1].date;
  } else if (firstNeg === 0) {
    cashSafeUntil = null;
  } else {
    cashSafeUntil = days[firstNeg - 1].date;
  }

  return {
    firstCrunchDate: firstNeg === -1 ? null : days[firstNeg].date,
    lowestBalance: lowest.balance,
    lowestBalanceDate: lowest.date,
    shortfallAmount: Math.max(0, -lowest.balance),
    cashSafeUntil,
  };
}

// ---------- Receivables and summaries ----------

/** Open invoices grouped by how late they are. "15+" means 16 or more days. */
export function receivablesAging(snapshot: EngineSnapshot): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { key: "UPCOMING", label: "Upcoming", total: 0, count: 0, invoiceIds: [] },
    { key: "D1_7", label: "1–7 Days Late", total: 0, count: 0, invoiceIds: [] },
    { key: "D8_15", label: "8–15 Days Late", total: 0, count: 0, invoiceIds: [] },
    { key: "D16_PLUS", label: "15+ Days Late", total: 0, count: 0, invoiceIds: [] },
  ];

  for (const inv of snapshot.invoices) {
    const balance = invoiceBalanceDue(inv);
    if (balance <= 0) continue;
    const days = invoiceDaysOverdue(inv, snapshot.today);
    const idx = days === 0 ? 0 : days <= 7 ? 1 : days <= 15 ? 2 : 3;
    const b = buckets[idx];
    b.total += balance;
    b.count += 1;
    b.invoiceIds.push(inv.id);
  }
  return buckets;
}

function monthLabel(key: string): string {
  return `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

/** Inflow, outflow and net for the first 3 calendar months of the 90-day baseline. */
export function threeMonthSummary(snapshot: EngineSnapshot): MonthSummary[] {
  const { baseline } = projectCashflow(snapshot, 90);
  const rows: { month: string; inflow: number; outflow: number }[] = [];
  for (const day of baseline) {
    const key = day.date.slice(0, 7);
    let row = rows.find((r) => r.month === key);
    if (!row) {
      if (rows.length === 3) break;
      row = { month: key, inflow: 0, outflow: 0 };
      rows.push(row);
    }
    row.inflow += day.inflow;
    row.outflow += day.outflow;
  }
  return rows.map((r) => ({
    month: r.month,
    label: monthLabel(r.month),
    inflow: r.inflow,
    outflow: r.outflow,
    net: r.inflow - r.outflow,
  }));
}

// ---------- Priority alerts ----------

const SEVERITY_ORDER: Record<PriorityAlert["severity"], number> = { critical: 0, warning: 1, info: 2 };

/**
 * Ranked alerts: critical cash crunch (with the bill at risk and the biggest overdue
 * invoice to chase), warning per overdue invoice, info per deferrable bill due within 14 days.
 */
export function buildPriorityAlerts(snapshot: EngineSnapshot): PriorityAlert[] {
  const { today, customers, invoices, bills } = snapshot;
  const { baseline } = projectCashflow(snapshot, 90);
  const crunch = detectCrunch(baseline);
  const nameOf = (id: string) => customers.find((c) => c.id === id)?.name ?? "customer";

  const overdue = invoices
    .filter((inv) => invoiceBalanceDue(inv) > 0 && invoiceDaysOverdue(inv, today) > 0)
    .sort((a, b) => invoiceBalanceDue(b) - invoiceBalanceDue(a));

  const raw: Omit<PriorityAlert, "rank">[] = [];

  if (crunch.firstCrunchDate) {
    const idx = baseline.findIndex((d) => d.balance < 0);
    const day = baseline[idx];
    // The largest outflow on the crunch day is the bill at risk.
    const bill = day.outflows.reduce<FlowItem | undefined>(
      (best, f) => (!best || f.amount > best.amount ? f : best),
      undefined,
    );
    const chase = overdue[0];
    const chaseText = chase
      ? ` Chase ${nameOf(chase.customerId)} (${formatINR(invoiceBalanceDue(chase))}, ${invoiceDaysOverdue(chase, today)}d late) today.`
      : "";
    raw.push({
      id: "crunch",
      severity: "critical",
      title: `Cash crunch on ${formatDateShort(crunch.firstCrunchDate)}`,
      detail: `${bill ? `${bill.label} (${formatINR(bill.amount)}) ` : ""}leaves a ${formatINR(crunch.shortfallAmount)} shortfall.${chaseText}`,
      amountAtStake: crunch.shortfallAmount,
      billId: bill && bill.kind === "BILL" ? bill.refId : undefined,
      invoiceId: chase?.id,
      customerId: chase?.customerId,
    });
  }

  for (const inv of overdue) {
    raw.push({
      id: `chase-${inv.id}`,
      severity: "warning",
      title: `Chase ${nameOf(inv.customerId)}`,
      detail: `${inv.invoiceNumber}: ${formatINR(invoiceBalanceDue(inv))} is ${invoiceDaysOverdue(inv, today)} days late.`,
      amountAtStake: invoiceBalanceDue(inv),
      invoiceId: inv.id,
      customerId: inv.customerId,
    });
  }

  const soon = expandBillOccurrences(bills, today, toISODate(addDays(today, 14)));
  for (const occ of soon) {
    if (!occ.isDeferrable) continue;
    raw.push({
      id: `defer-${occ.billId}-${occ.date}`,
      severity: "info",
      title: `Defer ${occ.title}?`,
      detail: `Due ${formatDateShort(occ.date)}. Deferrable by 7 days.`,
      amountAtStake: occ.amount,
      billId: occ.billId,
    });
  }

  return raw
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || b.amountAtStake - a.amountAtStake)
    .map((a, i) => ({ ...a, rank: i + 1 }));
}

// ---------- Payments ----------

/**
 * Applies a payment without mutating inputs. The amount is clamped to the balance.
 * Customer history updates only when the invoice becomes PAID in this call.
 */
export function applyPayment(
  invoice: Invoice,
  customer: Customer,
  amountINR: number,
  paidOn: string,
): ApplyPaymentResult {
  const balance = invoiceBalanceDue(invoice);
  const applied = Math.max(0, Math.min(amountINR, balance));
  const amountPaid = invoice.amountPaid + applied;
  const newBalance = Math.max(0, invoice.amount - amountPaid);
  const becamePaid = balance > 0 && newBalance === 0;

  const status: InvoiceStatus =
    newBalance === 0 ? "PAID" : amountPaid > 0 ? "PARTIAL" : invoice.status;

  let customerOut = {
    pastInvoiceCount: customer.pastInvoiceCount,
    pastLateCount: customer.pastLateCount,
    movingAvgDelayDays: customer.movingAvgDelayDays,
  };

  if (becamePaid) {
    const oldPaidCount = customer.pastInvoiceCount;
    const daysLate = Math.max(0, diffDays(invoice.dueDate, paidOn));
    customerOut = {
      pastInvoiceCount: oldPaidCount + 1,
      pastLateCount: customer.pastLateCount + (paidOn > invoice.dueDate ? 1 : 0),
      movingAvgDelayDays: round1(
        (customer.movingAvgDelayDays * oldPaidCount + daysLate) / (oldPaidCount + 1),
      ),
    };
  }

  return { applied, invoice: { amountPaid, status }, customer: customerOut };
}
