"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Calendar,
  Clock,
  Pencil,
  Receipt,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { ApiError, apiFetch } from "../../../lib/api";
import { formatDateShort, formatINR } from "../../../lib/format";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";
import { CashForecastChart } from "../../../components/charts/CashForecastChart";
import { AgingBarChart } from "../../../components/charts/AgingBarChart";
import { InflowOutflowChart } from "../../../components/charts/InflowOutflowChart";
import { ReminderDrawer } from "../../../components/modals/ReminderDrawer";

const HORIZON_OPTIONS = [30, 60, 90] as const;
type Horizon = (typeof HORIZON_OPTIONS)[number];

// Local mirror of GET /api/dashboard (server/main.py). Keys match the server exactly.
type ServerFlow = { label: string; amount: number; ref: string };
type ServerProjectionDay = {
  date: string;
  inflow: number;
  outflow: number;
  balance: number;
  inflows: ServerFlow[];
  outflows: ServerFlow[];
};
type ServerAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  title: string;
  amount: number;
  body?: string | null;
  actionLabel?: string | null;
  customerId?: string | null;
  invoiceId?: string | null;
  billId?: string | null;
  isRecurringMonthly?: boolean;
};
type ServerAgingBucket = {
  id: "overdue" | "upcoming" | "d1_7" | "d8_15" | "d15_plus";
  label: string;
  total: number;
  count: number;
};
type ServerMonth = { month: string; inflow: number; outflow: number; net: number };
type DashboardResponse = {
  today: string;
  bankBalance: number;
  kpis: {
    owed: number;
    openCount: number;
    overdue: number;
    cashSafeUntil: string | null;
    firstCrunchDate: string | null;
    shortfall: number;
    lowestBalance: number;
  };
  alerts: ServerAlert[];
  charts: {
    projection: { horizon: number; baseline: ServerProjectionDay[]; simulated: ServerProjectionDay[] };
    aging: ServerAgingBucket[];
    monthly: ServerMonth[];
  };
};

// Chart-side shapes, kept local so this page does not import the browser finance engine.
type FlowKind = "INVOICE" | "BILL" | "SHOCK";
type FlowItem = { kind: FlowKind; refId: string; label: string; amount: number };
type ProjectionDay = {
  date: string;
  inflow: number;
  outflow: number;
  balance: number;
  inflows: FlowItem[];
  outflows: FlowItem[];
};
type AgingKey = "OVERDUE" | "UPCOMING" | "D1_7" | "D8_15" | "D16_PLUS";
type AgingBucket = { key: AgingKey; label: string; total: number; count: number; invoiceIds: string[] };
type MonthSummary = { month: string; label: string; inflow: number; outflow: number; net: number };

const AGING_KEY: Record<ServerAgingBucket["id"], AgingKey> = {
  overdue: "OVERDUE",
  upcoming: "OVERDUE",
  d1_7: "D1_7",
  d8_15: "D8_15",
  d15_plus: "D16_PLUS",
};

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toProjectionDays(days: ServerProjectionDay[]): ProjectionDay[] {
  return days.map((d) => ({
    date: d.date,
    inflow: d.inflow,
    outflow: d.outflow,
    balance: d.balance,
    inflows: d.inflows.map((f): FlowItem => ({ kind: "INVOICE", refId: f.ref, label: f.label, amount: f.amount })),
    outflows: d.outflows.map(
      (f): FlowItem => ({ kind: f.ref === "shock" ? "SHOCK" : "BILL", refId: f.ref, label: f.label, amount: f.amount }),
    ),
  }));
}

function toAgingBuckets(buckets: ServerAgingBucket[]): AgingBucket[] {
  // The server sends no invoice ids for aging; AgingBarChart reads only key, total and count.
  return buckets.map((b) => ({
    key: AGING_KEY[b.id],
    label: b.label,
    total: b.total,
    count: b.count,
    invoiceIds: [],
  }));
}

function monthLabel(key: string): string {
  return `${MONTHS_SHORT[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

function toMonthSummaries(months: ServerMonth[]): MonthSummary[] {
  return months.map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    inflow: m.inflow,
    outflow: m.outflow,
    net: m.net,
  }));
}

function ChartCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 sm:p-6 shadow-xs hover:shadow-md transition-all duration-200">
      <h2 className="text-xs font-sans font-medium uppercase tracking-[0.03em] text-muted">{title}</h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

type BannerTone = "coral" | "amber" | "neutral" | "emerald";

const BANNER_TONE: Record<BannerTone, string> = {
  coral: "border-coral/40 bg-coral-tint text-coral shadow-sm",
  amber: "border-amber/40 bg-amber-tint text-amber shadow-sm",
  neutral: "border-border bg-card text-heading shadow-sm",
  emerald: "border-emerald/40 bg-emerald-tint text-emerald shadow-sm",
};

function KpiCard({ label, icon: Icon, children }: { label: string; icon?: React.ElementType; children: ReactNode }) {
  return (
    <section className="group relative rounded-2xl border border-border bg-card p-5 shadow-xs hover:shadow-md hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-sans font-medium uppercase tracking-[0.03em] text-muted">{label}</p>
        {Icon && (
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary transition-colors group-hover:bg-primary/20">
            <Icon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="mt-2.5">{children}</div>
    </section>
  );
}

/** Click to edit opening cash. Commits on blur or Enter, cancels on Escape. */
function BankBalanceEditor({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);

  const open = () => {
    setDraft(String(value));
    cancelled.current = false;
    setEditing(true);
  };

  const finish = () => {
    setEditing(false);
    if (cancelled.current) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && n !== value) onCommit(n);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
    if (e.key === "Escape") {
      cancelled.current = true;
      e.currentTarget.blur();
    }
  };

  if (editing) {
    return (
      <input
        type="number"
        inputMode="decimal"
        step="1"
        aria-label="Cash in bank"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={finish}
        onKeyDown={onKeyDown}
        className="w-full rounded-md border border-primary bg-card px-2 py-1 text-2xl font-heading font-bold tabular-nums text-heading outline-none"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={open}
      title="Click to edit opening cash"
      className="group inline-flex items-center gap-2 text-2xl sm:text-3xl font-heading font-bold tabular-nums tracking-[-0.02em] text-heading hover:text-primary transition-colors"
    >
      <span>{formatINR(value)}</span>
      <Pencil className="h-3.5 w-3.5 opacity-0 text-muted group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// Hydration guard: false on the server and during hydration, true on the client afterwards.
// Render the loading shell until mounted so server prerender and first client paint match.
const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

export default function DashboardPage() {
  const router = useRouter();
  const mounted = useSyncExternalStore(subscribeNoop, getMountedClient, getMountedServer);
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);


  // Latest request wins: responses from superseded requests are ignored.
  const requestSeq = useRef(0);

  // silent: background refresh. Errors still show on the page but do not toast on every poll.
  const load = useCallback(
    (silent = false) => {
      const seq = ++requestSeq.current;
      apiFetch<DashboardResponse>(`/api/dashboard?horizon=${horizon}`)
        .then((res) => {
          if (seq !== requestSeq.current) return;
          setData(res);
          setError(null);
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return;
          if (err instanceof ApiError && err.status === 401) {
            router.replace("/login");
            return;
          }
          const message = err instanceof Error ? err.message : "Could not load the dashboard.";
          setError(message);
          if (!silent) toast.error(message);
        });
    },
    [horizon, router],
  );

  useEffect(() => {
    load();
    const tracker = requestSeq;
    return () => {
      tracker.current++;
    };
  }, [load, reloadKey]);

  useAutoRefresh(() => load(true), 4000);

  const commitBankBalance = async (amount: number) => {
    try {
      await apiFetch<{ bankBalance: number }>("/api/bank-balance", {
        method: "PUT",
        body: JSON.stringify({ amount }),
      });
      setReloadKey((k) => k + 1);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Could not update cash in bank.");
    }
  };

  const handleSettleBill = async (billId: string) => {
    try {
      const res = await apiFetch<{ message?: string }>(
        `/api/bills/${billId}/paid?deduct_from_bank=true`,
        { method: "POST" },
      );
      toast.success(res.message || "Bill settled and deducted from bank balance!");
      setReloadKey((k) => k + 1);
      window.dispatchEvent(new Event("cashpulse:refresh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to settle bill.");
    }
  };

  if (!mounted || !data) {
    return (
      <div className="space-y-6">
        <h1 className="font-heading text-2xl font-bold text-heading">Dashboard</h1>
        {error && <p className="text-sm text-coral">{error}</p>}
        <div className="h-64 rounded-2xl border border-border bg-card shadow-xs" />
      </div>
    );
  }

  const { bankBalance, kpis, alerts, charts } = data;
  const top = alerts[0];
  const tone: BannerTone = !top
    ? "emerald"
    : top.severity === "critical"
      ? "coral"
      : top.severity === "warning"
        ? "amber"
        : "neutral";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] font-sans font-medium uppercase tracking-[0.03em] text-primary">
            <span>Clinic Financial Telemetry</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-heading font-bold tracking-[-0.03em] text-heading">Financial Dashboard</h1>
        </div>
      </div>
      {error && <p className="text-sm font-sans text-coral">{error}</p>}

      {/* Priority Banner: Shortfall alert or all-clear runway */}
      <div
        role={top ? "alert" : "status"}
        className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border p-5 transition-all duration-200 ${BANNER_TONE[tone]}`}
      >
        {top ? (
          <>
            <div className="flex items-start sm:items-center gap-3.5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-coral/15 text-coral">
                <AlertTriangle className="h-5 w-5 animate-pulse" />
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-coral/20 px-2 py-0.5 text-[10px] font-mono font-medium uppercase tracking-[0.02em] text-coral">
                    Projected Shortfall
                  </span>
                  <span className="text-xs font-sans text-muted">• Telemetry Engine</span>
                </div>
                <p className="mt-0.5 text-base sm:text-lg font-heading font-semibold text-coral leading-snug">{top.title}</p>
                {top.body && <p className="mt-0.5 text-xs font-sans text-body leading-relaxed">{top.body}</p>}
              </div>
            </div>
            {top.billId ? (
              <button
                type="button"
                onClick={() => void handleSettleBill(top.billId!)}
                className="btn-primary shrink-0 rounded-xl px-4 py-2 text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer"
              >
                {top.actionLabel || "Settle from Bank →"}
              </button>
            ) : top.customerId && top.invoiceId ? (
              <button
                type="button"
                onClick={() => setDrawerOpen(true)}
                className="shrink-0 rounded-xl bg-coral px-4 py-2 text-xs font-sans font-medium text-white shadow-xs hover:opacity-90 transition-all active:scale-95"
              >
                {top.actionLabel || "Open reminder"}
              </button>
            ) : (
              <Link
                href="/forecast"
                className="btn-primary shrink-0 rounded-xl px-4 py-2 text-xs font-sans font-medium shadow-xs transition-all active:scale-95"
              >
                Review forecast →
              </Link>
            )}
          </>
        ) : (
          <div className="flex items-center gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald/15 text-emerald">
              <ShieldCheck className="h-6 w-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-emerald/20 px-2.5 py-0.5 text-[10px] font-mono font-medium uppercase tracking-[0.02em] text-emerald">
                  Runway Healthy
                </span>
                <span className="text-xs font-sans text-muted">• 90-Day Simulation</span>
              </div>
              <p className="mt-0.5 text-base sm:text-lg font-heading font-semibold text-emerald leading-snug">
                All clear for the next {horizon} days
              </p>
              {kpis.cashSafeUntil && (
                <p className="mt-0.5 text-xs font-sans text-body">
                  No shortfalls projected through {formatDateShort(kpis.cashSafeUntil)}. Safe minimum balance:{" "}
                  <span className="font-mono font-medium tabular-nums text-heading">{formatINR(kpis.lowestBalance)}</span>.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <ReminderDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        customerId={top?.customerId ?? undefined}
        invoiceId={top?.invoiceId ?? undefined}
      />

      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Cash in Bank" icon={Wallet}>
          <BankBalanceEditor value={bankBalance} onCommit={(n) => void commitBankBalance(n)} />
          <p className="mt-1 text-xs font-sans text-muted">Tap to edit opening cash</p>
        </KpiCard>

        <KpiCard label="Total Owed to Me" icon={Receipt}>
          <p className="text-2xl sm:text-3xl font-heading font-bold tabular-nums tracking-[-0.02em] text-heading">{formatINR(kpis.owed)}</p>
          <p className="mt-1 text-xs font-sans text-muted tabular-nums">
            {kpis.openCount} unpaid {kpis.openCount === 1 ? "invoice" : "invoices"}
          </p>
        </KpiCard>

        <KpiCard label="Overdue Receivables" icon={Clock}>
          <p
            className={`text-2xl sm:text-3xl font-heading font-bold tabular-nums tracking-[-0.02em] ${kpis.overdue > 0 ? "text-coral" : "text-heading"}`}
          >
            {formatINR(kpis.overdue)}
          </p>
          <p className="mt-1 text-xs font-sans text-muted">
            {kpis.overdue > 0 ? "Requires patient follow-up" : "Zero overdue receivables"}
          </p>
        </KpiCard>

        <KpiCard label="Cash Safe Until" icon={Calendar}>
          {kpis.firstCrunchDate === null ? (
            <div>
              <span className="inline-flex rounded-full bg-emerald-tint px-3 py-1 text-xs font-sans font-medium text-emerald">
                {horizon}+ Days Safe
              </span>
              {kpis.cashSafeUntil && (
                <p className="mt-1.5 text-xs font-sans text-muted tabular-nums">
                  Through {formatDateShort(kpis.cashSafeUntil)}
                </p>
              )}
            </div>
          ) : kpis.cashSafeUntil === null ? (
            <div>
              <p className="text-2xl sm:text-3xl font-heading font-bold text-coral">Short today</p>
              <p className="mt-1 text-xs font-sans text-coral">Immediate action required</p>
            </div>
          ) : (
            <>
              <p className="text-2xl sm:text-3xl font-heading font-bold tabular-nums text-heading">
                {formatDateShort(kpis.cashSafeUntil)}
              </p>
              <p className="mt-1 text-xs font-sans text-coral tabular-nums">
                Shortfall from {formatDateShort(kpis.firstCrunchDate)}
              </p>
            </>
          )}
        </KpiCard>
      </div>

      {/* Charts */}
      <ChartCard title="Cash flow">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="inline-flex rounded-lg border border-border bg-canvas p-1" role="group" aria-label="Forecast horizon">
            {HORIZON_OPTIONS.map((days) => (
              <button
                key={days}
                type="button"
                aria-pressed={horizon === days}
                onClick={() => setHorizon(days)}
                className={`rounded-lg px-3 py-1 text-sm font-semibold tabular-nums font-mono transition-all ${
                  horizon === days ? "bg-primary text-[var(--btn-primary-text)] shadow-xs" : "text-muted hover:text-heading"
                }`}
              >
                {days}d
              </button>
            ))}
          </div>
        </div>
        <CashForecastChart
          baseline={toProjectionDays(charts.projection.baseline)}
          simulated={toProjectionDays(charts.projection.simulated)}
        />
      </ChartCard>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartCard title="Receivables aging">
          <AgingBarChart buckets={toAgingBuckets(charts.aging)} />
        </ChartCard>

        <ChartCard title="Inflows vs outflows">
          <InflowOutflowChart months={toMonthSummaries(charts.monthly)} />
        </ChartCard>
      </div>
    </div>
  );
}
