"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Palette,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  Sparkles,
} from "lucide-react";
import { aiApi, ApiError } from "@/lib/api";
import { formatINR } from "@/lib/format";
import { useAutoRefresh } from "@/lib/useAutoRefresh";
import type {
  AIPermissionPresetName,
  AiAuditEntry,
  AssistantPermissions,
  AssistantToolName,
  AuditStatus,
  PermissionMode,
} from "@/types/domain";

interface ToolMeta {
  key: AssistantToolName;
  label: string;
  description: string;
  isFinancial: boolean;
}

const TOOLS_META: ToolMeta[] = [
  {
    key: "create_invoice",
    label: "Create Invoices",
    description: "Generate patient billing records with UPI pay links",
    isFinancial: true,
  },
  {
    key: "record_payment",
    label: "Record Payments",
    description: "Apply full or partial patient payments to open invoices",
    isFinancial: true,
  },
  {
    key: "add_customer",
    label: "Add Customers",
    description: "Register new patient profiles into the clinic directory",
    isFinancial: false,
  },
  {
    key: "add_or_update_bill",
    label: "Add / Edit Bills",
    description: "Schedule clinic expenses, vendor bills, and rent",
    isFinancial: true,
  },
  {
    key: "defer_bill",
    label: "Defer Bills",
    description: "Postpone supplier bills by 7 to 60 days",
    isFinancial: true,
  },
  {
    key: "send_payment_reminder",
    label: "Send Payment Reminders",
    description: "Queue automated WhatsApp, SMS, or Email reminders",
    isFinancial: false,
  },
  {
    key: "run_what_if_simulation",
    label: "Run What-If Simulations",
    description: "Calculate forward cash projections and stress tests",
    isFinancial: false,
  },
  {
    key: "update_opening_cash",
    label: "Edit Opening Cash",
    description: "Alter baseline clinic bank balance in records",
    isFinancial: true,
  },
];

const PRESETS: Array<{
  id: AIPermissionPresetName;
  name: string;
  tagline: string;
  desc: string;
}> = [
  {
    id: "strict_accountant",
    name: "Strict Accountant",
    tagline: "Ask Everything",
    desc: "Requires explicit owner approval for every financial mutation and reminder.",
  },
  {
    id: "smart_copilot",
    name: "Smart Co-Pilot",
    tagline: "Balanced (Recommended)",
    desc: "Auto-adds customers and runs simulations; asks approval for invoices, bills, and payments.",
  },
  {
    id: "full_autopilot",
    name: "Full Autopilot",
    tagline: "Trusted Execution",
    desc: "Auto-executes routine actions under the financial cap; reminders still ask approval.",
  },
];

const AUDIT_STATUS_BADGE: Record<AuditStatus, { label: string; className: string }> = {
  AUTO_EXECUTED: { label: "Auto-Executed", className: "bg-emerald-tint text-emerald" },
  APPROVED: { label: "Approved", className: "bg-emerald-tint text-emerald" },
  PENDING: { label: "Pending", className: "bg-amber-tint text-amber" },
  REJECTED: { label: "Rejected", className: "bg-card-elevated text-muted border border-border" },
  DENIED: { label: "Blocked", className: "bg-coral-tint text-coral" },
  UNDONE: { label: "Undone", className: "bg-card-elevated text-muted border border-border line-through" },
};

export default function AIPermissionsPage() {
  const router = useRouter();

  const [permissions, setPermissions] = useState<AssistantPermissions | null>(null);
  const [auditLog, setAuditLog] = useState<AiAuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);

  const loadData = useCallback(
    async (silent = false) => {
      try {
        const [perms, audit] = await Promise.all([aiApi.getPermissions(), aiApi.getAuditLog()]);
        setPermissions(perms);
        setAuditLog(audit);
      } catch (err) {
        if (silent && !(err instanceof ApiError && err.status === 401)) return;
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        toast.error(err instanceof Error ? err.message : "Failed to load permissions.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    void (async () => {
      try {
        const [perms, audit] = await Promise.all([aiApi.getPermissions(), aiApi.getAuditLog()]);
        setPermissions(perms);
        setAuditLog(audit);
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          router.replace("/login");
          return;
        }
        toast.error(err instanceof Error ? err.message : "Failed to load permissions.");
      } finally {
        setLoading(false);
      }
    })();
  }, [router]);

  // Silent live refresh every 4 seconds or on cashpulse:refresh
  useAutoRefresh(() => void loadData(true), 4000);

  const handleToggleGlobal = async (next: boolean) => {
    if (!permissions) return;
    const updated: AssistantPermissions = { ...permissions, globalEnabled: next };
    setPermissions(updated);
    setSaving(true);
    try {
      await aiApi.updatePermissions(updated);
      toast.success(next ? "AI dashboard mutations enabled" : "AI dashboard mutations paused");
      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update master setting.");
      void loadData(true);
    } finally {
      setSaving(false);
    }
  };

  const handleCapChange = async (cap: number) => {
    if (!permissions) return;
    const updated: AssistantPermissions = { ...permissions, maxAutoApproveAmountINR: cap };
    setPermissions(updated);
    setSaving(true);
    try {
      await aiApi.updatePermissions(updated);
      toast.success(`Auto-approve cap set to ${formatINR(cap)}`);
      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update cap.");
      void loadData(true);
    } finally {
      setSaving(false);
    }
  };

  const handleToolModeChange = async (tool: AssistantToolName, mode: PermissionMode) => {
    if (!permissions) return;
    const updated: AssistantPermissions = {
      ...permissions,
      toolPolicies: {
        ...permissions.toolPolicies,
        [tool]: mode,
      },
    };
    setPermissions(updated);
    setSaving(true);
    try {
      await aiApi.updatePermissions(updated);
      toast.success(`Updated policy for ${tool}`);
      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update tool policy.");
      void loadData(true);
    } finally {
      setSaving(false);
    }
  };

  const handleApplyPreset = async (presetId: AIPermissionPresetName) => {
    setSaving(true);
    try {
      const perms = await aiApi.applyPreset(presetId);
      setPermissions(perms);
      toast.success(`Applied ${presetId.replace("_", " ")} preset`);
      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply preset.");
    } finally {
      setSaving(false);
    }
  };

  const handleUndo = async (auditId: string) => {
    setUndoingId(auditId);
    try {
      await aiApi.undoAction(auditId);
      toast.success("Action undone. Database balance and state restored.");
      window.dispatchEvent(new Event("cashpulse:refresh"));
      void loadData(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(err.message);
      } else {
        toast.error(err instanceof Error ? err.message : "Failed to undo action.");
      }
    } finally {
      setUndoingId(null);
    }
  };

  if (loading || !permissions) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-sm text-muted">
        Loading AI permissions & audit trail…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Page Title */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-xl font-bold text-heading sm:text-2xl">AI Assistant Permissions</h1>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary font-heading">
              <ShieldCheck className="h-3.5 w-3.5" />
              Stage 2 Governed
            </span>
          </div>
          <p className="font-sans text-sm text-muted mt-1">
            Define autonomy boundaries for clinic operations. Financial mutations respect strict policy matrices and rupee caps.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadData(false)}
          className="inline-flex items-center gap-1.5 self-start rounded-xl border border-border bg-card px-3 py-1.5 text-xs font-medium text-body shadow-xs hover:bg-card-elevated transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5 text-muted" />
          Refresh Audit
        </button>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border">
        <Link
          href="/settings"
          className="flex items-center gap-1.5 border-b-2 border-transparent px-4 py-2.5 text-sm font-medium text-muted hover:border-border hover:text-heading transition-colors"
        >
          <Palette className="h-4 w-4" />
          Appearance & Themes
        </Link>
        <Link
          href="/settings/ai-permissions"
          className="flex items-center gap-1.5 border-b-2 border-primary px-4 py-2.5 text-sm font-semibold text-primary"
        >
          <ShieldCheck className="h-4 w-4" />
          AI Permissions & Governance
        </Link>
      </div>

      {/* Card 1: Master Controls & Auto-Approve Cap */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-xs">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          {/* Master Kill Switch */}
          <div className="flex-1 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-heading text-base font-bold text-heading">Master Autonomy Switch</h2>
                <p className="text-xs text-muted font-sans mt-0.5">
                  When paused, the AI is blocked from performing any live dashboard mutations.
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={permissions.globalEnabled}
                aria-label="Master Autonomy Switch"
                onClick={() => void handleToggleGlobal(!permissions.globalEnabled)}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 transition-colors duration-200 ease-in-out focus:outline-none ${
                  permissions.globalEnabled
                    ? "bg-primary border-primary"
                    : "bg-card-elevated border-border"
                }`}
              >
                <span
                  className={`inline-block h-5.5 w-5.5 transform rounded-full shadow-sm transition duration-200 ease-in-out ${
                    permissions.globalEnabled
                      ? "translate-x-5 bg-[var(--btn-primary-text)]"
                      : "translate-x-0.5 bg-muted/70"
                  }`}
                />
              </button>
            </div>

            {!permissions.globalEnabled && (
              <div className="flex items-center gap-2 rounded-xl bg-coral-tint p-3 text-xs text-coral">
                <ShieldAlert className="h-4 w-4 shrink-0" />
                <span>AI assistant mutations are paused globally. All proposed tool actions will be blocked.</span>
              </div>
            )}
          </div>

          {/* Divider */}
          <div className="hidden h-24 w-px bg-border lg:block" />

          {/* Auto-Approve Cap Slider */}
          <div className="flex-1 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Sliders className="h-4 w-4 text-primary" />
                <h2 className="font-heading text-base font-bold text-heading">Auto-Approve Financial Cap</h2>
              </div>
              <span className="tabular-nums font-mono text-base font-bold text-heading">
                {formatINR(permissions.maxAutoApproveAmountINR)}
              </span>
            </div>
            <p className="text-xs text-muted font-sans">
              Any financial action (invoice, payment, bill) exceeding this threshold automatically downgrades to{" "}
              <span className="font-semibold text-amber">Ask Approval</span>.
            </p>
            <div className="space-y-1 pt-2">
              <input
                type="range"
                min="0"
                max="25000"
                step="500"
                value={permissions.maxAutoApproveAmountINR}
                onChange={(e) => void handleCapChange(Number(e.target.value))}
                className="h-2 w-full cursor-pointer appearance-none rounded-none accent-primary"
              />
              <div className="flex justify-between text-[11px] font-mono text-muted">
                <span>₹0 (Ask all)</span>
                <span>₹10,000</span>
                <span>₹25,000 (Max)</span>
              </div>
            </div>
          </div>
        </div>

        {/* 1-Click Presets */}
        <div className="mt-6 border-t border-border pt-5">
          <div className="mb-3 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="font-heading text-xs font-bold uppercase tracking-wider text-muted">
              1-Click Governance Presets
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => void handleApplyPreset(preset.id)}
                disabled={saving}
                className="group flex flex-col items-start rounded-xl border border-border bg-card p-3.5 text-left transition-all hover:border-primary hover:bg-card-elevated"
              >
                <div className="flex w-full items-center justify-between">
                  <span className="font-heading text-sm font-bold text-heading group-hover:text-primary">
                    {preset.name}
                  </span>
                  <span className="rounded bg-card-elevated border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted">
                    {preset.tagline}
                  </span>
                </div>
                <p className="mt-1 font-sans text-xs text-muted leading-relaxed">{preset.desc}</p>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Card 2: Capability Permission Matrix */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-heading text-base font-bold text-heading">Tool Permissions Matrix</h2>
          <p className="font-sans text-xs text-muted mt-0.5">
            Configure how Pulse AI acts when invoking each capability. Financial actions are constrained by your ₹ cap.
          </p>
        </div>

        <div className="divide-y divide-border/60">
          {TOOLS_META.map((meta) => {
            const currentMode = permissions.toolPolicies[meta.key] ?? "ASK_APPROVAL";
            return (
              <div
                key={meta.key}
                className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between hover:bg-card-elevated transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-heading text-sm font-semibold text-heading">{meta.label}</span>
                    {meta.isFinancial && (
                      <span className="rounded bg-amber-tint px-1.5 py-0.5 text-[10px] font-semibold text-amber">
                        ₹ Financial
                      </span>
                    )}
                  </div>
                  <p className="font-sans text-xs text-muted truncate">{meta.description}</p>
                </div>

                {/* 3-State Toggle Pill */}
                <div className="flex shrink-0 items-center rounded-xl border border-border bg-card-elevated p-1 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => void handleToolModeChange(meta.key, "AUTO_ALLOW")}
                    className={`rounded-lg px-2.5 py-1 transition-all ${
                      currentMode === "AUTO_ALLOW"
                        ? "bg-card font-semibold text-emerald shadow-xs"
                        : "text-muted hover:text-heading"
                    }`}
                  >
                    Auto-Allow
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToolModeChange(meta.key, "ASK_APPROVAL")}
                    className={`rounded-lg px-2.5 py-1 transition-all ${
                      currentMode === "ASK_APPROVAL"
                        ? "bg-card font-semibold text-amber shadow-xs"
                        : "text-muted hover:text-heading"
                    }`}
                  >
                    Ask Approval
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleToolModeChange(meta.key, "DENY")}
                    className={`rounded-lg px-2.5 py-1 transition-all ${
                      currentMode === "DENY"
                        ? "bg-card font-semibold text-coral shadow-xs"
                        : "text-muted hover:text-heading"
                    }`}
                  >
                    Block
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Card 3: AI Activity Audit Trail */}
      <div className="rounded-2xl border border-border bg-card shadow-xs overflow-hidden">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="font-heading text-base font-bold text-heading">AI Activity Audit Trail</h2>
            <p className="font-sans text-xs text-muted mt-0.5">
              Immutable log of every action executed, pending, or rejected by Pulse AI with 1-click Undo.
            </p>
          </div>
          <span className="rounded-full bg-card-elevated border border-border px-2.5 py-0.5 text-xs font-mono font-medium text-muted">
            {auditLog.length} {auditLog.length === 1 ? "entry" : "entries"}
          </span>
        </div>

        {auditLog.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted font-sans">
            No AI assistant actions logged yet. Start by asking Pulse AI from the bottom right dock!
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border bg-card-elevated text-[11px] font-semibold uppercase tracking-wider text-muted font-sans">
                <tr>
                  <th className="px-5 py-3">Time</th>
                  <th className="px-5 py-3">Tool</th>
                  <th className="px-5 py-3">Summary</th>
                  <th className="px-5 py-3 text-right">Impact</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {auditLog.map((entry) => {
                  const badge = AUDIT_STATUS_BADGE[entry.status] ?? {
                    label: entry.status,
                    className: "bg-card-elevated text-muted",
                  };
                  const canUndo =
                    entry.undoable &&
                    (entry.status === "AUTO_EXECUTED" || entry.status === "APPROVED");

                  return (
                    <tr key={entry.id} className="hover:bg-card-elevated transition-colors">
                      <td className="whitespace-nowrap px-5 py-3 text-xs text-muted font-mono">
                        {entry.createdAt ? entry.createdAt.slice(11, 19) : "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs font-mono font-medium text-heading">
                        {entry.toolName}
                      </td>
                      <td className="px-5 py-3 text-xs text-heading font-medium">
                        {entry.humanSummary}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right text-xs tabular-nums font-mono font-semibold text-heading">
                        {entry.impactInr !== null && entry.impactInr !== undefined
                          ? formatINR(entry.impactInr)
                          : "—"}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {canUndo ? (
                          <button
                            type="button"
                            onClick={() => void handleUndo(entry.id)}
                            disabled={undoingId === entry.id}
                            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-xs font-medium text-body shadow-2xs hover:bg-card-elevated hover:text-coral transition-colors"
                          >
                            <RotateCcw className="h-3 w-3" />
                            {undoingId === entry.id ? "Undoing…" : "Undo"}
                          </button>
                        ) : entry.status === "UNDONE" ? (
                          <span className="text-[11px] text-muted">Rolled back</span>
                        ) : (
                          <span className="text-[11px] text-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
