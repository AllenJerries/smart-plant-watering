"use client";

import { Activity } from "lucide-react";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateTime } from "@/lib/format";
import { DRY_THRESHOLD, OVERWATERED_THRESHOLD } from "@/lib/status";
import type { SensorReading } from "@/lib/types";

interface MoistureChartProps {
  readings: SensorReading[];
}

interface ChartPoint {
  timestamp: number;
  moisture: number;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
});

function formatTick(value: number | string): string {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp)) return "";
  return timeFormatter.format(new Date(timestamp));
}

function ChartEmpty() {
  return (
    <div className="flex h-full flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-black/10 px-6 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-400/10 text-emerald-300">
        <Activity className="h-5 w-5" />
      </span>
      <p className="mt-4 text-sm font-medium text-white/70">
        No readings in the last 24 hours
      </p>
      <p className="mt-1 max-w-sm text-xs leading-5 text-white/35">
        Power on the ESP32 or send a test POST to{" "}
        <code className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[11px] text-emerald-200/80">
          /api/reading
        </code>
        . The first deep-sleep cycle will populate this chart.
      </p>
    </div>
  );
}

export default function MoistureChart({ readings }: MoistureChartProps) {
  const data = useMemo<ChartPoint[]>(
    () =>
      readings
        .map((reading) => ({
          timestamp: Date.parse(reading.created_at),
          moisture: Number(reading.moisture_pct),
        }))
        .filter(
          (point) =>
            Number.isFinite(point.timestamp) &&
            Number.isFinite(point.moisture),
        ),
    [readings],
  );

  if (data.length === 0) return <ChartEmpty />;

  return (
    <div
      className="h-full w-full"
      role="img"
      aria-label="24-hour soil moisture trend chart"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={data}
          margin={{ top: 12, right: 12, left: -18, bottom: 0 }}
        >
          <defs>
            <linearGradient id="moistureFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.42} />
              <stop offset="65%" stopColor="#34d399" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="rgba(255,255,255,0.055)"
            strokeDasharray="3 6"
            vertical={false}
          />

          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={formatTick}
            tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            minTickGap={44}
            tickMargin={12}
          />

          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(value: number | string) => `${Number(value)}%`}
            tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={50}
          />

          <Tooltip
            cursor={{
              stroke: "rgba(255,255,255,0.18)",
              strokeDasharray: "4 4",
            }}
            contentStyle={{
              background: "rgba(5, 16, 11, 0.94)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: "16px",
              boxShadow: "0 18px 50px rgba(0,0,0,0.45)",
              backdropFilter: "blur(16px)",
              padding: "12px 14px",
            }}
            labelStyle={{
              color: "rgba(255,255,255,0.45)",
              fontSize: 11,
              marginBottom: 6,
            }}
            itemStyle={{ color: "#6ee7b7", fontSize: 13, fontWeight: 600 }}
            formatter={(value) => [
              `${Number(value).toFixed(1)}%`,
              "Moisture",
            ]}
            labelFormatter={(label) =>
              formatDateTime(new Date(Number(label)).toISOString())
            }
          />

          <ReferenceLine
            y={DRY_THRESHOLD}
            stroke="#fbbf24"
            strokeDasharray="6 6"
            strokeOpacity={0.55}
            label={{
              value: `Dry ${DRY_THRESHOLD}%`,
              position: "insideTopRight",
              fill: "#fbbf24",
              fontSize: 10,
              opacity: 0.85,
            }}
          />

          <ReferenceLine
            y={OVERWATERED_THRESHOLD}
            stroke="#38bdf8"
            strokeDasharray="6 6"
            strokeOpacity={0.5}
            label={{
              value: `Wet ${OVERWATERED_THRESHOLD}%`,
              position: "insideBottomRight",
              fill: "#38bdf8",
              fontSize: 10,
              opacity: 0.85,
            }}
          />

          <Area
            type="monotone"
            dataKey="moisture"
            stroke="#34d399"
            strokeWidth={2.5}
            fill="url(#moistureFill)"
            dot={false}
            activeDot={{
              r: 5,
              fill: "#6ee7b7",
              stroke: "#04100b",
              strokeWidth: 3,
            }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
