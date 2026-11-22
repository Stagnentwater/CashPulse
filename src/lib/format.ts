const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function formatINR(amount: number): string {
  return currencyFormatter.format(amount);
}

/** Local calendar date as YYYY-MM-DD (no UTC shift). */
export function toISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Parses YYYY-MM-DD into a Date at local midnight. */
export function parseISODate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Adds whole days in local time. Accepts a Date or a YYYY-MM-DD string. */
export function addDays(date: Date | string, n: number): Date {
  const base = typeof date === "string" ? parseISODate(date) : new Date(date);
  base.setDate(base.getDate() + n);
  return base;
}

/** Whole days from `fromISO` to `toISO` (to minus from). */
export function diffDays(fromISO: string, toISO: string): number {
  const from = parseISODate(fromISO);
  const to = parseISODate(toISO);
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((toUtc - fromUtc) / MS_PER_DAY);
}

/** Formats YYYY-MM-DD as e.g. "6 Jun". */
export function formatDateShort(iso: string): string {
  const d = parseISODate(iso);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export function buildUpiLink(upiId: string, amount: number, note: string): string {
  return `upi://pay?pa=${upiId}&pn=PhysioCare%20Studio&am=${amount}&cu=INR&tn=${encodeURIComponent(note)}`;
}
