"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ReminderDrawer } from "@/components/modals/ReminderDrawer";
import { ApiError, apiFetch } from "../../../lib/api";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";
import type { MessageStatus } from "../../../types/domain";
import { formatDateShort } from "../../../lib/format";

const PREVIEW_LENGTH = 80;

/** Row from GET /api/messages (camelCase). */
interface ApiMessage {
  id: string;
  customerName: string;
  channel: string;
  tone: string;
  includedPartialOption: boolean;
  body: string;
  status: MessageStatus;
  sentAt: string;
}

/** 401 sends the user to sign in; any other error is shown as a toast. */
function reportApiError(err: unknown, onUnauthorized: () => void): void {
  if (err instanceof ApiError && err.status === 401) {
    onUnauthorized();
    return;
  }
  toast.error(err instanceof Error ? err.message : "Something went wrong.");
}

const STATUS_BADGE: Record<MessageStatus, string> = {
  QUEUED: "bg-amber-tint text-amber",
  SENT: "bg-primary/10 text-primary",
  DELIVERED: "bg-emerald-tint text-emerald",
  FAILED: "bg-coral-tint text-coral",
};

const TONE_LABEL: Record<string, string> = {
  GENTLE: "Gentle",
  WARM: "Warm",
  FIRM: "Firm",
};

const CHANNEL_LABEL: Record<string, string> = {
  WHATSAPP: "WhatsApp",
  SMS: "SMS",
  EMAIL: "Email",
};

function previewOf(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH).trimEnd()}…` : flat;
}

export default function MessagesPage() {
  const router = useRouter();
  const [messages, setMessages] = useState<ApiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const sorted = useMemo(
    () => [...messages].sort((a, b) => (a.sentAt < b.sentAt ? 1 : a.sentAt > b.sentAt ? -1 : 0)),
    [messages],
  );

  // silent = background refresh: no loading state and no error toast (401 still redirects).
  const loadMessages = useCallback(
    async (silent = false) => {
      try {
        setMessages(await apiFetch<ApiMessage[]>("/api/messages"));
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
        setMessages(await apiFetch<ApiMessage[]>("/api/messages"));
      } catch (err) {
        reportApiError(err, () => router.replace("/login"));
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  useAutoRefresh(() => loadMessages(true), 4000);

  if (loading) {
    return (
      <section className="space-y-6">
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
        </header>
        <div className="h-64 rounded-xl border border-border bg-card" />
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-slate-900">Messages</h1>
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          + New Message
        </button>
      </header>

      {sorted.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <p className="text-sm font-medium text-slate-900">No messages yet</p>
          <p className="mt-1 text-sm text-slate-600">
            Reminders you send to customers will appear here with their delivery status.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Customer</th>
                <th className="px-4 py-3 font-medium">Channel</th>
                <th className="px-4 py-3 font-medium">Tone</th>
                <th className="px-4 py-3 font-medium">Partial split</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Sent</th>
                <th className="px-4 py-3 font-medium">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sorted.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-3 font-medium text-slate-900">{m.customerName}</td>
                  <td className="px-4 py-3 text-slate-700">{CHANNEL_LABEL[m.channel] ?? m.channel}</td>
                  <td className="px-4 py-3 text-slate-700">{TONE_LABEL[m.tone] ?? m.tone}</td>
                  <td className="px-4 py-3 text-slate-700">{m.includedPartialOption ? "Yes" : "No"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_BADGE[m.status]}`}
                    >
                      {m.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-700">{formatDateShort(m.sentAt.slice(0, 10))}</td>
                  <td className="max-w-xs px-4 py-3 text-slate-600">
                    <span title={m.body} className="block truncate">
                      {previewOf(m.body)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ReminderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onChanged={loadMessages}
      />
    </section>
  );
}
