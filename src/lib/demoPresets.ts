// Synthetic demo data for CashPulse. Every name, phone and UPI handle is fictional.
// All dates are computed from the runtime "today" so overdue and upcoming items stay accurate.

import type {
  Customer,
  Invoice,
  InvoiceStatus,
  MessageChannel,
  OutboundMessage,
  PresetId,
  RelationshipTier,
  ReminderTone,
  UpcomingBill,
} from "../types/domain";
import { addDays, buildUpiLink, toISODate } from "./format";

export const DEFAULT_PRESET_ID: PresetId = "RENT_CRUNCH";

export const PRESET_LABELS: Record<PresetId, string> = {
  RENT_CRUNCH: "Rent Crunch",
  BAD_DAY_5_LATE: "Bad Day (5 Late Payers)",
  HEALTHY_CLINIC: "Healthy Month",
};

/** Demo-only login. Synthetic data. */
export const DEMO_ACCOUNT = {
  name: "Dr. Ananya",
  clinicName: "PhysioCare Studio",
  email: "ananya@physiocare.demo",
  password: "demo1234",
};

const UPI_ID = "physiocare@okaxis";

// ---------- Seed shapes (relative offsets, resolved against today) ----------

interface CustomerSeed {
  name: string;
  tier: RelationshipTier;
  pastInvoiceCount: number;
  pastLateCount: number;
  movingAvgDelayDays: number;
}

interface InvoiceSeed {
  customer: number; // index into the preset's customers
  amount: number;
  amountPaid: number;
  dueInDays: number; // negative means already past due
  service: string;
}

interface BillSeed {
  title: string;
  category: UpcomingBill["category"];
  amount: number;
  dueInDays: number;
  isRecurringMonthly: boolean;
  isDeferrable: boolean;
  isPaid?: boolean;
}

interface MessageSeed {
  invoice: number; // index into the preset's invoices
  channel: MessageChannel;
  tone: ReminderTone;
  sentDaysAgo: number;
  body: string;
}

interface PresetSpec {
  bankBalance: number;
  customers: CustomerSeed[];
  invoices: InvoiceSeed[];
  bills: BillSeed[];
  messages: MessageSeed[];
}

// ---------- Preset definitions ----------

const SPECS: Record<PresetId, PresetSpec> = {
  // Rent (35,000 in 6 days) lands after a salary and a utility bill, leaving an 11,500 shortfall.
  // Rajesh's 18,000 invoice is 14 days late and only lands a week out, so it does not cover the rent.
  RENT_CRUNCH: {
    bankBalance: 40000,
    customers: [
      { name: "Rajesh Verma", tier: "CHRONIC_LATE", pastInvoiceCount: 6, pastLateCount: 4, movingAvgDelayDays: 12 },
      { name: "Meera Iyer", tier: "VIP_LOYAL", pastInvoiceCount: 14, pastLateCount: 1, movingAvgDelayDays: 2 },
      { name: "Arjun Reddy", tier: "REGULAR", pastInvoiceCount: 5, pastLateCount: 1, movingAvgDelayDays: 4 },
      { name: "Kavya Nair", tier: "NEW", pastInvoiceCount: 1, pastLateCount: 0, movingAvgDelayDays: 0 },
      { name: "Suresh Babu", tier: "REGULAR", pastInvoiceCount: 9, pastLateCount: 2, movingAvgDelayDays: 5 },
    ],
    invoices: [
      { customer: 0, amount: 18000, amountPaid: 0, dueInDays: -14, service: "Post-op rehab package (12 sessions)" },
      { customer: 1, amount: 8500, amountPaid: 8500, dueInDays: -20, service: "Sports injury assessment" },
      { customer: 2, amount: 6000, amountPaid: 0, dueInDays: 12, service: "Lower back physiotherapy (4 sessions)" },
      { customer: 3, amount: 9000, amountPaid: 4000, dueInDays: -3, service: "Knee rehab (6 sessions)" },
      { customer: 4, amount: 7500, amountPaid: 7500, dueInDays: -5, service: "Shoulder mobility course" },
      { customer: 4, amount: 7500, amountPaid: 0, dueInDays: 25, service: "Shoulder mobility course, part 2" },
    ],
    bills: [
      { title: "Clinic rent (Hyderabad studio)", category: "RENT", amount: 35000, dueInDays: 6, isRecurringMonthly: true, isDeferrable: false },
      { title: "Physio assistant salary", category: "SALARY", amount: 12000, dueInDays: 2, isRecurringMonthly: true, isDeferrable: false },
      { title: "Electricity and internet", category: "UTILITY", amount: 4500, dueInDays: 4, isRecurringMonthly: true, isDeferrable: true },
      { title: "Ultrasound unit EMI", category: "EMI", amount: 6500, dueInDays: 10, isRecurringMonthly: true, isDeferrable: true },
    ],
    messages: [
      {
        invoice: 0,
        channel: "WHATSAPP",
        tone: "GENTLE",
        sentDaysAgo: 2,
        body: "Hi Rajesh, a gentle reminder that your physiotherapy invoice is pending. You can pay easily via UPI (physiocare@okaxis). Thank you, PhysioCare Studio.",
      },
      {
        invoice: 3,
        channel: "SMS",
        tone: "WARM",
        sentDaysAgo: 3,
        body: "Hi Kavya, thank you for your part payment. The balance is due at your next visit. Thank you, PhysioCare Studio.",
      },
      {
        invoice: 1,
        channel: "WHATSAPP",
        tone: "WARM",
        sentDaysAgo: 21,
        body: "Hi Meera, payment received in full. Thank you, and see you at your next session.",
      },
    ],
  },

  // Five customers are all past due, against a thin cash balance.
  BAD_DAY_5_LATE: {
    bankBalance: 22000,
    customers: [
      { name: "Rajesh Verma", tier: "CHRONIC_LATE", pastInvoiceCount: 6, pastLateCount: 4, movingAvgDelayDays: 12 },
      { name: "Kavya Nair", tier: "REGULAR", pastInvoiceCount: 8, pastLateCount: 3, movingAvgDelayDays: 9 },
      { name: "Vikram Shah", tier: "CHRONIC_LATE", pastInvoiceCount: 7, pastLateCount: 5, movingAvgDelayDays: 16 },
      { name: "Sneha Gupta", tier: "REGULAR", pastInvoiceCount: 5, pastLateCount: 2, movingAvgDelayDays: 7 },
      { name: "Deepak Rao", tier: "NEW", pastInvoiceCount: 1, pastLateCount: 1, movingAvgDelayDays: 0 },
    ],
    invoices: [
      { customer: 0, amount: 18000, amountPaid: 0, dueInDays: -14, service: "Post-op rehab package (12 sessions)" },
      { customer: 1, amount: 9000, amountPaid: 0, dueInDays: -9, service: "Knee rehab (6 sessions)" },
      { customer: 2, amount: 7200, amountPaid: 0, dueInDays: -21, service: "Frozen shoulder course" },
      { customer: 3, amount: 5400, amountPaid: 0, dueInDays: -6, service: "Sciatica sessions (4)" },
      { customer: 4, amount: 12500, amountPaid: 0, dueInDays: -17, service: "Post-surgery knee rehab" },
    ],
    bills: [
      { title: "Clinic rent (Hyderabad studio)", category: "RENT", amount: 35000, dueInDays: 6, isRecurringMonthly: true, isDeferrable: false },
      { title: "Physio assistant salary", category: "SALARY", amount: 12000, dueInDays: 3, isRecurringMonthly: true, isDeferrable: false },
      { title: "Electricity and internet", category: "UTILITY", amount: 4000, dueInDays: 5, isRecurringMonthly: true, isDeferrable: true },
      { title: "Ultrasound unit EMI", category: "EMI", amount: 6500, dueInDays: 10, isRecurringMonthly: true, isDeferrable: true },
    ],
    messages: [
      {
        invoice: 2,
        channel: "WHATSAPP",
        tone: "FIRM",
        sentDaysAgo: 1,
        body: "Hi Vikram, your balance is now more than three weeks overdue. Please pay via UPI (physiocare@okaxis) or call the clinic today. Thank you, PhysioCare Studio.",
      },
      {
        invoice: 3,
        channel: "SMS",
        tone: "GENTLE",
        sentDaysAgo: 2,
        body: "Hi Sneha, a friendly reminder that your session invoice is due. Pay via UPI (physiocare@okaxis). Thank you, PhysioCare Studio.",
      },
    ],
  },

  // Healthy cash, most invoices already paid or not yet due.
  HEALTHY_CLINIC: {
    bankBalance: 185000,
    customers: [
      { name: "Meera Iyer", tier: "VIP_LOYAL", pastInvoiceCount: 22, pastLateCount: 1, movingAvgDelayDays: 1 },
      { name: "Arjun Reddy", tier: "REGULAR", pastInvoiceCount: 9, pastLateCount: 1, movingAvgDelayDays: 3 },
      { name: "Suresh Babu", tier: "VIP_LOYAL", pastInvoiceCount: 15, pastLateCount: 0, movingAvgDelayDays: 2 },
      { name: "Anita Joseph", tier: "REGULAR", pastInvoiceCount: 6, pastLateCount: 0, movingAvgDelayDays: 1 },
    ],
    invoices: [
      { customer: 0, amount: 8500, amountPaid: 8500, dueInDays: -20, service: "Sports injury assessment" },
      { customer: 1, amount: 6000, amountPaid: 6000, dueInDays: -7, service: "Lower back physiotherapy (4 sessions)" },
      { customer: 2, amount: 7500, amountPaid: 7500, dueInDays: -2, service: "Shoulder mobility course" },
      { customer: 3, amount: 11000, amountPaid: 0, dueInDays: 5, service: "Post-natal pelvic floor course" },
      { customer: 1, amount: 6000, amountPaid: 0, dueInDays: 15, service: "Lower back physiotherapy, session 2" },
      { customer: 0, amount: 8500, amountPaid: 2000, dueInDays: 3, service: "Sports injury follow-up" },
      { customer: 2, amount: 7500, amountPaid: 0, dueInDays: 22, service: "Shoulder mobility course, part 2" },
    ],
    bills: [
      { title: "Clinic rent (Hyderabad studio)", category: "RENT", amount: 35000, dueInDays: 20, isRecurringMonthly: true, isDeferrable: false },
      { title: "Staff salaries", category: "SALARY", amount: 42000, dueInDays: 12, isRecurringMonthly: true, isDeferrable: false },
      { title: "Electricity and internet", category: "UTILITY", amount: 6000, dueInDays: 9, isRecurringMonthly: true, isDeferrable: true },
      { title: "Ultrasound unit EMI", category: "EMI", amount: 6500, dueInDays: 15, isRecurringMonthly: true, isDeferrable: true },
      { title: "Treatment supplies", category: "SUPPLIER", amount: 8000, dueInDays: 25, isRecurringMonthly: false, isDeferrable: true },
    ],
    messages: [
      {
        invoice: 5,
        channel: "WHATSAPP",
        tone: "WARM",
        sentDaysAgo: 2,
        body: "Hi Meera, a friendly note that the balance on your follow-up session is due shortly. Pay via UPI (physiocare@okaxis). Thank you, PhysioCare Studio.",
      },
      {
        invoice: 2,
        channel: "WHATSAPP",
        tone: "WARM",
        sentDaysAgo: 6,
        body: "Hi Suresh, payment received in full. Thank you, and see you at your next session.",
      },
    ],
  },
};

// ---------- Builder ----------

export interface PresetData {
  bankBalance: number;
  customers: Customer[];
  invoices: Invoice[];
  bills: UpcomingBill[];
  messages: OutboundMessage[];
}

/** Status is derived from the numbers: PAID, then PARTIAL, then OVERDUE, else SENT. */
function statusFor(amount: number, amountPaid: number, dueDate: string, todayISO: string): InvoiceStatus {
  if (amountPaid >= amount) return "PAID";
  if (amountPaid > 0) return "PARTIAL";
  if (dueDate < todayISO) return "OVERDUE";
  return "SENT";
}

/** Phone numbers use the fictional +91-98765-000NN range. */
function phoneFor(n: number): string {
  return `+91-98765-000${String(n).padStart(2, "0")}`;
}

/** Builds the full demo dataset for a preset, with dates relative to `today`. */
export function buildPreset(id: PresetId, today: Date): PresetData {
  const spec = SPECS[id];
  const todayISO = toISODate(today);
  const dayOf = (offset: number) => toISODate(addDays(today, offset));
  const year = today.getFullYear();

  const customers: Customer[] = spec.customers.map((c, i) => ({
    id: `cust-${i + 1}`,
    name: c.name,
    phone: phoneFor(i + 1),
    relationshipTier: c.tier,
    pastInvoiceCount: c.pastInvoiceCount,
    pastLateCount: c.pastLateCount,
    movingAvgDelayDays: c.movingAvgDelayDays,
    createdAt: dayOf(-120),
  }));

  const invoices: Invoice[] = spec.invoices.map((s, j) => {
    const dueDate = dayOf(s.dueInDays);
    const invoiceNumber = `INV-${year}-${101 + j}`;
    return {
      id: `inv-${j + 1}`,
      invoiceNumber,
      customerId: customers[s.customer].id,
      serviceDescription: s.service,
      amount: s.amount,
      amountPaid: s.amountPaid,
      issueDate: dayOf(s.dueInDays - 14),
      dueDate,
      status: statusFor(s.amount, s.amountPaid, dueDate, todayISO),
      upiLink: buildUpiLink(UPI_ID, s.amount, invoiceNumber),
      createdBy: "USER",
    };
  });

  const bills: UpcomingBill[] = spec.bills.map((b, k) => ({
    id: `bill-${k + 1}`,
    title: b.title,
    category: b.category,
    amount: b.amount,
    dueDate: dayOf(b.dueInDays),
    isRecurringMonthly: b.isRecurringMonthly,
    isDeferrable: b.isDeferrable,
    deferredDays: 0,
    isPaid: b.isPaid ?? false,
  }));

  const messages: OutboundMessage[] = spec.messages.map((m, k) => {
    const invoice = invoices[m.invoice];
    const customer = customers[spec.invoices[m.invoice].customer];
    return {
      id: `msg-${k + 1}`,
      invoiceId: invoice.id,
      customerId: customer.id,
      customerName: customer.name,
      channel: m.channel,
      tone: m.tone,
      includedPartialOption: false,
      body: m.body,
      status: "DELIVERED",
      sentAt: dayOf(-m.sentDaysAgo),
      triggeredBy: "USER",
    };
  });

  return { bankBalance: spec.bankBalance, customers, invoices, bills, messages };
}
