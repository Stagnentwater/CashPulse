"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AgingBucket, AgingKey } from "../../lib/financeEngine";
import { formatINR } from "../../lib/format";

const EMERALD = "#0F9D58";
const AMBER = "#F29900";
const CORAL = "#D93025";

const SHORT_LABEL: Record<AgingKey, string> = {
  UPCOMING: "Upcoming",
  D1_7: "1-7d",
  D8_15: "8-15d",
  D16_PLUS: "15+d",
};

const BAR_COLOR: Record<AgingKey, string> = {
  UPCOMING: EMERALD,
  D1_7: AMBER,
  D8_15: CORAL,
  D16_PLUS: CORAL,
};

interface AgingRow {
  key: AgingKey;
  label: string;
  total: number;
  count: number;
}

interface AgingTooltipProps {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: AgingRow }>;
}

function AgingTooltip({ active, payload }: AgingTooltipProps) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs shadow-md">
      <p className="font-semibold text-slate-900">{row.label}</p>
      <p className="mt-1 tabular-nums text-slate-700">
        Total: <span className="font-semibold">{formatINR(row.total)}</span>
      </p>
      <p className="tabular-nums text-slate-500">
        {row.count} {row.count === 1 ? "invoice" : "invoices"}
      </p>
    </div>
  );
}

/** Unpaid invoices bucketed by how late they are, as horizontal bars. */
export function AgingBarChart({ buckets }: { buckets: AgingBucket[] }) {
  const rows: AgingRow[] = buckets.map((b) => ({
    key: b.key,
    label: SHORT_LABEL[b.key],
    total: b.total,
    count: b.count,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <XAxis
            type="number"
            tickFormatter={(v: number) => formatINR(v)}
            tick={{ fontSize: 12, fill: "#64748B" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={72}
            tick={{ fontSize: 12, fill: "#334155" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<AgingTooltip />} cursor={{ fill: "#F1F5F9" }} />
          <Bar dataKey="total" name="Total" radius={[0, 6, 6, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={BAR_COLOR[r.key]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
