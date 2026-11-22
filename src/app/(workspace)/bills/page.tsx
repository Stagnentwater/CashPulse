"use client";

import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, CheckCircle, Pencil, Plus, Receipt } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import { ApiError, apiFetch } from "../../../lib/api";
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
  "mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400";

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
    <div className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2">
      <span className="text-sm text-slate-700">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
          checked ? "bg-slate-900" : "bg-slate-300"
        }`}
      >
        <span
          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}

export default function BillsPage() {
  const router = useRouter();
  const [allBills, setAllBills] = useState<UpcomingBill[]>([]);
  const [loading, setLoading] = useState(true);

  // Unpaid first, then by effective due date (after deferrals).
  const bills = useMemo(
    () =>
      [...allBills].sort((a, b) => {
        if (a.isPaid !== b.isPaid) return a.isPaid ? 1 : -1;
        return effectiveDueISO(a).localeCompare(effectiveDueISO(b));
      }),
    [allBills],
  );

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
      } catch (err) {
        reportApiError(err, () => router.replace("/login"));
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  useAutoRefresh(() => loadBills(true), 4000);

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

  const handleMarkPaid = async (bill: UpcomingBill) => {
    try {
      await apiFetch<UpcomingBill>(`/api/bills/${bill.id}/paid`, { method: "POST" });
    } catch (err) {
      reportApiError(err, () => router.replace("/login"));
      return;
    }
    toast.success(
      bill.isRecurringMonthly
        ? `"${bill.title}" paid. Next due next month.`
        : `"${bill.title}" marked paid`,
    );
    await loadBills();
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
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
            <span>Commitments & Payables</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-primary">Bills & Fixed Expenses</h1>
          <p className="mt-1 text-sm text-slate-500">
            Track clinic rent, salaries, utilities, and EMIs to safeguard your 90-day cash flow.
          </p>
        </div>
        <button
          type="button"
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover transition-all active:scale-95"
        >
          <Plus className="h-4 w-4" />
          Add Bill
        </button>
      </div>

      {loading ? (
        <div className="h-64 rounded-2xl border border-border bg-card shadow-xs animate-pulse" />
      ) : bills.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-12 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <Receipt className="h-8 w-8" />
          </div>
          <h2 className="mt-4 text-lg font-bold tracking-tight text-primary">No Fixed Expenses or Bills Yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500 leading-relaxed">
            Record upcoming clinic rent, staff salaries, equipment EMIs, and utility bills so the cash telemetry engine can forecast safe runway and warn of crunches.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-primary-hover transition-all active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Add Fixed Bill
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-card-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-slate-500">
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
                  <tr key={bill.id} className="hover:bg-card-elevated transition-colors text-slate-700 dark:text-slate-300">
                    <td className="px-5 py-3.5 font-medium text-primary">{bill.title}</td>
                    <td className="px-5 py-3.5">{CATEGORY_LABELS[bill.category]}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums font-semibold text-primary">{formatINR(bill.amount)}</td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span>{formatDateShort(dueISO)}</span>
                      {bill.deferredDays > 0 && (
                        <span className="ml-2 inline-flex items-center rounded-full bg-amber/10 px-2 py-0.5 text-[10px] font-semibold text-amber ring-1 ring-amber/20">
                          +{bill.deferredDays}d deferred
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-500">{bill.isRecurringMonthly ? "Monthly" : "One-time"}</td>
                    <td className="px-5 py-3.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                          bill.isPaid
                            ? "bg-emerald/10 text-emerald ring-1 ring-emerald/20"
                            : "bg-amber/10 text-amber ring-1 ring-amber/20"
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
                            onClick={() => handleMarkPaid(bill)}
                            className="inline-flex items-center gap-1 rounded-lg border border-emerald/30 bg-emerald/5 px-2.5 py-1 text-xs font-semibold text-emerald hover:bg-emerald/15 transition-colors"
                          >
                            <CheckCircle className="h-3 w-3" />
                            Mark Paid
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDefer(bill)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-card-elevated transition-colors"
                        >
                          <CalendarClock className="h-3 w-3" />
                          Defer +7d
                        </button>
                        <button
                          type="button"
                          onClick={() => openEdit(bill)}
                          className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-xs font-semibold text-slate-400 hover:text-primary hover:bg-card-elevated transition-colors"
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
            <label htmlFor="bill-title" className="text-sm font-medium text-slate-700">
              Title <span className="text-red-600">*</span>
            </label>
            <input
              id="bill-title"
              type="text"
              value={form.title}
              onChange={(e) => setField("title", e.target.value)}
              aria-invalid={Boolean(errors.title)}
              className={INPUT_CLASS}
            />
            {errors.title && <p role="alert" className="mt-1 text-xs text-red-600">{errors.title}</p>}
          </div>

          <div>
            <label htmlFor="bill-category" className="text-sm font-medium text-slate-700">
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
              <label htmlFor="bill-amount" className="text-sm font-medium text-slate-700">
                Amount (₹) <span className="text-red-600">*</span>
              </label>
              <input
                id="bill-amount"
                type="text"
                inputMode="decimal"
                value={form.amount}
                onChange={(e) => setField("amount", e.target.value)}
                aria-invalid={Boolean(errors.amount)}
                className={`${INPUT_CLASS} tabular-nums`}
              />
              {errors.amount && <p role="alert" className="mt-1 text-xs text-red-600">{errors.amount}</p>}
            </div>

            <div>
              <label htmlFor="bill-due" className="text-sm font-medium text-slate-700">
                Due Date <span className="text-red-600">*</span>
              </label>
              <input
                id="bill-due"
                type="date"
                value={form.dueDate}
                onChange={(e) => setField("dueDate", e.target.value)}
                aria-invalid={Boolean(errors.dueDate)}
                className={INPUT_CLASS}
              />
              {errors.dueDate && <p role="alert" className="mt-1 text-xs text-red-600">{errors.dueDate}</p>}
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
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {editingId ? "Save Changes" : "Add Bill"}
            </button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
