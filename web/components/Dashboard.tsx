"use client";

import dynamic from "next/dynamic";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  CloudOff,
  Cpu,
  Database,
  Droplets,
  Gauge,
  Info,
  Leaf,
  Radio,
  RefreshCw,
  Send,
  Server,
  ShieldCheck,
  Signal,
  Waves,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatRelativeTime } from "@/lib/format";
import type { Database as DatabaseSchema } from "@/lib/database.types";
import {
  DRY_THRESHOLD,
  OVERWATERED_THRESHOLD,
  RECOVERY_THRESHOLD,
  clamp,
  getPlantStatus,
  getSignalBars,
  getSignalLabel,
  isReadingOnline,
  isSensorFault,
} from "@/lib/status";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { deviceTopic } from "@/lib/realtime-topic";
import type {
  DashboardSnapshot,
  DeviceState,
  PlantStatus,
  SensorReading,
} from "@/lib/types";
import { SignalBars } from "./SignalBars";

const MoistureChart = dynamic(() => import("./MoistureChart"), {
  ssr: false,
  loading: () => <ChartSkeleton />,
});

const POLL_INTERVAL_MS = 1_000;
const MAX_LIVE_POINTS = 480;

type ReadingRow = DatabaseSchema["public"]["Tables"]["sensor_readings"]["Row"];
type StateRow = DatabaseSchema["public"]["Tables"]["device_state"]["Row"];

function mapReadingRow(row: ReadingRow): SensorReading {
  return {
    id: Number(row.id),
    device_id: row.device_id,
    moisture_pct: Number(row.moisture_pct),
    raw_value: Number(row.raw_value),
    rssi: row.rssi === null ? null : Number(row.rssi),
    created_at: row.created_at,
  };
}

function mapStateRow(row: StateRow): DeviceState {
  return {
    device_id: row.device_id,
    last_alert_type: row.last_alert_type,
    last_alert_at: row.last_alert_at,
    updated_at: row.updated_at,
  };
}

interface StatusMeta {
  label: string;
  color: string;
  soft: string;
  border: string;
  icon: LucideIcon;
  description: string;
}

const STATUS_META: Record<PlantStatus, StatusMeta> = {
  DRY: {
    label: "Dry",
    color: "#fbbf24",
    soft: "rgba(251, 191, 36, 0.11)",
    border: "rgba(251, 191, 36, 0.26)",
    icon: Droplets,
    description:
      "Moisture is below the comfort zone. Give the plant a drink soon.",
  },
  OPTIMAL: {
    label: "Optimal",
    color: "#34d399",
    soft: "rgba(52, 211, 153, 0.11)",
    border: "rgba(52, 211, 153, 0.26)",
    icon: Leaf,
    description:
      "Soil moisture is right in the sweet spot. No action needed.",
  },
  OVERWATERED: {
    label: "Overwatered",
    color: "#38bdf8",
    soft: "rgba(56, 189, 248, 0.11)",
    border: "rgba(56, 189, 248, 0.26)",
    icon: Waves,
    description:
      "The soil is holding a lot of water. Hold off watering and let it drain.",
  },
};

type BannerTone = "warning" | "danger" | "info" | "neutral";

interface Banner {
  tone: BannerTone;
  icon: LucideIcon;
  title: string;
  message: string;
}

const BANNER_TONE: Record<
  BannerTone,
  { wrapper: string; icon: string; title: string }
> = {
  warning: {
    wrapper: "border-amber-300/20 bg-amber-400/10",
    icon: "bg-amber-400/10 text-amber-300",
    title: "text-amber-100",
  },
  danger: {
    wrapper: "border-rose-300/20 bg-rose-400/10",
    icon: "bg-rose-400/10 text-rose-300",
    title: "text-rose-100",
  },
  info: {
    wrapper: "border-sky-300/20 bg-sky-400/10",
    icon: "bg-sky-400/10 text-sky-300",
    title: "text-sky-100",
  },
  neutral: {
    wrapper: "border-white/10 bg-white/[0.04]",
    icon: "bg-white/[0.06] text-white/60",
    title: "text-white/80",
  },
};

interface DashboardProps {
  initialData: DashboardSnapshot;
}

export function Dashboard({ initialData }: DashboardProps) {
  const [data, setData] = useState<DashboardSnapshot>(initialData);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const [now, setNow] = useState(() => {
    const fetchedAt = Date.parse(initialData.fetchedAt);
    return Number.isNaN(fetchedAt) ? Date.now() : fetchedAt;
  });
  const requestRef = useRef<AbortController | null>(null);

  const refresh = useCallback(
    async (options: { silent?: boolean } = {}) => {
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;

      if (!options.silent) setSyncing(true);

      try {
        const response = await fetch(
          `/api/dashboard?deviceId=${encodeURIComponent(initialData.deviceId)}`,
          { cache: "no-store", signal: controller.signal },
        );

        const payload = (await response.json().catch(() => null)) as
          | DashboardSnapshot
          | { error?: string }
          | null;

        if (
          payload &&
          typeof payload === "object" &&
          "deviceId" in payload
        ) {
          const snapshot = payload as DashboardSnapshot;
          setData(snapshot);
          setSyncError(
            !response.ok && snapshot.configured
              ? (snapshot.error ?? "Dashboard sync failed.")
              : null,
          );
          setNow(Date.now());
          return;
        }

        setSyncError(
          (payload as { error?: string } | null)?.error ??
            `Dashboard sync failed (${response.status}).`,
        );
      } catch (error) {
        if (controller.signal.aborted) return;
        setSyncError(
          error instanceof Error
            ? error.message
            : "Live sync interrupted.",
        );
      } finally {
        if (!controller.signal.aborted) setSyncing(false);
      }
    },
    [initialData.deviceId],
  );

  const applyReading = useCallback((reading: SensorReading) => {
    setData((previous) => {
      const alreadyPresent = previous.history.some(
        (item) => item.id === reading.id,
      );
      const history = alreadyPresent
        ? previous.history
        : [...previous.history, reading];

      return {
        ...previous,
        configured: true,
        latest: reading,
        history:
          history.length > MAX_LIVE_POINTS
            ? history.slice(-MAX_LIVE_POINTS)
            : history,
        fetchedAt: new Date().toISOString(),
        error: undefined,
      };
    });
    setNow(Date.now());
    setSyncError(null);
  }, []);

  const applyState = useCallback((state: DeviceState) => {
    setData((previous) => ({
      ...previous,
      state,
      fetchedAt: new Date().toISOString(),
    }));
  }, []);

  useEffect(() => {
    // Realtime is the primary update path. A one-second poll is kept as a
    // safety net for projects where the Realtime publication is not enabled.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refresh({ silent: true });
      }
    }, POLL_INTERVAL_MS);

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refresh({ silent: true });
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      requestRef.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let active = true;
    const topic = deviceTopic(initialData.deviceId);

    const channel = supabase
      .channel(topic)
      // Primary path: the ingest API broadcasts every accepted reading the
      // moment it is stored. Broadcast does not need the table to be in the
      // supabase_realtime publication, so this works out of the box.
      .on("broadcast", { event: "reading" }, ({ payload }) => {
        if (!active) return;

        const row = payload as ReadingRow | null;
        if (!row || typeof row.id !== "number" || !row.device_id) return;

        applyReading(mapReadingRow(row));
      })
      .on("broadcast", { event: "state" }, ({ payload }) => {
        if (!active) return;

        const row = payload as StateRow | null;
        if (!row?.device_id) return;

        applyState(mapStateRow(row));
      })
      // Secondary path: direct Postgres Changes once schema.sql has added both
      // tables to the supabase_realtime publication.
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "sensor_readings",
          filter: `device_id=eq.${initialData.deviceId}`,
        },
        (payload) => {
          if (!active) return;
          applyReading(mapReadingRow(payload.new as ReadingRow));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "device_state",
          filter: `device_id=eq.${initialData.deviceId}`,
        },
        (payload) => {
          if (!active) return;

          const row = payload.new as StateRow | null;
          if (!row?.device_id) return;

          applyState(mapStateRow(row));
        },
      )
      .subscribe((status) => {
        if (active) setRealtimeConnected(status === "SUBSCRIBED");
      });

    return () => {
      active = false;
      setRealtimeConnected(false);
      void supabase.removeChannel(channel);
    };
  }, [applyReading, applyState, initialData.deviceId]);

  const latest: SensorReading | null = data.latest;
  const moisture = latest ? Number(latest.moisture_pct) : null;
  const rawValue = latest ? Number(latest.raw_value) : null;
  const rssi = latest?.rssi ?? null;
  const status = getPlantStatus(moisture);
  const meta = status ? STATUS_META[status] : null;
  const accent = meta?.color ?? "#94a3b8";
  const bars = getSignalBars(rssi);
  const fault = rawValue !== null && isSensorFault(rawValue);
  const dry = moisture !== null && moisture < DRY_THRESHOLD;
  const overwatered =
    moisture !== null && moisture > OVERWATERED_THRESHOLD;
  const hasReading = Boolean(latest);
  const online = isReadingOnline(latest?.created_at, now);
  const relative = formatRelativeTime(latest?.created_at, now);
  const activeError = syncError ?? data.error ?? null;
  const rawPct =
    rawValue !== null ? clamp((rawValue / 4095) * 100, 0, 100) : 0;

  const stateLabel =
    data.state?.last_alert_type ??
    (fault ? "FAULT" : dry ? "DRY" : latest ? "NORMAL" : "—");
  const stateHint = data.state?.last_alert_at
    ? `Last alert ${formatRelativeTime(data.state.last_alert_at, now)}`
    : data.state
      ? "No alerts recorded"
      : "No state row yet";

  const connectionLabel = !data.configured
    ? "Setup"
    : !hasReading
      ? "Awaiting"
      : online
        ? "Online"
        : "Offline";
  const connectionHint = !data.configured
    ? "Add Supabase environment variables"
    : !hasReading
      ? "No packets received yet"
      : online
        ? "Heartbeat within 15 minutes"
        : "No packet for over 15 minutes";

  let banner: Banner | null = null;

  if (!data.configured) {
    banner = {
      tone: "neutral",
      icon: Database,
      title: "Connect Supabase",
      message:
        "Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_SERVICE_ROLE_KEY) to web/.env.local, then run web/schema.sql.",
    };
  } else if (activeError) {
    banner = {
      tone: "danger",
      icon: CloudOff,
      title: "Live sync interrupted",
      message: activeError,
    };
  } else if (latest && !online) {
    banner = {
      tone: "danger",
      icon: WifiOff,
      title: "Device offline",
      message: `No telemetry received for more than 15 minutes. Last packet ${relative}.`,
    };
  } else if (fault) {
    banner = {
      tone: "warning",
      icon: AlertTriangle,
      title: "Sensor fault detected",
      message:
        "The raw ADC value is outside the valid range. Check the probe wiring, power, and GPIO34 connection.",
    };
  } else if (dry) {
    banner = {
      tone: "warning",
      icon: Droplets,
      title: "Soil moisture is low",
      message: `At ${moisture?.toFixed(1) ?? "—"}%, this is below the ${DRY_THRESHOLD}% dry threshold. Water the plant soon.`,
    };
  } else if (overwatered) {
    banner = {
      tone: "info",
      icon: Info,
      title: "Soil is very wet",
      message: `At ${moisture?.toFixed(1) ?? "—"}%, this is above the ${OVERWATERED_THRESHOLD}% overwatered threshold. Hold off watering.`,
    };
  } else if (!latest) {
    banner = {
      tone: "neutral",
      icon: Radio,
      title: "Waiting for the first reading",
      message: `Power the ESP32 or POST a test reading for ${data.deviceId}. This dashboard updates automatically when a reading arrives.`,
    };
  }

  return (
    <div className="relative min-h-dvh overflow-x-hidden">
      <div className="aurora" aria-hidden="true" />

      <div className="relative z-10 mx-auto flex min-h-dvh w-full max-w-[90rem] flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <div className="glass grid h-12 w-12 place-items-center rounded-2xl">
              <Leaf className="h-6 w-6 text-emerald-300" />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-emerald-300/60">
                Smart Plant Watering
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
                Verdant <span className="text-gradient">OS</span>
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <span className="chip">
              <Cpu className="h-3.5 w-3.5" />
              {data.deviceId}
            </span>
            <span
              className="chip"
              title={
                realtimeConnected
                  ? "Supabase Realtime connected"
                  : "Waiting for Realtime; using fast fallback polling"
              }
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  realtimeConnected ? "status-dot" : "bg-white/30"
                }`}
              />
              {realtimeConnected ? "Live" : "Polling"}
            </span>
            <ConnectionPill
              configured={data.configured}
              hasReading={hasReading}
              online={online}
            />
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={syncing}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.05] px-4 py-2 text-xs font-medium text-white/70 transition hover:border-emerald-300/25 hover:bg-emerald-400/10 hover:text-emerald-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`}
              />
              {syncing ? "Syncing" : "Refresh"}
            </button>
          </div>
        </header>

        {banner ? <BannerView banner={banner} /> : null}

        <main className="grid flex-1 content-start gap-5 xl:grid-cols-12">
          {/* ---------------------------------------------------------------- */}
          {/* Hero moisture card                                               */}
          {/* ---------------------------------------------------------------- */}
          <article className="glass-card p-5 sm:p-7 lg:p-8 xl:col-span-7">
            <div
              className="pointer-events-none absolute -right-24 -top-28 h-72 w-72 rounded-full blur-3xl"
              style={{ background: `${accent}18` }}
            />
            <div
              className="pointer-events-none absolute -bottom-32 -left-24 h-64 w-64 rounded-full blur-3xl"
              style={{ background: `${accent}0d` }}
            />

            <div className="relative z-10 flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="eyebrow">
                  <Droplets className="h-3.5 w-3.5" />
                  Soil moisture
                </p>

                <div className="mt-5 flex items-end gap-2">
                  <span className="text-[4.5rem] font-semibold leading-none tracking-[-0.06em] text-white sm:text-8xl">
                    {moisture !== null ? moisture.toFixed(1) : "—"}
                  </span>
                  <span className="pb-2 text-2xl font-light text-white/35">
                    %
                  </span>
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2.5">
                  <StatusPill status={status} />
                  <span className="inline-flex items-center gap-1.5 text-xs text-white/40">
                    <Clock className="h-3.5 w-3.5" />
                    Updated {relative}
                  </span>
                </div>

                <p className="mt-5 max-w-md text-sm leading-6 text-white/50">
                  {meta?.description ??
                    "Waiting for the first reading. Once the ESP32 checks in, live metrics and the 24-hour trend will populate here."}
                </p>

                <div className="mt-6 flex flex-wrap gap-2">
                  <span className="chip">
                    <Leaf className="h-3.5 w-3.5" />
                    Comfort {DRY_THRESHOLD}–{OVERWATERED_THRESHOLD}%
                  </span>
                  <span className="chip">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    Recovers at {RECOVERY_THRESHOLD}%
                  </span>
                  <span className="chip">
                    <Clock className="h-3.5 w-3.5" />
                    5 min cadence
                  </span>
                </div>
              </div>

              <MoistureRing value={moisture} color={accent} />
            </div>

            <div className="relative z-10 mt-8 grid grid-cols-2 gap-4 border-t border-white/[0.07] pt-5 sm:grid-cols-3">
              <MiniStat
                label="Raw ADC"
                value={rawValue !== null ? String(rawValue) : "—"}
                hint="GPIO34 · 12-bit"
              />
              <MiniStat
                label="Wi-Fi"
                value={rssi !== null ? `${rssi} dBm` : "—"}
                hint={getSignalLabel(bars)}
              />
              <MiniStat
                label="Alert state"
                value={stateLabel}
                hint={stateHint}
              />
            </div>
          </article>

          {/* ---------------------------------------------------------------- */}
          {/* Metric cards                                                     */}
          {/* ---------------------------------------------------------------- */}
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:col-span-5">
            <MetricCard
              icon={Gauge}
              label="Raw ADC"
              value={rawValue !== null ? String(rawValue) : "—"}
              suffix="/ 4095"
              hint="Capacitive v1.2 · 10-sample average"
              accent={accent}
            >
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{ width: `${rawPct}%`, backgroundColor: accent }}
                />
              </div>
            </MetricCard>

            <MetricCard
              icon={Signal}
              label="Wi-Fi signal"
              value={rssi !== null ? String(rssi) : "—"}
              suffix={rssi !== null ? "dBm" : undefined}
              hint="RSSI reported by the ESP32"
              accent={bars >= 3 ? "#34d399" : bars === 2 ? "#fbbf24" : "#fb7185"}
            >
              <div className="mt-4 flex items-end justify-between gap-3">
                <SignalBars bars={bars} />
                <span className="text-[11px] font-medium text-white/40">
                  {getSignalLabel(bars)}
                </span>
              </div>
            </MetricCard>

            <MetricCard
              icon={meta?.icon ?? Leaf}
              label="Plant status"
              value={meta?.label ?? "—"}
              hint={`Dry <${DRY_THRESHOLD}% · Wet >${OVERWATERED_THRESHOLD}%`}
              accent={accent}
            >
              <div className="mt-4 flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: accent,
                    boxShadow: `0 0 0 4px ${accent}1a`,
                  }}
                />
                <span className="text-[11px] text-white/40">
                  {status
                    ? "Live classification"
                    : "Awaiting a valid reading"}
                </span>
              </div>
            </MetricCard>

            <MetricCard
              icon={online ? Wifi : WifiOff}
              label="Connection"
              value={connectionLabel}
              hint={connectionHint}
              accent={
                !data.configured
                  ? "#94a3b8"
                  : online
                    ? "#34d399"
                    : "#fb7185"
              }
            >
              <div className="mt-4 flex items-center gap-2">
                <span
                  className={`h-2 w-2 rounded-full ${
                    online ? "status-dot" : ""
                  }`}
                  style={
                    online
                      ? undefined
                      : {
                          backgroundColor: data.configured
                            ? "#fb7185"
                            : "#94a3b8",
                        }
                  }
                />
                <span className="text-[11px] text-white/40">
                  {online
                    ? "Live heartbeat"
                    : hasReading
                      ? `Last packet ${relative}`
                      : "No heartbeat yet"}
                </span>
              </div>
            </MetricCard>
          </section>

          {/* ---------------------------------------------------------------- */}
          {/* 24-hour chart                                                    */}
          {/* ---------------------------------------------------------------- */}
          <article className="glass-card p-5 sm:p-7 xl:col-span-12">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="eyebrow">
                  <Activity className="h-3.5 w-3.5" />
                  24-hour trend
                </p>
                <h2 className="mt-2 text-lg font-semibold text-white">
                  Soil moisture history
                </h2>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="chip">
                  {data.history.length} chart points
                </span>
                <span className="chip">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Optimal {DRY_THRESHOLD}–{OVERWATERED_THRESHOLD}%
                </span>
              </div>
            </div>

            <div className="mt-6 h-[19rem] w-full sm:h-[22rem]">
              <MoistureChart readings={data.history} />
            </div>
          </article>

          {/* ---------------------------------------------------------------- */}
          {/* Health scale + pipeline                                          */}
          {/* ---------------------------------------------------------------- */}
          <div className="xl:col-span-7">
            <HealthScale moisture={moisture} status={status} />
          </div>

          <div className="xl:col-span-5">
            <Pipeline
              configured={data.configured}
              online={online}
              hasReading={hasReading}
              historyCount={data.history.length}
            />
          </div>
        </main>

        <footer className="flex flex-col gap-2 border-t border-white/[0.06] pt-5 text-[11px] text-white/30 sm:flex-row sm:items-center sm:justify-between">
          <p>ESP32 · Next.js · Supabase · Telegram</p>
          <p suppressHydrationWarning>
            Last sync {formatRelativeTime(data.fetchedAt, now)}
          </p>
        </footer>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Sub-components                                                             */
/* -------------------------------------------------------------------------- */

function ConnectionPill({
  configured,
  hasReading,
  online,
}: {
  configured: boolean;
  hasReading: boolean;
  online: boolean;
}) {
  if (!configured) {
    return (
      <span className="pill pill-muted">
        <CloudOff className="h-3.5 w-3.5" />
        Setup
      </span>
    );
  }

  if (!hasReading) {
    return (
      <span className="pill pill-muted">
        <Radio className="h-3.5 w-3.5" />
        Awaiting
      </span>
    );
  }

  if (online) {
    return (
      <span className="pill pill-online">
        <span className="status-dot" />
        Online
      </span>
    );
  }

  return (
    <span className="pill pill-offline">
      <WifiOff className="h-3.5 w-3.5" />
      Offline
    </span>
  );
}

function StatusPill({ status }: { status: PlantStatus | null }) {
  if (!status) {
    return (
      <span className="pill pill-muted">
        <Info className="h-3.5 w-3.5" />
        No status
      </span>
    );
  }

  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <span
      className="pill"
      style={{
        color: meta.color,
        backgroundColor: meta.soft,
        borderColor: meta.border,
      }}
    >
      <Icon className="h-3.5 w-3.5" />
      {meta.label}
    </span>
  );
}

function BannerView({ banner }: { banner: Banner }) {
  const tone = BANNER_TONE[banner.tone];
  const Icon = banner.icon;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex items-start gap-3 rounded-2xl border px-4 py-3.5 backdrop-blur-xl ${tone.wrapper}`}
    >
      <span
        className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-xl ${tone.icon}`}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className={`text-sm font-semibold ${tone.title}`}>{banner.title}</p>
        <p className="mt-0.5 text-xs leading-5 text-white/45">
          {banner.message}
        </p>
      </div>
    </div>
  );
}

function MoistureRing({
  value,
  color,
}: {
  value: number | null;
  color: string;
}) {
  const percentage = value !== null ? clamp(value, 0, 100) : 0;

  return (
    <div
      className="relative mx-auto grid h-48 w-48 shrink-0 place-items-center sm:h-56 sm:w-56"
      aria-hidden="true"
    >
      <div
        className="absolute inset-6 rounded-full opacity-70 blur-2xl"
        style={{
          background: `radial-gradient(circle, ${color}33, transparent 70%)`,
        }}
      />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background: `conic-gradient(from -90deg, ${color} ${
            percentage * 3.6
          }deg, rgba(255,255,255,0.055) 0deg)`,
        }}
      />
      <div className="absolute inset-[11px] rounded-full bg-[#07120d] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]" />
      <div className="absolute inset-[27px] rounded-full border border-white/[0.05] bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.07),transparent_60%)]" />
      <div className="relative text-center">
        <Leaf className="mx-auto h-7 w-7" style={{ color }} />
        <p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-white/35">
          Vitality
        </p>
        <p className="mt-1 text-3xl font-semibold text-white">
          {value !== null ? `${Math.round(value)}%` : "—"}
        </p>
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/30">
        {label}
      </p>
      <p className="mt-1.5 truncate text-base font-semibold text-white/85">
        {value}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-white/30">{hint}</p>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  suffix,
  hint,
  accent,
  children,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  suffix?: string;
  hint: string;
  accent: string;
  children?: ReactNode;
}) {
  return (
    <article className="glass-card group p-5 transition-transform duration-300 hover:-translate-y-0.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[0.22em] text-white/35">
            {label}
          </p>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="truncate text-2xl font-semibold tracking-tight text-white">
              {value}
            </span>
            {suffix ? (
              <span className="shrink-0 text-xs text-white/30">{suffix}</span>
            ) : null}
          </div>
        </div>
        <span
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.04]"
          style={{ color: accent }}
        >
          <Icon className="h-4 w-4" />
        </span>
      </div>

      {children}

      <p className="mt-3 text-[11px] leading-4 text-white/35">{hint}</p>
    </article>
  );
}

function HealthScale({
  moisture,
  status,
}: {
  moisture: number | null;
  status: PlantStatus | null;
}) {
  const marker = moisture !== null ? clamp(moisture, 0, 100) : null;

  const zones: Array<{
    key: PlantStatus;
    label: string;
    range: string;
    color: string;
    soft: string;
    border: string;
  }> = [
    {
      key: "DRY",
      label: "Dry",
      range: `Below ${DRY_THRESHOLD}%`,
      color: STATUS_META.DRY.color,
      soft: STATUS_META.DRY.soft,
      border: STATUS_META.DRY.border,
    },
    {
      key: "OPTIMAL",
      label: "Optimal",
      range: `${DRY_THRESHOLD}% – ${OVERWATERED_THRESHOLD}%`,
      color: STATUS_META.OPTIMAL.color,
      soft: STATUS_META.OPTIMAL.soft,
      border: STATUS_META.OPTIMAL.border,
    },
    {
      key: "OVERWATERED",
      label: "Overwatered",
      range: `Above ${OVERWATERED_THRESHOLD}%`,
      color: STATUS_META.OVERWATERED.color,
      soft: STATUS_META.OVERWATERED.soft,
      border: STATUS_META.OVERWATERED.border,
    },
  ];

  return (
    <article className="glass-card h-full p-5 sm:p-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">
            <Leaf className="h-3.5 w-3.5" />
            Plant health
          </p>
          <h2 className="mt-2 text-lg font-semibold text-white">
            Moisture comfort scale
          </h2>
        </div>
        <span className="chip">{status ? STATUS_META[status].label : "No data"}</span>
      </div>

      <div className="mt-7">
        <div className="relative h-3 rounded-full bg-gradient-to-r from-amber-400/80 via-emerald-400/80 to-sky-400/80">
          {marker !== null ? (
            <span
              className="absolute top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-[#07120d] bg-white shadow-[0_0_20px_rgba(255,255,255,0.35)]"
              style={{ left: `${marker}%` }}
            />
          ) : null}
        </div>
        <div className="mt-3 flex justify-between text-[10px] uppercase tracking-[0.16em] text-white/30">
          <span>0%</span>
          <span>{DRY_THRESHOLD}% dry</span>
          <span>{OVERWATERED_THRESHOLD}% wet</span>
          <span>100%</span>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {zones.map((zone) => {
          const active = status === zone.key;
          return (
            <div
              key={zone.key}
              className={`rounded-2xl border p-3.5 transition ${
                active
                  ? "bg-white/[0.06]"
                  : "border-white/[0.06] bg-black/10"
              }`}
              style={
                active
                  ? {
                      borderColor: zone.border,
                      boxShadow: `inset 0 0 30px ${zone.soft}`,
                    }
                  : undefined
              }
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: zone.color }}
                />
                <p className="text-xs font-medium text-white/70">
                  {zone.label}
                </p>
                {active ? (
                  <CheckCircle2
                    className="ml-auto h-3.5 w-3.5"
                    style={{ color: zone.color }}
                  />
                ) : null}
              </div>
              <p className="mt-2 text-[11px] leading-4 text-white/35">
                {zone.range}
              </p>
            </div>
          );
        })}
      </div>

      <p className="mt-5 text-xs leading-5 text-white/35">
        Alerts fire below {DRY_THRESHOLD}% and reset only above{" "}
        {RECOVERY_THRESHOLD}%, so small fluctuations around the threshold do
        not spam Telegram.
      </p>
    </article>
  );
}

function Pipeline({
  configured,
  online,
  hasReading,
  historyCount,
}: {
  configured: boolean;
  online: boolean;
  hasReading: boolean;
  historyCount: number;
}) {
  type Tone = "emerald" | "amber" | "sky" | "muted";

  const toneClass: Record<Tone, string> = {
    emerald: "bg-emerald-400",
    amber: "bg-amber-300",
    sky: "bg-sky-400",
    muted: "bg-white/20",
  };

  const steps: Array<{
    icon: LucideIcon;
    label: string;
    detail: string;
    status: string;
    tone: Tone;
  }> = [
    {
      icon: Cpu,
      label: "ESP32 probe",
      detail: "GPIO34 · 10-sample average",
      status: hasReading ? "Reporting" : "Waiting",
      tone: hasReading ? "emerald" : "muted",
    },
    {
      icon: Server,
      label: "HTTPS ingest",
      detail: "JSON POST · x-api-key",
      status: online ? "Receiving" : "Ready",
      tone: online ? "emerald" : "muted",
    },
    {
      icon: Database,
      label: "Supabase history",
      detail: `${historyCount} points · last 24 h`,
      status: configured ? "Connected" : "Setup required",
      tone: configured ? "emerald" : "amber",
    },
    {
      icon: Send,
      label: "Telegram alerts",
      detail: `<${DRY_THRESHOLD}% · 6 h cooldown`,
      status: "Armed",
      tone: "sky",
    },
  ];

  return (
    <article className="glass-card h-full p-5 sm:p-7">
      <div>
        <p className="eyebrow">
          <Activity className="h-3.5 w-3.5" />
          Telemetry pipeline
        </p>
        <h2 className="mt-2 text-lg font-semibold text-white">
          End-to-end system
        </h2>
      </div>

      <ol className="mt-6 space-y-4">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <li key={step.label} className="flex items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-white/[0.07] bg-white/[0.035] text-white/55">
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-white/75">
                  {step.label}
                </p>
                <p className="truncate text-[11px] text-white/30">
                  {step.detail}
                </p>
              </div>
              <span className="flex shrink-0 items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-white/40">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${toneClass[step.tone]}`}
                />
                {step.status}
              </span>
            </li>
          );
        })}
      </ol>

      <div className="mt-6 rounded-2xl border border-white/[0.06] bg-black/15 px-3.5 py-3 font-mono text-[10px] leading-5 text-white/30">
        ESP32 → HTTPS → Vercel → Supabase → Telegram
      </div>
    </article>
  );
}

function ChartSkeleton() {
  const bars = [34, 52, 44, 66, 58, 74, 49, 61, 55, 70, 46, 63, 57, 68, 42, 60, 50, 72, 54, 64];

  return (
    <div className="flex h-full w-full items-end gap-1.5 px-1 pb-1">
      {bars.map((height, index) => (
        <div
          key={index}
          className="skeleton-shimmer flex-1 rounded-t-md bg-white/[0.045]"
          style={{ height: `${height}%` }}
        />
      ))}
    </div>
  );
}
