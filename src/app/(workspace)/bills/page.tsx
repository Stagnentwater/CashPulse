"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, CheckCircle, Pencil, Plus, Receipt, Wallet } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { ApiError, apiFetch, authApi } from "../../../lib/api";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";
import { addDays, formatDateShort, formatINR, toISODate } from "../../../lib/format";
import type { UpcomingBill } from "../../../types/domain";

type Category = UpcomingBill["category"];

/** Body for POST and PATCH /api/bills (camelCase, as the API expects). */
interface BillPayload {
  title: string;
  category: Category;
  amount: number;
  dueDate: string;
  isRecurringMonthly: boolean;
  isDeferrable: boolean;
}

/** 401 sends the user to sign in; any other error is shown as a toast. */
function reportApiError(err: unknown, onUnauthorized: () => void): void {
  if (err instanceof ApiError && err.status === 401) {
    onUnauthorized();
    return;
  }
  toast.error(err instanceof Error ? err.message : "Something went wrong.");
}

const CATEGORY_ORDER: Category[] = ["RENT", "SALARY", "UTILITY", "SUPPLIER", "EMI", "SHOCK"];

const CATEGORY_LABELS: Record<Category, string> = {
  RENT: "Rent",
  SALARY: "Salary",
  UTILITY: "Utility",
  SUPPLIER: "Supplier",
  EMI: "EMI",
  SHOCK: "Unexpected",
};

const INPUT_CLASS =
  "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-body placeholder:text-[var(--input-placeholder)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans";

interface BillForm {
  title: string;
  category: Category;
  amount: string;
  dueDate: string;
  isRecurringMonthly: boolean;
  isDeferrable: boolean;
}

type FormErrors = Partial<Record<"title" | "amount" | "dueDate", string>>;

const EMPTY_FORM: BillForm = {
  title: "",
  category: "UTILITY",
  amount: "",
  dueDate: "",
  isRecurringMonthly: false,
  isDeferrable: false,
};

/** Due date after any deferrals, as YYYY-MM-DD. The server already applies deferrals to dueDate. */
function effectiveDueISO(bill: UpcomingBill): string {
  return bill.dueDate;
}

function validate(form: BillForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.title.trim()) errors.title = "Title is required.";
  if (!form.amount.trim()) {
    errors.amount = "Amount is required.";
  } else {
    const n = Number(form.amount);
    if (!Number.isFinite(n) || n <= 0) errors.amount = "Amount must be greater than zero.";
  }
  if (!form.dueDate) errors.dueDate = "Due date is required.";
  return errors;
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3.5 py-2.5">
      <span className="text-sm font-medium text-heading font-sans">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
          checked ? "bg-primary" : "bg-card-elevated border border-border"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full shadow-sm transition-transform ${
            checked
              ? "translate-x-5 bg-[var(--btn-primary-text)]"
              : "translate-x-0.5 bg-muted/70"
          }`}
        />
      </button>
    </div>
  );
}

const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

export default function BillsPage() {
  const router = useRouter();
  const mounted = useSyncExternalStore(subscribeNoop, getMountedClient, getMountedServer);
  const [allBills, setAllBills] = useState<UpcomingBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [bankBalance, setBankBalance] = useState<number | null>(null);
  const [settleBill, setSettleBill] = useState<UpcomingBill | null>(null);
  const [settling, setSettling] = useState(false);

  const todayISO = mounted ? new Date().toISOString().slice(0, 10) : "";

  // Unpaid first, then by effective due date (after deferrals).
  const bills = useMemo(
    () =>
      [...allBills].sort((a, b) => {
        if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
        return effectiveDueISO(a).localeCompare(effectiveDueISO(b));
      }),
    [allBills],
  );

  const dueBills = useMemo(
    () => (todayISO ? bills.filter((b) => !b.isPaid && effectiveDueISO(b) <= todayISO) : []),
    [bills, todayISO],
  );

  const loadBankBalance = useCallback(async () => {
    try {
      const me = await authApi.me();
      if (me?.user?.bankBalance !== undefined) {
        setBankBalance(me.user.bankBalance);
      }
    } catch {}
  }, []);

  // silent = background refresh: no loading state and no error toast (401 still redirects).
  const loadBills = useCallback(
    async (silent = false) => {
      try {
        setAllBills(await apiFetch<UpcomingBill[]>("/api/bills"));
      } catch (err) {
        if (silent && !(err instanceof ApiError && err.status === 401)) return;
        reportApiError(err, () => router.replace("/login"));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void (async () => {
      try {
        setAllBills(await apiFetch<UpcomingBill[]>("/api/bills"));
        await loadBankBalance();
      } catch (err) {
        reportApiError(err, () => router.replace("/login"));
      } finally {
        setLoading(false);
      }
    })();

    const handleRefresh = () => {
      void loadBills(true);
      void loadBankBalance();
    };
    window.addEventListener("cashpulse:refresh", handleRefresh);
    return () => window.removeEventListener("cashpulse:refresh", handleRefresh);
  }, [router, loadBankBalance, loadBills]);

  useAutoRefresh(() => {
    void loadBills(true);
    void loadBankBalance();
  }, 4000);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<BillForm>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});

  const closeModal = useCallback(() => setModalOpen(false), []);

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setModalOpen(true);
  };

  const openEdit = (bill: UpcomingBill) => {
    setEditingId(bill.id);
    setForm({
      title: bill.title,
      category: bill.category,
      amount: String(bill.amount),
      // The list shows the effective date; edit the base date so deferrals are not counted twice.
      dueDate: toISODate(addDays(bill.dueDate, -bill.deferredDays)),
      isRecurringMonthly: bill.isRecurringMonthly,
      isDeferrable: bill.isDeferrable,
    });
    setErrors({});
    setModalOpen(true);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    const payload: BillPayload = {
      title: form.title.trim(),
      category: form.category,
      amount: Number(form.amount),
      dueDate: form.dueDate,
      isRecurringMonthly: form.isRecurringMonthly,
      isDeferrable: form.isDeferrable,
    };

    try {
      if (editingId) {
        await apiFetch<UpcomingBill>(`/api/bills/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast.success(`"${payload.title}" updated`);
      } else {
        await apiFetch<UpcomingBill>("/api/bills", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success(`"${payload.title}" added`);
      }
    } catch (err) {
      reportApiError(err, () => router.replace("/login"));
      return;
    }
    setModalOpen(false);
    await loadBills();
  };

  const handleConfirmSettle = async () => {
    if (!settleBill) return;
    setSettling(true);
    try {
      const res = await apiFetch<{
        deleted?: boolean;
        amountDeducted?: number;
        message?: string;
        isRecurringMonthly?: boolean;
      }>(`/api/bills/${settleBill.id}/paid?deduct_from_bank=true`, { method: "POST" });

      toast.success(
        res.message ||
          (settleBill.isRecurringMonthly
            ? `"${settleBill.title}" settled. ₹${formatINR(settleBill.amount)} deducted from bank. Next reminder scheduled in 1 month.`
            : `"${settleBill.title}" settled. ₹${formatINR(settleBill.amount)} deducted from bank and bill deleted.`),
      );
      window.dispatchEvent(new Event("cashpulse:refresh"));
      setSettleBill(null);
      await loadBills();
      await loadBankBalance();
    } catch (err) {
      reportApiError(err, () => router.replace("/login"));
    } finally {
      setSettling(false);
    }
  };

  const handleDefer = async (bill: UpcomingBill) => {
    try {
      await apiFetch<UpcomingBill>(`/api/bills/${bill.id}/defer`, {
        method: "POST",
        body: JSON.stringify({ days: 7 }),
      });
    } catch (err) {
      // A 422 here means the bill is not deferrable; its server message is shown as the toast.
      reportApiError(err, () => router.replace("/login"));
      return;
    }
    toast.success(`"${bill.title}" deferred by 7 days`);
    await loadBills();
  };

  const setField = <K extends keyof BillForm>(key: K, value: BillForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary font-heading">
            <span>Commitments & Payables</span>
          </div>
          <h1 className="font-heading text-2xl sm:text-3xl font-bold tracking-tight text-heading">Bills & Fixed Expenses</h1>
          <p className="mt-1 font-sans text-sm text-muted">
            Track clinic rent, salaries, utilities, and EMIs to safeguard your 90-day cash flow.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-all active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Add Bill
        </button>
      </div>

      {/* Billing Date Reached Alert Banner */}
      {!loading && dueBills.length > 0 && (
        <div className="rounded-2xl border border-amber/35 bg-amber-tint p-5 shadow-xs">
          <div className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-amber/20 text-amber">
              <AlertTriangle className="h-5 w-5 animate-pulse" />
            </span>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-amber/25 px-2.5 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wider text-amber">
                  Billing Date Reached
                </span>
                <span className="text-xs text-muted font-sans">• {dueBills.length} Bill{dueBills.length > 1 ? "s" : ""} Due Today</span>
              </div>
              <h2 className="mt-1 font-heading text-base font-bold text-heading">
                You have reached the billing date for upcoming commitments.
              </h2>
              <p className="mt-0.5 font-sans text-xs text-body">
                Do you want to deduct these amounts from your bank balance and settle? Non-recurring bills will be deleted; recurring monthly bills will advance and ping you again next month.
              </p>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {dueBills.map((b) => (
                  <div
                    key={b.id}
                    className="flex flex-col justify-between gap-3 rounded-xl border border-border bg-card p-3.5 shadow-2xs hover:shadow-xs transition-shadow"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-heading text-sm font-bold text-heading">{b.title}</span>
                        <span className="rounded bg-card-elevated border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                          {CATEGORY_LABELS[b.category]}
                        </span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <span className="font-mono text-sm font-bold text-primary">{formatINR(b.amount)}</span>
                        <span className="text-[11px] font-sans text-muted">
                          {b.isRecurringMonthly ? "• Monthly Recurring" : "• One-time Bill"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-2 border-t border-border/60">
                      {b.isDeferrable && (
                        <button
                          type="button"
                          onClick={() => void handleDefer(b)}
                          className="rounded-lg border border-border bg-card-elevated px-2.5 py-1 text-xs font-medium text-body hover:bg-card hover:text-heading transition-colors cursor-pointer"
                        >
                          Defer +7d
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setSettleBill(b)}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-[var(--btn-primary-text)] shadow-xs hover:bg-primary-hover transition-colors cursor-pointer"
                      >
                        <Wallet className="h-3.5 w-3.5" />
                        Settle from Bank
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="h-64 rounded-2xl border border-border bg-card shadow-xs animate-pulse" />
      ) : bills.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-12 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <Receipt className="h-8 w-8" />
          </div>
          <h2 className="mt-4 font-heading text-lg font-bold tracking-tight text-heading">No Fixed Expenses or Bills Yet</h2>
          <p className="mx-auto mt-2 max-w-md font-sans text-sm text-muted leading-relaxed">
            Record upcoming clinic rent, staff salaries, equipment EMIs, and utility bills so the cash telemetry engine can forecast safe runway and warn of crunches.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-all active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Add Fixed Bill
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-card-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-muted font-sans">
              <tr>
                <th className="px-5 py-3.5 font-semibold">Title</th>
                <th className="px-5 py-3.5 font-semibold">Category</th>
                <th className="px-5 py-3.5 text-right font-semibold">Amount</th>
                <th className="px-5 py-3.5 font-semibold">Due Date</th>
                <th className="px-5 py-3.5 font-semibold">Frequency</th>
                <th className="px-5 py-3.5 font-semibold">Status</th>
                <th className="px-5 py-3.5 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {bills.map((bill) => {
                const dueISO = effectiveDueISO(bill);
                return (
                  <tr key={bill.id} className="hover:bg-card-elevated transition-colors">
                    <td className="px-5 py-3.5 font-heading font-semibold text-heading">{bill.title}</td>
                    <td className="px-5 py-3.5 text-body">{CATEGORY_LABELS[bill.category]}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums font-mono font-semibold text-heading">{formatINR(bill.amount)}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap text-body font-mono text-xs">
                      <span>{formatDateShort(dueISO)}</span>
                      {bill.deferredDays > 0 && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber-tint px-2 py-0.5 text-[10px] font-mono font-semibold text-amber ring-1 ring-amber/20">
                          +{bill.deferredDays}d deferred
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-muted font-sans">{bill.isRecurringMonthly ? "Monthly" : "One-time"}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          bill.isPaid
                            ? "bg-emerald-tint text-emerald ring-1 ring-emerald/20"
                            : "bg-amber-tint text-amber ring-1 ring-amber/20"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${bill.isPaid ? "bg-emerald" : "bg-amber"}`} />
                        {bill.isPaid ? "Paid" : "Upcoming"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1.5">
                        {!bill.isPaid && (
                          <button
                            type="button"
                            onClick={() => setSettleBill(bill)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald/30 bg-emerald-tint px-2.5 py-1 text-xs font-semibold text-emerald hover:bg-emerald/20 transition-colors cursor-pointer"
                          >
                            <CheckCircle className="h-3 w-3" />
                            Settle from Bank
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDefer(bill)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-body hover:bg-card-elevated transition-colors"
                        >
                          <CalendarClock className="h-3 w-3" />
                          Defer +7d
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(bill)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-xs font-semibold text-muted hover:text-primary hover:bg-card-elevated transition-colors"
                          aria-label={`Edit ${bill.title}`}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={modalOpen} onClose={closeModal} title={editingId ? "Edit Bill" : "Add Bill"}>
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="bill-title" className="text-sm font-medium text-heading">
              Title <span className="text-coral">*</span>
            </label>
            <input
              id="bill-title"
              type="text"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              aria-invalid={Boolean(errors.title)}
              className={INPUT_CLASS}
            />
            {errors.title && <p role="alert" className="mt-1 text-xs text-coral">{errors.title}</p>}
          </div>

          <div>
            <label htmlFor="bill-category" className="text-sm font-medium text-heading">
              Category
            </label>
            <select
              id="bill-category"
              value={form.category}
              onChange={(e) => setField("category", e.target.value as Category)}
              className={INPUT_CLASS}
            >
              {CATEGORY_ORDER.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="bill-amount" className="text-sm font-medium text-heading">
                Amount (₹) <span className="text-coral">*</span>
              </label>
              <input
                id="bill-amount"
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setField("amount", e.target.value)}
                aria-invalid={Boolean(errors.amount)}
                className={`${INPUT_CLASS} tabular-nums font-mono`}
              />
              {errors.amount && <p role="alert" className="mt-1 text-xs text-coral">{errors.amount}</p>}
            </div>

            <div>
              <label htmlFor="bill-due" className="text-sm font-medium text-heading">
                Due Date <span className="text-coral">*</span>
              </label>
              <input
                id="bill-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setField("dueDate", e.target.value)}
                aria-invalid={Boolean(errors.dueDate)}
                className={INPUT_CLASS}
              />
              {errors.dueDate && <p role="alert" className="mt-1 text-xs text-coral">{errors.dueDate}</p>}
            </div>
          </div>

          <Toggle
            label="Recurring Monthly"
            checked={form.isRecurringMonthly}
            onChange={(v) => setField("isRecurringMonthly", v)}
          />
          <Toggle
            label="Deferrable"
            checked={form.isDeferrable}
            onChange={(v) => setField("isDeferrable", v)}
          />

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-body hover:bg-card-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-primary-hover transition-colors shadow-xs"
            >
              {editingId ? "Save Changes" : "Add Bill"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Settle Bill Confirmation Modal */}
      <Modal
        open={settleBill !== null}
        onClose={() => !settling && setSettleBill(null)}
        title="Settle Bill & Deduct from Bank"
      >
        {settleBill && (
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card-elevated p-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-muted">Expense Commitment</span>
                  <p className="mt-0.5 font-heading text-base font-bold text-heading">{settleBill.title}</p>
                </div>
                <span className="rounded-lg bg-card border border-border px-2.5 py-1 text-xs font-semibold text-body">
                  {CATEGORY_LABELS[settleBill.category]}
                </span>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
                <div>
                  <span className="text-[11px] text-muted">Amount to Deduct:</span>
                  <p className="font-mono text-base font-bold text-coral">-{formatINR(settleBill.amount)}</p>
                </div>
                <div>
                  <span className="text-[11px] text-muted">Current Bank Balance:</span>
                  <p className="font-mono text-base font-bold text-primary">
                    {bankBalance !== null ? formatINR(bankBalance) : "—"}
                  </p>
                </div>
              </div>

              {bankBalance !== null && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-card px-3 py-2 text-xs border border-border">
                  <span className="text-muted">Balance after deduction:</span>
                  <span
                    className={`font-mono font-bold ${
                      bankBalance - settleBill.amount < 0 ? "text-coral" : "text-emerald"
                    }`}
                  >
                    {formatINR(bankBalance - settleBill.amount)}
                  </span>
                </div>
              )}
            </div>

            {/* Explanatory Rule Callout */}
            <div className="rounded-xl border border-border bg-card p-3.5 text-xs text-body">
              {settleBill.isRecurringMonthly ? (
                <div className="space-y-1">
                  <p className="font-semibold text-primary">🔁 Monthly Recurring Expense</p>
                  <p className="text-muted leading-relaxed">
                    Settling will reduce <strong>{formatINR(settleBill.amount)}</strong> from your money in the bank and advance the due date by 1 month. CashPulse will ping you again on the next billing date.
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="font-semibold text-amber">🗑️ One-Time Non-Recurring Bill</p>
                  <p className="text-muted leading-relaxed">
                    Settling will reduce <strong>{formatINR(settleBill.amount)}</strong> from your money in the bank and <strong>permanently delete</strong> this bill from your commitments.
                  </p>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={settling}
                onClick={() => setSettleBill(null)}
                className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-body hover:bg-card-elevated transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={settling}
                onClick={() => void handleConfirmSettle()}
                className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-[var(--btn-primary-text)] hover:bg-primary-hover transition-colors shadow-xs cursor-pointer disabled:opacity-50"
              >
                {settling ? "Settling bill…" : "Yes, Deduct & Settle Bill"}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </section>
  );
}
