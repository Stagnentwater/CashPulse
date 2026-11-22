"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import QRCode from "qrcode";
import { Copy, Plus, Receipt, Send, Wallet } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import type { Customer, Invoice } from "../../../types/domain";
import { addDays, diffDays, formatDateShort, formatINR, toISODate } from "../../../lib/format";
import { ApiError, apiFetch, authApi } from "../../../lib/api";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";

// Invoice rows as GET /api/invoices returns them: domain fields plus server-computed balance and daysOverdue.
type InvoiceRow = Omit<Invoice, "createdBy"> & {
  balance: number;
  daysOverdue: number;
  customerName: string;
};

// 401 sends the user to sign in. Any other error is toasted and its message returned for inline display.
function useReportError() {
  const router = useRouter();
  return useCallback(
    (err: unknown): string => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return "Your session has ended. Sign in again.";
      }
      const message = err instanceof Error ? err.message : "Something went wrong.";
      toast.error(message);
      return message;
    },
    [router],
  );
}

type FilterKey = "ALL" | "OVERDUE" | "PARTIAL" | "DUE_SOON" | "PAID";

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "ALL", label: "All" },
  { key: "OVERDUE", label: "Overdue" },
  { key: "PARTIAL", label: "Partial" },
  { key: "DUE_SOON", label: "Due Soon" },
  { key: "PAID", label: "Paid" },
];

const FILTER_TESTS: Record<FilterKey, (inv: InvoiceRow, today: string) => boolean> = {
  ALL: () => true,
  OVERDUE: (inv) => inv.daysOverdue > 0,
  PARTIAL: (inv) => inv.balance > 0 && inv.amountPaid > 0,
  DUE_SOON: (inv, today) =>
    inv.balance > 0 && inv.daysOverdue === 0 && diffDays(today, inv.dueDate) <= 7,
  PAID: (inv) => inv.balance === 0,
};

const INPUT =
  "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-body placeholder:text-[var(--input-placeholder)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans";

function todayISO(): string {
  return toISODate(new Date());
}

function buildReminderText(
  invoice: InvoiceRow,
  customerName: string,
  clinicName: string,
): string {
  const balance = formatINR(invoice.balance);
  const due = formatDateShort(invoice.dueDate);
  return (
    `Hi ${customerName}, this is a friendly reminder from ${clinicName} that invoice ${invoice.invoiceNumber} ` +
    `for ${balance} (${invoice.serviceDescription}) was due on ${due}. ` +
    `You can pay directly by UPI here: ${invoice.upiLink}. Thank you!`
  );
}

// ---------- Record Payment ----------

function RecordPaymentForm({
  invoice,
  customerName,
  onDone,
}: {
  invoice: InvoiceRow;
  customerName: string;
  onDone: () => void;
}) {
  const reportError = useReportError();
  const balance = invoice.balance;
  const [amount, setAmount] = useState(String(balance));
  const [paidOn, setPaidOn] = useState(todayISO());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const n = Number(amount);
    if (!amount.trim() || !Number.isFinite(n) || n <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (n > balance) {
      setError(`Amount cannot exceed the balance due of ${formatINR(balance)}.`);
      return;
    }
    if (!paidOn) {
      setError("Choose a payment date.");
      return;
    }
    setSaving(true);
    try {
      await apiFetch<InvoiceRow>(`/api/invoices/${invoice.id}/payments`, {
        method: "POST",
        body: JSON.stringify({ amount: n, paidOn }),
      });
    } catch (err) {
      setError(reportError(err));
      setSaving(false);
      return;
    }
    toast.success(`${formatINR(n)} recorded from ${customerName} and added to your bank account!`);
    window.dispatchEvent(new Event("cashpulse:refresh"));
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <p className="text-sm text-body">
        {invoice.invoiceNumber} · {customerName} · balance due{" "}
        <span className="font-mono font-semibold tabular-nums text-heading">{formatINR(balance)}</span>
      </p>

      <div>
        <label htmlFor="pay-amount" className="text-sm font-medium text-heading">
          Amount received (₹) <span className="text-coral">*</span>
        </label>
        <input
          id="pay-amount"
          type="number"
          min={1}
          step="0.01"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setError(null);
          }}
          className={INPUT}
          aria-invalid={!!error}
        />
      </div>

      <div>
        <label htmlFor="pay-date" className="text-sm font-medium text-heading">
          Payment date <span className="text-coral">*</span>
        </label>
        <input
          id="pay-date"
          type="date"
          value={paidOn}
          onChange={(e) => {
            setPaidOn(e.target.value);
            setError(null);
          }}
          className={INPUT}
        />
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-coral-tint px-3 py-2 text-sm text-coral">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
        >
          <Wallet className="h-4 w-4" />
          {saving ? "Recording…" : "Record payment"}
        </button>
      </div>
    </form>
  );
}

// ---------- New Invoice ----------

interface NewInvoiceState {
  customerId: string;
  amount: string;
  dueDate: string;
  description: string;
}

type NewInvoiceErrors = Partial<Record<keyof NewInvoiceState, string>>;

function NewInvoiceForm({ customers, onDone }: { customers: Customer[]; onDone: () => void }) {
  const reportError = useReportError();
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState<NewInvoiceState>({
    customerId: "",
    amount: "",
    dueDate: toISODate(addDays(todayISO(), 7)),
    description: "",
  });
  const [errors, setErrors] = useState<NewInvoiceErrors>({});

  function setField<K extends keyof NewInvoiceState>(key: K, value: NewInvoiceState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const next: NewInvoiceErrors = {};
    const amountNum = Number(form.amount);
    if (!form.customerId) next.customerId = "Choose a customer.";
    if (!form.amount.trim() || !Number.isFinite(amountNum) || amountNum <= 0) {
      next.amount = "Enter an amount greater than zero.";
    }
    if (!form.dueDate) next.dueDate = "Choose a due date.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const customer = customers.find((c) => c.id === form.customerId);
    setFormError(null);
    try {
      await apiFetch<InvoiceRow>("/api/invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.customerId,
          amount: amountNum,
          dueDate: form.dueDate,
          serviceDescription: form.description.trim(),
        }),
      });
    } catch (err) {
      setFormError(reportError(err));
      return;
    }
    toast.success(`Invoice for ${formatINR(amountNum)} created for ${customer?.name ?? "customer"}`);
    onDone();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-4">
      <div>
        <label htmlFor="inv-customer" className="text-sm font-medium text-heading">
          Customer <span className="text-coral">*</span>
        </label>
        <select
          id="inv-customer"
          value={form.customerId}
          onChange={(e) => setField("customerId", e.target.value)}
          className={INPUT}
          aria-invalid={!!errors.customerId}
        >
          <option value="">{customers.length === 0 ? "No customers yet, add one first" : "Select a customer"}</option>
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {errors.customerId && <p className="mt-1 text-xs text-coral">{errors.customerId}</p>}
      </div>

      <div>
        <label htmlFor="inv-amount" className="text-sm font-medium text-heading">
          Amount (₹) <span className="text-coral">*</span>
        </label>
        <input
          id="inv-amount"
          type="number"
          min={1}
          step="0.01"
          value={form.amount}
          onChange={(e) => setField("amount", e.target.value)}
          className={INPUT}
          aria-invalid={!!errors.amount}
        />
        {errors.amount && <p className="mt-1 text-xs text-coral">{errors.amount}</p>}
      </div>

      <div>
        <label htmlFor="inv-due" className="text-sm font-medium text-heading">
          Due date <span className="text-coral">*</span>
        </label>
        <input
          id="inv-due"
          type="date"
          value={form.dueDate}
          onChange={(e) => setField("dueDate", e.target.value)}
          className={INPUT}
          aria-invalid={!!errors.dueDate}
        />
        {errors.dueDate && <p className="mt-1 text-xs text-coral">{errors.dueDate}</p>}
      </div>

      <div>
        <label htmlFor="inv-desc" className="text-sm font-medium text-heading">
          Description <span className="text-xs font-normal text-muted">(optional)</span>
        </label>
        <input
          id="inv-desc"
          type="text"
          value={form.description}
          onChange={(e) => setField("description", e.target.value)}
          placeholder="Physiotherapy session"
          className={INPUT}
        />
      </div>

      {formError && (
        <p role="alert" className="rounded-lg bg-coral-tint px-3 py-2 text-sm text-coral">
          {formError}
        </p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <button
          type="submit"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create invoice
        </button>
      </div>
    </form>
  );
}

// ---------- Chase (copy-only reminder text) ----------

function ChasePanel({
  invoice,
  customerName,
  clinicName,
}: {
  invoice: InvoiceRow;
  customerName: string;
  clinicName: string;
}) {
  const text = buildReminderText(invoice, customerName, clinicName);

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Reminder copied");
    } catch {
      toast.error("Could not copy. Select the text and copy it manually.");
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-body">
        Copy this reminder and send it from your own WhatsApp or SMS. CashPulse does not send it for you yet.
      </p>
      <textarea readOnly rows={7} value={text} className={INPUT} aria-label="Reminder message" />
      <div className="flex justify-end">
        <button
          type="button"
          onClick={copyText}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-colors"
        >
          <Copy className="h-4 w-4" />
          Copy message
        </button>
      </div>
    </div>
  );
}

// ---------- Receipt QR Modal ----------

function ReceiptPanel({
  invoice,
  customerName,
}: {
  invoice: InvoiceRow;
  customerName: string;
}) {
  const qrCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (qrCanvasRef.current && invoice.upiLink) {
      QRCode.toCanvas(qrCanvasRef.current, invoice.upiLink, { width: 192, margin: 1 }, (err) => {
        if (err) console.error("QR Code generation error:", err);
      });
    }
  }, [invoice.upiLink]);

  const rows = [
    { label: "Invoice no.", value: invoice.invoiceNumber },
    { label: "Client", value: customerName },
    { label: "Service", value: invoice.serviceDescription },
    { label: "Issued", value: formatDateShort(invoice.issueDate) },
    { label: "Due", value: formatDateShort(invoice.dueDate) },
    { label: "Total", value: formatINR(invoice.amount) },
    { label: "Paid", value: formatINR(invoice.amountPaid) },
    { label: "Balance due", value: formatINR(invoice.balance) },
  ];

  return (
    <div className="space-y-4">
      <dl className="divide-y divide-border rounded-xl border border-border text-sm">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 px-4 py-2.5">
            <dt className="text-muted">{r.label}</dt>
            <dd className="text-right font-mono font-medium tabular-nums text-heading">{r.value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-muted">Pay via UPI</p>
        <canvas
          ref={qrCanvasRef}
          role="img"
          aria-label="UPI payment QR"
          width={200}
          height={200}
          className="mx-auto mt-2 h-48 w-48 rounded-xl bg-white p-2 shadow-xs"
        />
        <p className="mt-2 break-all rounded-lg bg-card-elevated border border-border p-3 font-mono text-xs text-body">
          {invoice.upiLink}
        </p>
      </div>
    </div>
  );
}

// ---------- Page ----------

export default function InvoicesPage() {
  const reportError = useReportError();
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [clinicName, setClinicName] = useState("PhysioCare Studio");
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [filter, setFilter] = useState<FilterKey>("ALL");
  const [newOpen, setNewOpen] = useState(false);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [chaseId, setChaseId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);

  // silent = background refresh: no loading state and no error toast (401 still redirects).
  const loadAll = useCallback(
    async (silent = false) => {
      try {
        const [invoiceRows, customerRows, me] = await Promise.all([
          apiFetch<InvoiceRow[]>("/api/invoices"),
          apiFetch<Customer[]>("/api/customers"),
          authApi.me(),
        ]);
        setInvoices(invoiceRows);
        setCustomers(customerRows);
        setClinicName(me.user.clinicName);
        setPageError(null);
      } catch (err) {
        if (silent && !(err instanceof ApiError && err.status === 401)) return;
        setPageError(reportError(err));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [reportError],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [invoiceRows, customerRows, me] = await Promise.all([
          apiFetch<InvoiceRow[]>("/api/invoices"),
          apiFetch<Customer[]>("/api/customers"),
          authApi.me(),
        ]);
        setInvoices(invoiceRows);
        setCustomers(customerRows);
        setClinicName(me.user.clinicName);
        setPageError(null);
      } catch (err) {
        setPageError(reportError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [reportError]);

  useAutoRefresh(() => loadAll(true), 4000);

  if (loading) {
    return (
      <section className="space-y-6">
        <header>
          <h1 className="font-heading text-2xl font-bold text-heading">Who Owes Me</h1>
        </header>
        <div className="h-64 rounded-2xl border border-border bg-card shadow-xs" />
      </section>
    );
  }

  const today = todayISO();
  const nameOf = (inv: InvoiceRow) => inv.customerName || "Unknown client";

  const rows = invoices
    .filter((inv) => FILTER_TESTS[filter](inv, today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const countFor = (key: FilterKey) => invoices.filter((inv) => FILTER_TESTS[key](inv, today)).length;

  const paymentInvoice = paymentId ? invoices.find((i) => i.id === paymentId) : undefined;
  const chaseInvoice = chaseId ? invoices.find((i) => i.id === chaseId) : undefined;
  const receiptInvoice = receiptId ? invoices.find((i) => i.id === receiptId) : undefined;

  async function handleChase(inv: InvoiceRow) {
    try {
      await apiFetch<InvoiceRow>(`/api/invoices/${inv.id}/reminded`, { method: "POST" });
    } catch (err) {
      setPageError(reportError(err));
      return;
    }
    toast.success(`${nameOf(inv)} marked as reminded`);
    setChaseId(inv.id);
    await loadAll();
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-heading">Who Owes Me</h1>
          <p className="mt-1 font-sans text-sm text-muted">Open invoices, what is still due, and how late it is.</p>
        </div>
        <button
          type="button"
          onClick={() => setNewOpen(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Invoice
        </button>
      </header>

      {pageError && (
        <p role="alert" className="rounded-xl bg-coral-tint px-3.5 py-2.5 text-sm text-coral">
          {pageError}
        </p>
      )}

      {invoices.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-12 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <Receipt className="h-8 w-8" />
          </div>
          <h2 className="mt-4 font-heading text-lg font-bold tracking-tight text-heading">No Open Invoices Yet</h2>
          <p className="mx-auto mt-2 max-w-md font-sans text-sm text-muted leading-relaxed">
            All patient and client accounts are clear, or no invoices have been created yet. Issue an invoice to start tracking payments, generating instant UPI QR codes, or stress-testing your cash flow.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setNewOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-all active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Create New Invoice
            </button>
          </div>
          <div className="mt-8 rounded-xl border border-border/60 bg-card-elevated p-4 max-w-lg mx-auto text-left">
            <p className="font-heading text-[11px] font-bold uppercase tracking-wider text-primary">Pulse AI Voice & Chat Shortcuts</p>
            <p className="mt-1 font-sans text-xs text-muted">
              You can also click the bottom-right copilot or use your mic to say:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-body font-medium">
                &ldquo;Bill Kavita ₹9,000 for physiotherapy&rdquo;
              </span>
              <span className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-body font-medium">
                &ldquo;Put 5000 on Ayaan&apos;s tab&rdquo;
              </span>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div role="tablist" aria-label="Filter invoices" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => {
              const active = filter === f.key;
              return (
                <button
                  key={f.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setFilter(f.key)}
                  className={`rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-primary text-[var(--btn-primary-text)] shadow-xs"
                      : "border border-border bg-card text-muted hover:bg-card-elevated hover:text-heading"
                  }`}
                >
                  {f.label} <span className="tabular-nums font-mono opacity-75">({countFor(f.key)})</span>
                </button>
              );
            })}
          </div>

          <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
            <table className="min-w-full divide-y divide-border text-sm">
              <thead className="bg-card-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-muted font-sans">
                <tr>
                  <th className="px-5 py-3.5">Client</th>
                  <th className="px-5 py-3.5">Invoice No.</th>
                  <th className="px-5 py-3.5 text-right">Amount Due</th>
                  <th className="px-5 py-3.5 text-right">Days Overdue</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted">
                      No invoices match this filter.
                    </td>
                  </tr>
                ) : (
                  rows.map((inv) => {
                    const balance = inv.balance;
                    const days = inv.daysOverdue;
                    const settled = balance === 0;
                    const clientName = nameOf(inv);
                    const initial = clientName.trim().charAt(0).toUpperCase() || "C";
                    return (
                      <tr key={inv.id} className="hover:bg-card-elevated transition-colors">
                        <td className="px-5 py-3.5 font-medium text-heading">
                          <div className="flex items-center gap-2.5">
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary font-heading">
                              {initial}
                            </span>
                            <span className="font-heading font-semibold text-heading">{clientName}</span>
                          </div>
                        </td>
                        <td className="px-5 py-3.5 tabular-nums text-muted font-mono text-xs">{inv.invoiceNumber}</td>
                        <td className="px-5 py-3.5 text-right tabular-nums text-heading font-mono font-semibold">
                          {formatINR(balance)}
                          {settled && <p className="text-[11px] font-medium text-emerald">Paid in full</p>}
                        </td>
                        <td className="px-5 py-3.5 text-right tabular-nums">
                          {days > 0 ? (
                            <span className="inline-flex items-center rounded-full bg-coral-tint px-2.5 py-0.5 text-xs font-mono font-bold text-coral ring-1 ring-coral/20">
                              {days}d late
                            </span>
                          ) : (
                            <span className="text-muted text-xs">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleChase(inv)}
                              disabled={settled}
                              className="inline-flex items-center gap-1 rounded-lg border border-coral/30 bg-coral-tint px-2.5 py-1.5 text-xs font-semibold text-coral hover:bg-coral/20 disabled:opacity-40 transition-colors"
                            >
                              <Send className="h-3.5 w-3.5" />
                              Chase
                            </button>
                            <button
                              type="button"
                              onClick={() => setPaymentId(inv.id)}
                              disabled={settled}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald/30 bg-emerald-tint px-2.5 py-1.5 text-xs font-semibold text-emerald hover:bg-emerald/20 disabled:opacity-40 transition-colors"
                            >
                              <Wallet className="h-3.5 w-3.5" />
                              Record Payment
                            </button>
                            <button
                              type="button"
                              onClick={() => setReceiptId(inv.id)}
                              className="inline-flex items-center gap-1 rounded-lg border border-border bg-card-elevated px-2.5 py-1.5 text-xs font-semibold text-body hover:bg-card transition-colors"
                            >
                              <Receipt className="h-3.5 w-3.5" />
                              Receipt QR
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New Invoice">
        {newOpen ? (
          <NewInvoiceForm
            customers={customers}
            onDone={() => {
              setNewOpen(false);
              void loadAll();
            }}
          />
        ) : null}
      </Modal>

      <Modal open={paymentId !== null} onClose={() => setPaymentId(null)} title="Record Payment">
        {paymentInvoice ? (
          <RecordPaymentForm
            key={paymentInvoice.id}
            invoice={paymentInvoice}
            customerName={nameOf(paymentInvoice)}
            onDone={() => {
              setPaymentId(null);
              void loadAll();
            }}
          />
        ) : null}
      </Modal>

      <Modal open={chaseInvoice !== undefined} onClose={() => setChaseId(null)} title="Payment Reminder">
        {chaseInvoice ? (
          <ChasePanel invoice={chaseInvoice} customerName={nameOf(chaseInvoice)} clinicName={clinicName} />
        ) : null}
      </Modal>

      <Modal open={receiptInvoice !== undefined} onClose={() => setReceiptId(null)} title="Invoice Receipt">
        {receiptInvoice ? (
          <ReceiptPanel invoice={receiptInvoice} customerName={nameOf(receiptInvoice)} />
        ) : null}
      </Modal>
    </section>
  );
}
