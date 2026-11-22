"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Mail, Pencil, Phone, Plus, Trash2, Users, X } from "lucide-react";
import { Modal } from "../../../components/ui/Modal";
import type {
  Customer,
  Invoice,
  InvoiceStatus,
  MessageStatus,
  OutboundMessage,
  RelationshipTier,
  RiskLevel,
} from "../../../types/domain";
import { formatINR, formatDateShort } from "../../../lib/format";
import { ApiError, apiFetch } from "../../../lib/api";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";

// Invoice rows as GET /api/invoices returns them (no createdBy field).
type ListedInvoice = Omit<Invoice, "createdBy">;

// Customer rows as GET /api/customers returns them, with the server-computed risk object.
type CustomerWithRisk = Customer & { risk: { label: string; risk: RiskLevel | null } };


const TIERS: { value: RelationshipTier; label: string }[] = [
  { value: "VIP_LOYAL", label: "VIP Loyal" },
  { value: "REGULAR", label: "Regular" },
  { value: "NEW", label: "New" },
  { value: "CHRONIC_LATE", label: "Chronic Late" },
];

const TIER_BADGE: Record<RelationshipTier, string> = {
  VIP_LOYAL: "bg-emerald-tint text-emerald",
  REGULAR: "bg-primary/10 text-primary",
  NEW: "bg-card-elevated text-muted border border-border",
  CHRONIC_LATE: "bg-coral-tint text-coral",
};

const RISK_TEXT: Record<RiskLevel | "none", string> = {
  Low: "text-emerald",
  Medium: "text-amber",
  High: "text-coral",
  none: "text-muted",
};

const INVOICE_BADGE: Record<InvoiceStatus, string> = {
  DRAFT: "bg-card-elevated text-muted",
  SENT: "bg-primary/10 text-primary",
  PARTIAL: "bg-amber-tint text-amber",
  OVERDUE: "bg-coral-tint text-coral",
  PAID: "bg-emerald-tint text-emerald",
};

const MESSAGE_STATUS_BADGE: Record<MessageStatus, string> = {
  QUEUED: "bg-amber-tint text-amber",
  SENT: "bg-primary/10 text-primary",
  DELIVERED: "bg-emerald-tint text-emerald",
  FAILED: "bg-coral-tint text-coral",
};

const INPUT =
  "mt-1 w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-body placeholder:text-[var(--input-placeholder)] focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 font-sans";

interface FormState {
  name: string;
  phone: string;
  email: string;
  relationshipTier: RelationshipTier;
  notes: string;
}

type FormErrors = Partial<Record<keyof FormState, string>>;

const EMPTY_FORM: FormState = {
  name: "",
  phone: "",
  email: "",
  relationshipTier: "REGULAR",
  notes: "",
};

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = "Name is required.";
  if (!form.phone.trim()) {
    errors.phone = "Phone is required.";
  } else if (form.phone.replace(/\D/g, "").length < 10) {
    errors.phone = "Enter at least 10 digits.";
  }
  if (form.email.trim() && !/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    errors.email = "Enter a valid email address.";
  }
  return errors;
}

function TierBadge({ tier }: { tier: RelationshipTier }) {
  const label = TIERS.find((t) => t.value === tier)?.label ?? tier;
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${TIER_BADGE[tier]}`}>
      {label}
    </span>
  );
}

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<CustomerWithRisk[]>([]);
  const [invoices, setInvoices] = useState<ListedInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // 401 sends the user to sign in. Any other error is toasted and returned for inline display.
  const reportError = useCallback(
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

  // silent = background refresh: no loading state and no error toast (401 still redirects).
  const loadAll = useCallback(
    async (silent = false) => {
      try {
        const [customerRows, invoiceRows] = await Promise.all([
          apiFetch<CustomerWithRisk[]>("/api/customers"),
          apiFetch<ListedInvoice[]>("/api/invoices"),
        ]);
        setCustomers(customerRows);
        setInvoices(invoiceRows);
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
        const [customerRows, invoiceRows] = await Promise.all([
          apiFetch<CustomerWithRisk[]>("/api/customers"),
          apiFetch<ListedInvoice[]>("/api/invoices"),
        ]);
        setCustomers(customerRows);
        setInvoices(invoiceRows);
        setPageError(null);
      } catch (err) {
        setPageError(reportError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [reportError]);

  useAutoRefresh(() => loadAll(true), 4000);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [drawerId, setDrawerId] = useState<string | null>(null);

  const closeDrawer = useCallback(() => setDrawerId(null), []);
  const closeModal = useCallback(() => setModalOpen(false), []);

  // Escape closes the drawer only when the edit modal is not open on top of it.
  useEffect(() => {
    if (!drawerId || modalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDrawerId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerId, modalOpen]);

  // Message log for the open drawer. GET /api/messages has no customer filter, so the full list is
  // fetched once per drawer open and filtered by customerId. rows === null means the request failed.
  const [messageLog, setMessageLog] = useState<{
    customerId: string;
    rows: OutboundMessage[] | null;
  } | null>(null);

  useEffect(() => {
    if (!drawerId) return;
    let cancelled = false;
    apiFetch<OutboundMessage[]>("/api/messages")
      .then((rows) => {
        if (!cancelled) setMessageLog({ customerId: drawerId, rows });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setMessageLog({ customerId: drawerId, rows: null });
        reportError(err);
      });
    return () => {
      cancelled = true;
    };
  }, [drawerId, reportError]);

  if (loading) {

    return (
      <section className="space-y-6">
        <header>
          <h1 className="font-heading text-2xl font-bold text-heading">Customers</h1>
        </header>
        <div className="h-64 rounded-2xl border border-border bg-card shadow-xs" />
      </section>
    );
  }

  const drawerCustomer = drawerId ? customers.find((c) => c.id === drawerId) : undefined;
  const drawerInvoices: ListedInvoice[] = drawerCustomer

    ? invoices.filter((inv) => inv.customerId === drawerCustomer.id)
    : [];

  // undefined = still loading, null = request failed, array = loaded (all customers' messages).
  const drawerMessageRows =
    drawerCustomer && messageLog?.customerId === drawerCustomer.id ? messageLog.rows : undefined;
  const drawerMessages: OutboundMessage[] = (drawerMessageRows ?? [])
    .filter((m) => m.customerId === drawerCustomer?.id)
    .sort((a, b) => Date.parse(b.sentAt) - Date.parse(a.sentAt));

  function openAdd() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setErrors({});
    setFormError(null);
    setModalOpen(true);
  }

  function openEdit(c: Customer) {
    setEditingId(c.id);
    setForm({
      name: c.name,
      phone: c.phone,
      email: c.email ?? "",
      relationshipTier: c.relationshipTier,
      notes: c.notes ?? "",
    });
    setErrors({});
    setFormError(null);
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    // null clears an optional field on PATCH; an omitted key would keep the old value.
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim(),
      email: form.email.trim() || null,
      relationshipTier: form.relationshipTier,
      notes: form.notes.trim() || null,
    };

    setFormError(null);
    try {
      if (editingId) {
        await apiFetch<void>(`/api/customers/${editingId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        toast.success(`${payload.name} updated`);
      } else {
        await apiFetch<Customer>("/api/customers", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        toast.success(`${payload.name} added`);
      }
      setModalOpen(false);
    } catch (err) {
      setFormError(reportError(err));
      return;
    }
    await loadAll();
  }

  async function handleDelete(c: Customer) {
    const invoiceCount = invoices.filter((inv) => inv.customerId === c.id).length;
    const detail = invoiceCount > 0 ? ` This also deletes ${invoiceCount} invoice(s).` : "";
    if (!window.confirm(`Delete ${c.name}?${detail}`)) return;
    try {
      await apiFetch<void>(`/api/customers/${c.id}`, { method: "DELETE" });
    } catch (err) {
      setPageError(reportError(err));
      return;
    }
    if (drawerId === c.id) setDrawerId(null);
    toast.success(`${c.name} deleted`);
    await loadAll();
  }


  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((er) => ({ ...er, [key]: undefined }));
  }

  return (
    <section className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-heading">Customers</h1>
          <p className="mt-1 font-sans text-sm text-muted">Patients and clients, their tiers and payment habits.</p>
        </div>
        <button
          type="button"
          onClick={openAdd}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Customer
        </button>
      </header>

      {pageError && (
        <p role="alert" className="rounded-xl bg-coral-tint px-3.5 py-2.5 text-sm text-coral">
          {pageError}
        </p>
      )}

      {customers.length === 0 ? (
        <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-12 text-center shadow-xs">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary shadow-xs">
            <Users className="h-8 w-8" />
          </div>
          <h2 className="mt-4 font-heading text-lg font-bold tracking-tight text-heading">No Patients or Clients Yet</h2>
          <p className="mx-auto mt-2 max-w-md font-sans text-sm text-muted leading-relaxed">
            Add patient profiles to track past payment behavior, assign relationship tiers, and automate WhatsApp payment reminders.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={openAdd}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-all active:scale-95"
            >
              <Plus className="h-4 w-4" />
              Add Customer
            </button>
          </div>
          <div className="mt-8 rounded-xl border border-border/60 bg-card-elevated p-4 max-w-lg mx-auto text-left">
            <p className="font-heading text-[11px] font-bold uppercase tracking-wider text-primary">Pulse AI Voice & Chat Shortcuts</p>
            <p className="mt-1 font-sans text-xs text-muted">
              You can also click the bottom-right copilot or use your mic to say:
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-lg border border-border bg-card px-2.5 py-1 text-xs text-body font-medium">
                &ldquo;Add customer Rajesh mobile no 9876543210&rdquo;
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card shadow-xs">
          <table className="min-w-full divide-y divide-border text-sm">
            <thead className="bg-card-elevated text-left text-[11px] font-semibold uppercase tracking-wider text-muted font-sans">
              <tr>
                <th className="px-5 py-3.5">Name</th>
                <th className="px-5 py-3.5">Phone</th>
                <th className="px-5 py-3.5">Tier</th>
                <th className="px-5 py-3.5 text-right">Invoices</th>
                <th className="px-5 py-3.5 text-right">Late</th>
                <th className="px-5 py-3.5 text-right">Avg delay (days)</th>
                <th className="px-5 py-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {customers.map((c) => {
                const initial = c.name.trim().charAt(0).toUpperCase() || "C";
                return (
                  <tr
                    key={c.id}
                    onClick={() => setDrawerId(c.id)}
                    className="cursor-pointer hover:bg-card-elevated transition-colors"
                  >
                    <td className="px-5 py-3.5 font-medium text-heading">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary font-heading">
                          {initial}
                        </span>
                        <span className="font-heading font-semibold text-heading">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 tabular-nums text-muted font-mono text-xs">{c.phone}</td>
                    <td className="px-5 py-3.5">
                      <TierBadge tier={c.relationshipTier} />
                    </td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-heading font-mono font-medium">{c.pastInvoiceCount}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted font-mono">{c.pastLateCount}</td>
                    <td className="px-5 py-3.5 text-right tabular-nums text-muted font-mono">
                      {c.movingAvgDelayDays.toFixed(1)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDrawerId(c.id);
                          }}
                          className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary hover:bg-primary/10 transition-colors"
                        >
                          View
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(c);
                          }}
                          aria-label={`Edit ${c.name}`}
                          className="rounded-lg p-1.5 text-muted hover:bg-card-elevated hover:text-heading transition-colors"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(c);
                          }}
                          aria-label={`Delete ${c.name}`}
                          className="rounded-lg p-1.5 text-muted hover:bg-coral-tint hover:text-coral transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
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

      <Modal open={modalOpen} onClose={closeModal} title={editingId ? "Edit Customer" : "Add Customer"}>
        <form onSubmit={handleSave} noValidate className="space-y-4">
          <div>
            <label htmlFor="cust-name" className="text-sm font-medium text-heading">
              Name <span className="text-coral">*</span>
            </label>
            <input
              id="cust-name"
              type="text"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className={INPUT}
              aria-invalid={!!errors.name}
            />
            {errors.name && <p className="mt-1 text-xs text-coral">{errors.name}</p>}
          </div>

          <div>
            <label htmlFor="cust-phone" className="text-sm font-medium text-heading">
              Phone <span className="text-coral">*</span>
            </label>
            <input
              id="cust-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="+91 98765 00001"
              className={INPUT}
              aria-invalid={!!errors.phone}
            />
            {errors.phone && <p className="mt-1 text-xs text-coral">{errors.phone}</p>}
          </div>

          <div>
            <label htmlFor="cust-email" className="text-sm font-medium text-heading">
              Email <span className="text-xs font-normal text-muted">(optional)</span>
            </label>
            <input
              id="cust-email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              className={INPUT}
              aria-invalid={!!errors.email}
            />
            {errors.email && <p className="mt-1 text-xs text-coral">{errors.email}</p>}
          </div>

          <div>
            <label htmlFor="cust-tier" className="text-sm font-medium text-heading">
              Relationship tier
            </label>
            <select
              id="cust-tier"
              value={form.relationshipTier}
              onChange={(e) => setField("relationshipTier", e.target.value as RelationshipTier)}
              className={INPUT}
            >
              {TIERS.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="cust-notes" className="text-sm font-medium text-heading">
              Notes <span className="text-xs font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="cust-notes"
              rows={3}
              value={form.notes}
              onChange={(e) => setField("notes", e.target.value)}
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
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-border bg-card px-4 py-2 text-sm font-medium text-body hover:bg-card-elevated transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] shadow-sm hover:bg-primary-hover transition-colors"
            >
              {editingId ? "Save changes" : "Add customer"}
            </button>
          </div>
        </form>
      </Modal>

      {drawerCustomer && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity" onClick={closeDrawer} aria-hidden="true" />
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`${drawerCustomer.name} profile`}
            className="relative flex h-full w-full max-w-md flex-col bg-card border-l border-border shadow-2xl"
          >
            <div className="flex items-start justify-between border-b border-border/80 px-6 py-4">
              <div>
                <h2 className="font-heading text-lg font-bold text-heading">{drawerCustomer.name}</h2>
                <div className="mt-1">
                  <TierBadge tier={drawerCustomer.relationshipTier} />
                </div>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                aria-label="Close profile"
                className="rounded-lg p-1.5 text-muted hover:bg-card-elevated hover:text-heading transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <div className="space-y-2 text-sm text-body font-sans">
                <p className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted" />
                  <span className="tabular-nums font-mono">{drawerCustomer.phone}</span>
                </p>
                {drawerCustomer.email && (
                  <p className="flex items-center gap-2">
                    <Mail className="h-4 w-4 text-muted" />
                    {drawerCustomer.email}
                  </p>
                )}
                {drawerCustomer.notes && (
                  <p className="rounded-xl bg-card-elevated p-3 text-body border border-border/60">{drawerCustomer.notes}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-card-elevated p-4">
                  <p className="text-xs text-muted">Payment habit</p>
                  <p
                    className={`mt-1 text-sm font-semibold ${
                      RISK_TEXT[drawerCustomer.risk.risk ?? "none"]
                    }`}
                  >
                    {drawerCustomer.risk.label}
                  </p>
                </div>
                <div className="rounded-xl border border-border bg-card-elevated p-4">
                  <p className="text-xs text-muted">Avg delay</p>
                  <p className="mt-1 font-mono text-sm font-semibold tabular-nums text-heading">
                    {drawerCustomer.movingAvgDelayDays.toFixed(1)} days
                  </p>
                  <p className="mt-1 text-xs text-muted tabular-nums">
                    {drawerCustomer.pastLateCount} late of {drawerCustomer.pastInvoiceCount} invoices
                  </p>
                </div>
              </div>

              <div>
                <h3 className="mb-2 font-heading text-sm font-bold text-heading">Invoices</h3>
                {drawerInvoices.length === 0 ? (
                  <p className="text-sm text-muted">No invoices for this customer yet.</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card-elevated/40">
                    {drawerInvoices.map((inv) => (
                      <li key={inv.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                        <div>
                          <p className="font-mono font-medium text-heading text-xs">{inv.invoiceNumber}</p>
                          <p className="text-xs text-muted">Due {formatDateShort(inv.dueDate)}</p>
                        </div>
                        <div className="text-right">
                          <p className="tabular-nums font-mono font-semibold text-heading">{formatINR(inv.amount)}</p>
                          <p className="text-xs tabular-nums text-muted font-mono">Paid {formatINR(inv.amountPaid)}</p>
                          <span
                            className={`mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${INVOICE_BADGE[inv.status]}`}
                          >
                            {inv.status}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div>
                <h3 className="mb-2 font-heading text-sm font-bold text-heading">Message log</h3>
                {drawerMessageRows === undefined ? (
                  <p className="text-sm text-muted">Loading messages...</p>
                ) : drawerMessageRows === null ? (
                  <p className="text-sm text-coral">Could not load messages.</p>
                ) : drawerMessages.length === 0 ? (
                  <p className="text-sm text-muted">No messages sent yet</p>
                ) : (
                  <ul className="divide-y divide-border/60 rounded-xl border border-border bg-card-elevated/40">
                    {drawerMessages.map((m) => (
                      <li key={m.id} className="space-y-1 px-4 py-3 text-sm">
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-heading font-medium text-heading text-xs">
                            {m.channel} · {m.tone}
                          </p>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${MESSAGE_STATUS_BADGE[m.status]}`}
                          >
                            {m.status}
                          </span>
                        </div>
                        <p className="text-xs text-muted">Sent {formatDateShort(m.sentAt.slice(0, 10))}</p>
                        <p className="text-xs text-body">
                          {m.body.length > 120 ? `${m.body.slice(0, 120)}…` : m.body}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            <div className="flex justify-between gap-2 border-t border-border px-6 py-4 bg-card">
              <button
                type="button"
                onClick={() => handleDelete(drawerCustomer)}
                className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-coral hover:bg-coral-tint transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </button>
              <button
                type="button"
                onClick={() => openEdit(drawerCustomer)}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-primary-hover transition-colors shadow-xs"
              >
                <Pencil className="h-4 w-4" />
                Edit
              </button>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
