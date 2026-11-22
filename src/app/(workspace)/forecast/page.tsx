"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ComponentProps, FormEvent, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ApiError, apiFetch } from "../../../lib/api";
import { formatDateShort, formatINR } from "../../../lib/format";
import { useAutoRefresh } from "../../../lib/useAutoRefresh";
import { CashForecastChart } from "../../../components/charts/CashForecastChart";

const HORIZON_OPTIONS = [30, 60, 90] as const;
type Horizon = (typeof HORIZON_OPTIONS)[number];
const HORIZON_LABEL: Record<Horizon, string> = { 30: "30 Days", 60: "60 Days", 90: "90 Days" };

const MAX_DELAY_DAYS = 30;
const TOP_CUSTOMER_COUNT = 5;
const BAD_DAY_COUNT = 5;
const BAD_DAY_DELAY_DAYS = 15;
const MAX_SHOCK_OFFSET = 90;
const CHASE_LIMIT = 3;
const DEFER_LIMIT = 2;

// Shapes returned by the Python server (server/main.py, server/engine.py).
interface ServerFlow {
  label: string;
  amount: number;
  ref: string;
}

interface ServerDay {
  date: string;
  inflow: number;
  outflow: number;
  balance: number;
  inflows: ServerFlow[];
  outflows: ServerFlow[];
}

interface CrunchSummary {
  first_crunch_date: string | null;
  lowest_balance: number;
  lowest_balance_date: string | null;
  shortfall: number;
  cash_safe_until: string | null;
  days_below_zero: number;
  ending_balance: number;
  cash_received_in_horizon: number;
  received_after_horizon: number;
}

// Stored as-is by the server; the shock dict uses snake_case day_offset.
interface ExpenseShockBody {
  title: string;
  amount: number;
  day_offset: number;
}

interface ScenarioBody {
  horizonDays: number;
  invoiceDelayOverrides: Record<string, number>;
  globalLateDaysShift: number;
  extraExpenseShock: ExpenseShockBody | null;
  includeMovingAvgRisk: boolean;
}

interface ForecastResponse {
  horizon: number;
  baseline: ServerDay[];
  simulated: ServerDay[];
  crunch: { baseline: CrunchSummary; simulated: CrunchSummary };
  scenario: ScenarioBody;
}

interface InvoiceJson {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  balance: number;
}

interface BillJson {
  id: string;
  title: string;
  isPaid: boolean;
  isDeferrable: boolean;
}

// Chart prop types, derived from the chart component so this page does not import the finance engine.
type ChartDay = ComponentProps<typeof CashForecastChart>["baseline"][number];
type ChartFlow = ChartDay["inflows"][number];

// Expense form output, mapped to ExpenseShockBody on save.
interface ShockDraft {
  title: string;
  amount: number;
  dayOffset: number;
}

interface TopCustomer {
  customerId: string;
  customerName: string;
  invoiceId: string;
  invoiceNumber: string;
  invoiceBalance: number;
  totalOutstanding: number;
}

function toChartFlowIn(f: ServerFlow): ChartFlow {
  return { kind: "INVOICE", refId: f.ref, label: f.label, amount: f.amount };
}

function toChartFlowOut(f: ServerFlow): ChartFlow {
  return { kind: f.ref === "shock" ? "SHOCK" : "BILL", refId: f.ref, label: f.label, amount: f.amount };
}

function toChartDay(day: ServerDay): ChartDay {
  return {
    date: day.date,
    inflow: day.inflow,
    outflow: day.outflow,
    balance: day.balance,
    inflows: day.inflows.map(toChartFlowIn),
    outflows: day.outflows.map(toChartFlowOut),
  };
}

// Open invoices (balance above zero), largest balance first.
function openByBalance(list: InvoiceJson[]): InvoiceJson[] {
  return list.filter((inv) => inv.balance > 0).sort((a, b) => b.balance - a.balance);
}

// Signed rupee difference: leading "+" for positive values; formatINR supplies the minus sign for negatives.
function signedINR(n: number): string {
  return n > 0 ? `+${formatINR(n)}` : formatINR(n);
}

// Server ISO date or null (no crunch in horizon).
function dateOrNone(iso: string | null): string {
  return iso ? formatDateShort(iso) : "None in horizon";
}


function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-border/80 bg-card p-5 sm:p-6 shadow-xs hover:shadow-md transition-all duration-200">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      <div className="mt-3.5">{children}</div>
    </section>
  );
}

function ExpenseShockForm({ onSave }: { onSave: (shock: ShockDraft) => void }) {
  const [title, setTitle] = useState("");
  const [amount, setAmount] = useState("");
  const [dayOffset, setDayOffset] = useState("");
  const [errors, setErrors] = useState<{ title?: string; amount?: string; dayOffset?: string }>({});

  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const cleanTitle = title.trim();
    const amountNum = Number(amount);
    const offsetNum = Number(dayOffset);
    const next: { title?: string; amount?: string; dayOffset?: string } = {};
    if (!cleanTitle) next.title = "Enter a title for the expense.";
    if (amount.trim() === "" || !Number.isFinite(amountNum) || amountNum <= 0) {
      next.amount = "Enter an amount greater than zero.";
    }
    if (
      dayOffset.trim() === "" ||
      !Number.isInteger(offsetNum) ||
      offsetNum < 0 ||
      offsetNum > MAX_SHOCK_OFFSET
    ) {
      next.dayOffset = `Enter a whole day from 0 to ${MAX_SHOCK_OFFSET}.`;
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    onSave({ title: cleanTitle, amount: amountNum, dayOffset: offsetNum });
    setTitle("");
    setAmount("");
    setDayOffset("");
  };

  return (
    <form onSubmit={submit} noValidate className="grid gap-3 sm:grid-cols-3">
      <div>
        <label htmlFor="shock-title" className="block text-xs font-medium text-slate-600">
          Title
        </label>
        <input
          id="shock-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-invalid={errors.title ? true : undefined}
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-slate-900"
        />
        {errors.title && <p className="mt-1 text-xs text-coral">{errors.title}</p>}
      </div>
      <div>
        <label htmlFor="shock-amount" className="block text-xs font-medium text-slate-600">
          Amount (₹)
        </label>
        <input
          id="shock-amount"
          type="number"
          min={0}
          step="any"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          aria-invalid={errors.amount ? true : undefined}
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm tabular-nums text-slate-900"
        />
        {errors.amount && <p className="mt-1 text-xs text-coral">{errors.amount}</p>}
      </div>
      <div>
        <label htmlFor="shock-offset" className="block text-xs font-medium text-slate-600">
          Day offset (0–{MAX_SHOCK_OFFSET})
        </label>
        <input
          id="shock-offset"
          type="number"
          min={0}
          max={MAX_SHOCK_OFFSET}
          step={1}
          inputMode="numeric"
          value={dayOffset}
          onChange={(e) => setDayOffset(e.target.value)}
          aria-invalid={errors.dayOffset ? true : undefined}
          className="mt-1 w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm tabular-nums text-slate-900"
        />
        {errors.dayOffset && <p className="mt-1 text-xs text-coral">{errors.dayOffset}</p>}
      </div>
      <div className="sm:col-span-3">
        <button
          type="submit"
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          Add Unexpected Expense Shock
        </button>
      </div>
    </form>
  );
}

// Hydration guard: false on the server and during hydration, true on the client afterwards.
const subscribeNoop = () => () => {};
const getMountedClient = () => true;
const getMountedServer = () => false;

export default function ForecastPage() {
  const router = useRouter();
  const mounted = useSyncExternalStore(subscribeNoop, getMountedClient, getMountedServer);
  const [horizon, setHorizon] = useState<Horizon>(90);
  const [version, setVersion] = useState(0);
  const [forecast, setForecast] = useState<ForecastResponse | null>(null);
  const [scenario, setScenario] = useState<ScenarioBody | null>(null);
  const [invoices, setInvoices] = useState<InvoiceJson[]>([]);
  const [bills, setBills] = useState<BillJson[]>([]);


  const handleError = useCallback(
    (err: unknown) => {
      if (err instanceof ApiError && err.status === 401) {
        router.replace("/login");
        return;
      }
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    },
    [router],
  );

  // Latest request wins: responses from superseded requests are ignored.
  const requestSeq = useRef(0);

  // Loads the forecast for the current horizon, plus the invoices and bills used by the checklist.
  // silent: background refresh. Transient errors stay quiet; a 401 still redirects to login.
  const load = useCallback(
    (silent = false) => {
      const seq = ++requestSeq.current;
      Promise.all([
        apiFetch<ForecastResponse>(`/api/forecast?horizon=${horizon}`),
        apiFetch<InvoiceJson[]>("/api/invoices"),
        apiFetch<BillJson[]>("/api/bills"),
      ])
        .then(([data, invoiceList, billList]) => {
          if (seq !== requestSeq.current) return;
          setForecast(data);
          setScenario(data.scenario);
          setInvoices(invoiceList);
          setBills(billList);
        })
        .catch((err: unknown) => {
          if (seq !== requestSeq.current) return;
          if (silent && !(err instanceof ApiError && err.status === 401)) return;
          handleError(err);
        });
    },
    [horizon, handleError],
  );

  useEffect(() => {
    load();
    const tracker = requestSeq;
    return () => {
      tracker.current++;
    };
  }, [load, version]);

  useAutoRefresh(() => load(true), 4000);

  // Builds the full scenario body from current state, saves it, then refetches the forecast.
  const saveScenario = async (patch: Partial<ScenarioBody>, nextHorizon: Horizon = horizon): Promise<boolean> => {
    if (!scenario) return false;
    const body: ScenarioBody = { ...scenario, horizonDays: nextHorizon, ...patch };
    try {
      await apiFetch<ScenarioBody>("/api/forecast/scenario", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setScenario(body);
      setHorizon(nextHorizon);
      setVersion((v) => v + 1);
      return true;
    } catch (err) {
      handleError(err);
      return false;
    }
  };

  const chartDays = useMemo(
    () =>
      forecast
        ? {
            baseline: forecast.baseline.map(toChartDay),
            simulated: forecast.simulated.map(toChartDay),
          }
        : null,
    [forecast],
  );

  // Top customers by total outstanding; each row uses that customer's largest open invoice.
  const topCustomers = useMemo<TopCustomer[]>(() => {
    const byCustomer = new Map<string, TopCustomer>();
    for (const inv of openByBalance(invoices)) {
      const existing = byCustomer.get(inv.customerId);
      if (existing) {
        existing.totalOutstanding += inv.balance;
      } else {
        byCustomer.set(inv.customerId, {
          customerId: inv.customerId,
          customerName: inv.customerName,
          invoiceId: inv.id,
          invoiceNumber: inv.invoiceNumber,
          invoiceBalance: inv.balance,
          totalOutstanding: inv.balance,
        });
      }
    }
    return [...byCustomer.values()]
      .sort((a, b) => b.totalOutstanding - a.totalOutstanding)
      .slice(0, TOP_CUSTOMER_COUNT);
  }, [invoices]);

  const recoveryChecklist = useMemo(() => {
    const items: string[] = [];
    for (const inv of openByBalance(invoices).slice(0, CHASE_LIMIT)) {
      items.push(`Chase ${inv.customerName} ${inv.invoiceNumber} (${formatINR(inv.balance)})`);
    }
    const deferrable = bills.filter((b) => b.isDeferrable && !b.isPaid).slice(0, DEFER_LIMIT);
    for (const bill of deferrable) {
      items.push(`Defer ${bill.title} to protect cash`);
    }
    return items;
  }, [invoices, bills]);

  // Server data is fetched on the client only; show the placeholder until it arrives.
  if (!mounted || !forecast || !scenario || !chartDays) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">Forecast &amp; What-If</h1>
        </header>
        <div className="h-64 rounded-xl border border-border bg-card shadow-sm" />
      </div>
    );
  }

  const crunch = forecast.crunch.simulated;

  const setDelay = (invoiceId: string, days: number) => {
    const overrides = { ...scenario.invoiceDelayOverrides };
    if (days === 0) {
      delete overrides[invoiceId];
    } else {
      overrides[invoiceId] = days;
    }
    void saveScenario({ invoiceDelayOverrides: overrides });
  };

  const simulateBadDay = async () => {
    let list: InvoiceJson[];
    try {
      list = await apiFetch<InvoiceJson[]>("/api/invoices");
    } catch (err) {
      handleError(err);
      return;
    }
    const overrides = { ...scenario.invoiceDelayOverrides };
    for (const inv of openByBalance(list).slice(0, BAD_DAY_COUNT)) {
      overrides[inv.id] = BAD_DAY_DELAY_DAYS;
    }
    const ok = await saveScenario({ invoiceDelayOverrides: overrides, globalLateDaysShift: 0 });
    if (ok) {
      toast.success(`Bad day simulated: top ${BAD_DAY_COUNT} invoices ${BAD_DAY_DELAY_DAYS} days late`);
    }
  };

  const resetScenario = async () => {
    const ok = await saveScenario({
      invoiceDelayOverrides: {},
      globalLateDaysShift: 0,
      extraExpenseShock: null,
    });
    if (ok) toast.success("Scenario reset");
  };

  const saveShock = (draft: ShockDraft) => {
    void saveScenario({
      extraExpenseShock: { title: draft.title, amount: draft.amount, day_offset: draft.dayOffset },
    });
  };

  const shock = scenario.extraExpenseShock;
  // Date for the shock comes from the simulated projection day at that offset.
  const shockDate = shock ? (forecast.simulated[shock.day_offset]?.date ?? null) : null;

  const hasCrunch = crunch.first_crunch_date !== null;

  return (
    <div className="space-y-6">
      <header>
        <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-primary">
          <span>Telemetry & Simulation</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-primary">Forecast &amp; What-If Engine</h1>
        <p className="mt-1 text-sm text-slate-500">Test late patient payments and unexpected clinic shocks before they impact your cash flow.</p>
      </header>

      {/* Horizon */}
      <SectionCard title="Forecast horizon">
        <div role="group" aria-label="Forecast horizon" className="inline-flex rounded-lg border border-border bg-canvas p-1">
          {HORIZON_OPTIONS.map((h) => {
            const active = horizon === h;
            return (
              <button
                key={h}
                type="button"
                aria-pressed={active}
                onClick={() => void saveScenario({}, h)}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  active ? "bg-card text-primary shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {HORIZON_LABEL[h]}
              </button>
            );
          })}
        </div>
      </SectionCard>

      {/* Historical delay risk */}
      <SectionCard title="Client payment history">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-slate-900">Include client historical delay risk</p>
            <p className="mt-1 text-xs text-slate-500">
              Uses each client&apos;s average days late. Clients with fewer than 2 paid invoices show &quot;Limited history&quot;.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={scenario.includeMovingAvgRisk}
            aria-label="Include client historical delay risk"
            onClick={() => void saveScenario({ includeMovingAvgRisk: !scenario.includeMovingAvgRisk })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              scenario.includeMovingAvgRisk ? "bg-primary" : "bg-slate-300"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                scenario.includeMovingAvgRisk ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
      </SectionCard>

      {/* Delay sliders */}
      <SectionCard title="Payment delays">
        <div className="space-y-4">
          {topCustomers.length === 0 ? (
            <p className="text-sm text-slate-500">No unpaid invoices to adjust.</p>
          ) : (
            topCustomers.map((row) => {
              const name = row.customerName;
              const days = scenario.invoiceDelayOverrides[row.invoiceId] ?? 0;
              return (
                <div key={row.invoiceId}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-slate-900">
                      {name} <span className="text-slate-500">· {row.invoiceNumber}</span>
                    </span>
                    <span className="tabular-nums text-slate-700">
                      {days === 0 ? "On time" : `+${days} days`}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={MAX_DELAY_DAYS}
                    step={1}
                    value={days}
                    aria-label={`Extra days late for ${name} ${row.invoiceNumber}`}
                    onChange={(e) => setDelay(row.invoiceId, Number(e.target.value))}
                    className="mt-1 w-full accent-primary"
                  />
                </div>
              );
            })
          )}

          <div className="border-t border-border pt-4">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-900">Late days shift (all invoices)</span>
              <span className="tabular-nums text-slate-700">+{scenario.globalLateDaysShift} days</span>
            </div>
            <input
              type="range"
              min={0}
              max={MAX_DELAY_DAYS}
              step={1}
              value={scenario.globalLateDaysShift}
              aria-label="Late days shift for all invoices"
              onChange={(e) => void saveScenario({ globalLateDaysShift: Number(e.target.value) })}
              className="mt-1 w-full accent-primary"
            />
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              onClick={() => void simulateBadDay()}
              className="rounded-md bg-coral px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              Simulate Bad Day (5 Customers Late)
            </button>
            <button
              type="button"
              onClick={() => void resetScenario()}
              className="rounded-md border border-border bg-card px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-canvas"
            >
              Reset scenario
            </button>
          </div>
        </div>
      </SectionCard>

      {/* Expense shock */}
      <SectionCard title="Unexpected expense">
        <div className="space-y-4">
          {shock ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-coral/30 bg-coral-tint px-3 py-2 text-sm">
              <span className="text-coral">
                {shock.title} · <span className="tabular-nums">{formatINR(shock.amount)}</span> on{" "}
                {shockDate ? formatDateShort(shockDate) : `day ${shock.day_offset}`}
              </span>
              <button
                type="button"
                onClick={() => void saveScenario({ extraExpenseShock: null })}
                className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-slate-700 hover:bg-canvas"
              >
                Remove shock
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">No expense shock applied.</p>
          )}
          <ExpenseShockForm onSave={saveShock} />
        </div>
      </SectionCard>

      {/* Chart */}
      <SectionCard title="Projected cash balance">
        <CashForecastChart baseline={chartDays.baseline} simulated={chartDays.simulated} />
      </SectionCard>

      {/* Crunch summary */}
      <SectionCard title="Crunch summary">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs font-medium text-slate-500">
                <th scope="col" className="py-2 pr-4 font-medium">Metric</th>
                <th scope="col" className="py-2 pr-4 font-medium">Baseline</th>
                <th scope="col" className="py-2 pr-4 font-medium">What-if</th>
                <th scope="col" className="py-2 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="text-slate-900">
              <tr className="border-b border-border">
                <th scope="row" className="py-2 pr-4 font-medium text-slate-700">First Crunch Date</th>
                <td className="py-2 pr-4 tabular-nums">{dateOrNone(forecast.crunch.baseline.first_crunch_date)}</td>
                <td className="py-2 pr-4 tabular-nums">{dateOrNone(crunch.first_crunch_date)}</td>
                <td className="py-2 tabular-nums text-slate-700">
                  {forecast.crunch.baseline.first_crunch_date !== crunch.first_crunch_date ? "Moved" : "Unchanged"}
                </td>
              </tr>
              <tr className="border-b border-border">
                <th scope="row" className="py-2 pr-4 font-medium text-slate-700">Lowest Projected Balance</th>
                <td className="py-2 pr-4 tabular-nums">{formatINR(forecast.crunch.baseline.lowest_balance)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatINR(crunch.lowest_balance)}</td>
                <td className="py-2 tabular-nums text-slate-700">
                  {signedINR(crunch.lowest_balance - forecast.crunch.baseline.lowest_balance)}
                </td>
              </tr>
              <tr className="border-b border-border">
                <th scope="row" className="py-2 pr-4 font-medium text-slate-700">Cash Gap to Cover</th>
                <td className="py-2 pr-4 tabular-nums text-coral">{formatINR(forecast.crunch.baseline.shortfall)}</td>
                <td className="py-2 pr-4 tabular-nums text-coral">{formatINR(crunch.shortfall)}</td>
                <td className="py-2 tabular-nums text-slate-700">
                  {signedINR(crunch.shortfall - forecast.crunch.baseline.shortfall)}
                </td>
              </tr>
              <tr className="border-b border-border">
                <th scope="row" className="py-2 pr-4 font-medium text-slate-700">Days Below Zero</th>
                <td className="py-2 pr-4 tabular-nums">{forecast.crunch.baseline.days_below_zero}</td>
                <td className="py-2 pr-4 tabular-nums">{crunch.days_below_zero}</td>
                <td className="py-2 tabular-nums text-slate-700">
                  {crunch.days_below_zero - forecast.crunch.baseline.days_below_zero === 0
                    ? "No change"
                    : `${crunch.days_below_zero - forecast.crunch.baseline.days_below_zero > 0 ? "+" : ""}${crunch.days_below_zero - forecast.crunch.baseline.days_below_zero} days`}
                </td>
              </tr>
              <tr className="border-b border-border">
                <th scope="row" className="py-2 pr-4 font-medium text-slate-700">Ending Balance (Horizon End)</th>
                <td className="py-2 pr-4 tabular-nums">{formatINR(forecast.crunch.baseline.ending_balance)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatINR(crunch.ending_balance)}</td>
                <td className="py-2 tabular-nums text-slate-700">
                  {signedINR(crunch.ending_balance - forecast.crunch.baseline.ending_balance)}
                </td>
              </tr>
              <tr className={crunch.received_after_horizon !== 0 ? "border-b border-border" : undefined}>
                <th scope="row" className="py-2 pr-4 font-medium text-slate-700">Cash Received in Horizon</th>
                <td className="py-2 pr-4 tabular-nums">{formatINR(forecast.crunch.baseline.cash_received_in_horizon)}</td>
                <td className="py-2 pr-4 tabular-nums">{formatINR(crunch.cash_received_in_horizon)}</td>
                <td className="py-2 tabular-nums text-slate-700">
                  {signedINR(crunch.cash_received_in_horizon - forecast.crunch.baseline.cash_received_in_horizon)}
                </td>
              </tr>
              {crunch.received_after_horizon !== 0 && (
                <tr>
                  <th scope="row" className="py-2 pr-4 font-medium text-slate-700">Pushed past horizon</th>
                  <td className="py-2 pr-4 tabular-nums text-slate-400">—</td>
                  <td className="py-2 pr-4 tabular-nums">{formatINR(crunch.received_after_horizon)}</td>
                  <td className="py-2 tabular-nums text-slate-400">—</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Delays and shifts move when money arrives; the lowest point is usually at the end of the horizon, so a late
          receipt can leave the lowest balance unchanged. Check the chart for the day-by-day gap.
        </p>

        <div className="mt-5 border-t border-border pt-4">
          <h3 className="text-sm font-medium text-slate-700">Suggested Recovery Checklist</h3>
          {!hasCrunch ? (
            <p className="mt-2 text-sm text-slate-500">No action needed in this horizon</p>
          ) : recoveryChecklist.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">No open invoices or deferrable bills to act on.</p>
          ) : (
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-700">
              {recoveryChecklist.map((item) => (
                <li key={item} className="tabular-nums">
                  {item}
                </li>
              ))}
            </ul>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
