"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, apiFetch, authApi } from "../../lib/api";
import type { MessageChannel, MessageStatus, ReminderTone } from "../../types/domain";
import { formatINR } from "../../lib/format";
import { buildReminderBody, buildWhatsAppLink } from "../../lib/messagingService";

const TONES: ReminderTone[] = ["GENTLE", "WARM", "FIRM"];
const CHANNELS: MessageChannel[] = ["WHATSAPP", "SMS", "EMAIL"];

const SELECT_CLASS =
  "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-body focus:outline-none focus:ring-2 focus:ring-primary/30";
const LABEL_CLASS = "mb-1.5 block text-sm font-medium text-heading font-sans";

/** Customer row from GET /api/customers (only the fields this drawer uses). */
interface ApiCustomer {
  id: string;
  name: string;
  phone: string;
}

/** Invoice row from GET /api/invoices. `balance` is computed by the server. */
interface ApiInvoice {
  id: string;
  invoiceNumber: string;
  customerId: string;
  balance: number;
  upiLink: string;
}

/** Row returned by POST /api/messages and PATCH /api/messages/{id}. */
interface ApiMessage {
  id: string;
}

/** 401 sends the user to sign in; any other error is shown as a toast. */
function reportApiError(err: unknown, onUnauthorized: () => void): void {
  if (err instanceof ApiError && err.status === 401) {
    onUnauthorized();
    return;
  }
  toast.error(err instanceof Error ? err.message : "Something went wrong.");
}

export interface ReminderDrawerProps {
  open: boolean;
  onClose: () => void;
  customerId?: string;
  invoiceId?: string;
  /** Called after a message is created or its status changes, so the caller can refetch. */
  onChanged?: () => void;
}

export function ReminderDrawer({ open, onClose, customerId, invoiceId, onChanged }: ReminderDrawerProps) {
  if (!open) return null;
  // Mounted only while open, so each opening starts from the current props.
  return (
    <ReminderDrawerPanel
      onClose={onClose}
      customerId={customerId}
      invoiceId={invoiceId}
      onChanged={onChanged}
    />
  );
}

function ReminderDrawerPanel({
  onClose,
  customerId,
  invoiceId,
  onChanged,
}: Omit<ReminderDrawerProps, "open">) {
  const router = useRouter();
  const [data, setData] = useState<{
    customers: ApiCustomer[];
    invoices: ApiInvoice[];
    clinicName: string;
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // Load customers, open invoices (balance > 0) and the clinic name each time the drawer opens.
  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<ApiCustomer[]>("/api/customers"),
      apiFetch<ApiInvoice[]>("/api/invoices"),
      authApi.me(),
    ])
      .then(([customers, invoices, me]) => {
        if (cancelled) return;
        setData({
          customers,
          invoices: invoices.filter((i) => i.balance > 0),
          clinicName: me.user.clinicName,
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setLoadFailed(true);
        reportApiError(err, () => router.replace("/login"));
      });
    return () => {
      cancelled = true;
    };
  }, [router]);

  // Escape closes the drawer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-xs transition-opacity" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Send payment reminder"
        className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-card border-l border-border shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border/80 px-6 py-4">
          <h2 className="font-heading text-lg font-bold text-heading">Send payment reminder</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted hover:bg-card-elevated hover:text-heading transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {data ? (
          <ReminderDrawerForm
            customers={data.customers}
            invoices={data.invoices}
            clinicName={data.clinicName}
            customerId={customerId}
            invoiceId={invoiceId}
            onChanged={onChanged}
          />
        ) : (
          <div className="flex-1 p-6 text-sm text-muted">
            {loadFailed ? "Could not load customers and invoices." : "Loading…"}
          </div>
        )}
      </aside>
    </div>
  );
}

function ReminderDrawerForm({
  customers,
  invoices,
  clinicName: clinicNameFromServer,
  customerId,
  invoiceId,
  onChanged,
}: {
  customers: ApiCustomer[];
  invoices: ApiInvoice[];
  clinicName: string;
  customerId?: string;
  invoiceId?: string;
  onChanged?: () => void;
}) {
  const router = useRouter();
  const clinicName = clinicNameFromServer || "our clinic";

  const openInvoicesFor = (cid: string) => invoices.filter((i) => i.customerId === cid);

  const [customerSel, setCustomerSel] = useState<string>(
    () => customers.find((c) => c.id === customerId)?.id ?? customers[0]?.id ?? "",
  );
  const [invoiceSel, setInvoiceSel] = useState<string>(() => {
    const cid = customers.find((c) => c.id === customerId)?.id ?? customers[0]?.id ?? "";
    const list = openInvoicesFor(cid);
    return list.find((i) => i.id === invoiceId)?.id ?? list[0]?.id ?? "";
  });
  const [tone, setTone] = useState<ReminderTone>("GENTLE");
  const [partial, setPartial] = useState(false);
  const [channel, setChannel] = useState<MessageChannel>("WHATSAPP");
  // null means "no user edit": the body follows the generated template.
  const [edited, setEdited] = useState<string | null>(null);

  const timers = useRef<number[]>([]);

  const customer = customers.find((c) => c.id === customerSel);
  const eligibleInvoices = openInvoicesFor(customerSel);
  const invoice = eligibleInvoices.find((i) => i.id === invoiceSel);

  const generatedBody =
    customer && invoice
      ? buildReminderBody({
          customerName: customer.name,
          clinicName,
          amountDueINR: invoice.balance,
          upiLink: invoice.upiLink,
          tone,
          includePartialOption: partial,
          invoiceNumber: invoice.invoiceNumber,
        })
      : "";
  const body = edited ?? generatedBody;

  // Cancel pending status timers when the drawer unmounts.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
      pending.length = 0;
    };
  }, []);

  // Changing any input that feeds the template discards the user's edits and regenerates.
  const changeCustomer = (id: string) => {
    setCustomerSel(id);
    setInvoiceSel(openInvoicesFor(id)[0]?.id ?? "");
    setEdited(null);
  };
  const changeInvoice = (id: string) => {
    setInvoiceSel(id);
    setEdited(null);
  };
  const changeTone = (t: ReminderTone) => {
    setTone(t);
    setEdited(null);
  };
  const changePartial = (v: boolean) => {
    setPartial(v);
    setEdited(null);
  };

  // Returns true when the server accepted the new status.
  const setStatus = async (id: string, status: MessageStatus): Promise<boolean> => {
    try {
      await apiFetch<ApiMessage>(`/api/messages/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      reportApiError(err, () => router.replace("/login"));
      return false;
    }
    onChanged?.();
    return true;
  };

  const handleSend = async () => {
    if (!customer || !invoice || !body.trim()) return;
    let messageId: string;
    try {
      const created = await apiFetch<ApiMessage>("/api/messages", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer.id,
          invoiceId: invoice.id,
          channel,
          tone,
          includedPartialOption: partial,
          body,
        }),
      });
      messageId = created.id;
      await apiFetch<unknown>(`/api/invoices/${invoice.id}/reminded`, { method: "POST" });
    } catch (err) {
      reportApiError(err, () => router.replace("/login"));
      return;
    }
    toast.success("Message queued");
    onChanged?.();

    timers.current.push(
      window.setTimeout(() => {
        void setStatus(messageId, "SENT");
      }, 800),
      window.setTimeout(async () => {
        if (await setStatus(messageId, "DELIVERED")) toast.success("Message delivered");
      }, 2000),
    );
  };

  const handleOpenWhatsApp = () => {
    if (!customer || !body.trim()) return;
    window.open(buildWhatsAppLink(customer.phone, body), "_blank", "noopener,noreferrer");
  };

  return (
    <>
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        <div>
          <label htmlFor="reminder-customer" className={LABEL_CLASS}>
            Customer
          </label>
          <select
            id="reminder-customer"
            value={customerSel}
            onChange={(e) => changeCustomer(e.target.value)}
            className={SELECT_CLASS}
          >
            {customers.length === 0 && <option value="">No customers</option>}
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="reminder-invoice" className={LABEL_CLASS}>
            Invoice
          </label>
          <select
            id="reminder-invoice"
            value={invoice ? invoice.id : ""}
            onChange={(e) => changeInvoice(e.target.value)}
            disabled={eligibleInvoices.length === 0}
            className={SELECT_CLASS}
          >
            {eligibleInvoices.length === 0 && <option value="">No open invoices</option>}
            {eligibleInvoices.map((i) => (
              <option key={i.id} value={i.id}>
                {i.invoiceNumber} · {formatINR(i.balance)} due
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className={LABEL_CLASS}>Tone</span>
          <div className="inline-flex rounded-lg border border-border bg-canvas p-1">
            {TONES.map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tone === t}
                onClick={() => changeTone(t)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                  tone === t ? "bg-primary text-[var(--btn-primary-text)] font-semibold shadow-xs" : "text-body hover:bg-card-elevated"
                }`}
              >
                {t.charAt(0) + t.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-body">
          <input
            type="checkbox"
            checked={partial}
            onChange={(e) => changePartial(e.target.checked)}
            className="h-4 w-4 accent-primary"
          />
          Offer 50% partial UPI split
        </label>

        <div>
          <label htmlFor="reminder-channel" className={LABEL_CLASS}>
            Channel
          </label>
          <select
            id="reminder-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as MessageChannel)}
            className={SELECT_CLASS}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="reminder-body" className={LABEL_CLASS}>
            Message
          </label>
          <textarea
            id="reminder-body"
            value={body}
            onChange={(e) => setEdited(e.target.value)}
            rows={9}
            className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-body focus:outline-none focus:ring-2 focus:ring-primary/30 font-sans"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border p-6 bg-card">
        <button
          type="button"
          onClick={handleSend}
          disabled={!invoice || !body.trim()}
          className="rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-[var(--btn-primary-text)] hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50 transition-all shadow-xs"
        >
          Send via CashPulse Dispatch
        </button>
        <button
          type="button"
          onClick={handleOpenWhatsApp}
          disabled={!customer || !body.trim()}
          className="rounded-xl border border-border bg-card-elevated px-4 py-2.5 text-sm font-medium text-body hover:bg-card disabled:cursor-not-allowed disabled:opacity-50 transition-all shadow-xs"
        >
          Open in WhatsApp
        </button>
      </div>
    </>
  );
}
