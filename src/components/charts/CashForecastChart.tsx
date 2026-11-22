"use client";

import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { FlowItem, ProjectionDay } from "../../lib/financeEngine";
import { formatDateShort, formatINR } from "../../lib/format";

const BASELINE_COLOR = "#1A73E8";
const CORAL_COLOR = "#D93025";
const ZERO_LINE_COLOR = "#0F172A";
const TARGET_TICKS = 6;

interface ChartRow {
  date: string;
  label: string;
  baseline: number;
  simulated: number;
  belowZero: number;
  inflows: FlowItem[];
  outflows: FlowItem[];
}

interface CashTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ChartRow }>;
}

function CashTooltip({ active, payload }: CashTooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="min-w-[200px] rounded-lg border border-border bg-card p-3 text-xs shadow-md">
      <p className="font-semibold text-slate-900">{formatDateShort(row.date)}</p>
      <p className="mt-1 tabular-nums text-slate-700">
        Projected balance: <span className="font-semibold">{formatINR(row.baseline)}</span>
      </p>
      {row.simulated !== row.baseline && (
        <p className="tabular-nums text-coral">Simulated: {formatINR(row.simulated)}</p>
      )}

      <div className="mt-2 border-t border-border pt-2">
        <p className="font-medium text-emerald">Inflows</p>
        {row.inflows.length === 0 ? (
          <p className="text-slate-500">None expected</p>
        ) : (
          <ul className="mt-0.5 space-y-0.5 text-slate-700">
            {row.inflows.map((f) => (
              <li key={f.refId} className="tabular-nums">
                {f.label} · {formatINR(f.amount)}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-2 border-t border-border pt-2">
        <p className="font-medium text-coral">Bills</p>
        {row.outflows.length === 0 ? (
          <p className="text-slate-500">None due</p>
        ) : (
          <ul className="mt-0.5 space-y-0.5 text-slate-700">
            {row.outflows.map((f) => (
              <li key={f.refId} className="tabular-nums">
                {f.label} · {formatINR(f.amount)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** 30/60/90-day cash forecast: baseline (solid blue) vs what-if (dashed coral), with a red zone below ₹0. */
export function CashForecastChart({
  baseline,
  simulated,
}: {
  baseline: ProjectionDay[];
  simulated: ProjectionDay[];
}) {
  const rows: ChartRow[] = baseline.map((day, i) => {
    const sim = simulated[i]?.balance ?? day.balance;
    return {
      date: day.date,
      label: formatDateShort(day.date),
      baseline: day.balance,
      simulated: sim,
      belowZero: Math.min(day.balance, 0),
      inflows: day.inflows,
      outflows: day.outflows,
    };
  });

  const tickInterval = Math.max(0, Math.ceil(rows.length / TARGET_TICKS) - 1);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-4 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-4 rounded-full bg-primary" /> Baseline cash
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-4 border-t-2 border-dashed border-coral" /> What-if simulated
        </span>
      </div>

      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="label"
              interval={tickInterval}
              tick={{ fontSize: 12, fill: "#64748B" }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tickFormatter={(v: number) => formatINR(v)}
              tick={{ fontSize: 12, fill: "#64748B" }}
              tickLine={false}
              axisLine={false}
              width={96}
            />
            <Tooltip content={<CashTooltip />} />

            {/* Shaded red zone below zero */}
            <Area
              type="monotone"
              dataKey="belowZero"
              baseValue={0}
              stroke="none"
              fill={CORAL_COLOR}
              fillOpacity={0.15}
              isAnimationActive={false}
              legendType="none"
            />

            {/* Baseline: solid blue line with light fill */}
            <Area
              type="monotone"
              dataKey="baseline"
              name="Baseline cash"
              baseValue={0}
              stroke={BASELINE_COLOR}
              strokeWidth={2}
              fill={BASELINE_COLOR}
              fillOpacity={0.08}
              dot={false}
              isAnimationActive={false}
            />

            {/* What-if: dashed coral line */}
            <Line
              type="monotone"
              dataKey="simulated"
              name="What-if simulated"
              stroke={CORAL_COLOR}
              strokeWidth={2}
              strokeDasharray="6 4"
              dot={false}
              isAnimationActive={false}
            />

            {/* Bold zero line */}
            <ReferenceLine y={0} stroke={ZERO_LINE_COLOR} strokeWidth={2} ifOverflow="extendDomain" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
