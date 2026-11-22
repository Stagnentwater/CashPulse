"use client";

import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { AgingBucket, AgingKey } from "../../lib/financeEngine";
import { formatINR } from "../../lib/format";

const EMERALD = "var(--text-success, #1E7E58)";
const CORAL = "var(--text-error, #C83232)";
const MARINA_BLUE = "var(--accent, #326080)";
const SOFT_SKY = "var(--accent-soft, #B5D2E6)";

const SHORT_LABEL: Record<AgingKey, string> = {
  OVERDUE: "Overdue",
  UPCOMING: "Overdue",
  D1_7: "1-7d",
  D8_15: "8-15d",
  D16_PLUS: "15+d",
};

const BAR_COLOR: Record<AgingKey, string> = {
  OVERDUE: CORAL,
  UPCOMING: CORAL,
  D1_7: EMERALD,
  D8_15: MARINA_BLUE,
  D16_PLUS: SOFT_SKY,
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
  const isOverdue = row.key === "OVERDUE" || row.key === "UPCOMING";
  return (
    <div className="rounded-xl border border-border bg-card p-3 text-xs shadow-md">
      <p className={`font-heading font-semibold ${isOverdue ? "text-error" : "text-heading"}`}>
        {isOverdue ? "Overdue" : `${row.label} (Upcoming Horizon)`}
      </p>
      <p className="mt-1 tabular-nums font-mono text-body">
        Total: <span className="font-bold text-heading">{formatINR(row.total)}</span>
      </p>
      <p className="tabular-nums font-sans text-muted">
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
            tick={{ fontSize: 12, fill: "var(--text-muted, #64748B)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={72}
            tick={{ fontSize: 12, fill: "var(--text-heading, #102433)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<AgingTooltip />} cursor={{ fill: "var(--card-elevated, #F1F5F9)" }} />
          <Bar dataKey="total" name="Total" radius={[0, 0, 0, 0]} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={BAR_COLOR[r.key]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
