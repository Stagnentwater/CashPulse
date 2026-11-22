"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MonthSummary } from "../../lib/financeEngine";
import { formatINR } from "../../lib/format";

const EMERALD = "#0F9D58";
const CORAL = "#D93025";

interface MonthRow {
  label: string;
  inflow: number;
  outflow: number;
}

/** Expected collections vs scheduled bills per calendar month, as grouped bars. */
export function InflowOutflowChart({ months }: { months: MonthSummary[] }) {
  const rows: MonthRow[] = months.map((m) => ({
    label: m.label,
    inflow: m.inflow,
    outflow: m.outflow,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
          <XAxis
            dataKey="label"
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
          <Tooltip
            formatter={(value) => formatINR(Number(value))}
            cursor={{ fill: "#F1F5F9" }}
            contentStyle={{ borderRadius: 8, borderColor: "#E2E8F0", fontSize: 12 }}
          />
          <Legend verticalAlign="top" height={28} iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="inflow" name="Expected collections" fill={EMERALD} radius={[4, 4, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="outflow" name="Scheduled bills" fill={CORAL} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
