import type { Database } from "./database.types";
import { getSupabaseReadClient } from "./supabase";
import type {
  DashboardSnapshot,
  DeviceState,
  SensorReading,
} from "./types";

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000;
const HISTORY_ROW_LIMIT = 1_000;
const MAX_CHART_POINTS = 480;
const DEFAULT_DEVICE_ID = "plant-01";

type ReadingRow =
  Database["public"]["Tables"]["sensor_readings"]["Row"];
type StateRow = Database["public"]["Tables"]["device_state"]["Row"];

export function getDefaultDeviceId(): string {
  const configured = process.env.PLANT_DEVICE_ID?.trim();
  if (configured && /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(configured)) {
    return configured;
  }
  return DEFAULT_DEVICE_ID;
}

function mapReading(row: ReadingRow): SensorReading {
  return {
    id: Number(row.id),
    device_id: row.device_id,
    moisture_pct: Number(row.moisture_pct),
    raw_value: Number(row.raw_value),
    rssi: row.rssi === null ? null : Number(row.rssi),
    created_at: row.created_at,
  };
}

function mapState(row: StateRow): DeviceState {
  return {
    device_id: row.device_id,
    last_alert_type: row.last_alert_type,
    last_alert_at: row.last_alert_at,
    updated_at: row.updated_at,
  };
}

/**
 * Keeps the chart readable when a device sends faster than the default
 * 5-minute cadence. Always preserves the first and last points.
 */
export function downsampleReadings(
  readings: SensorReading[],
  maxPoints: number = MAX_CHART_POINTS,
): SensorReading[] {
  if (readings.length <= maxPoints) return readings;
  if (maxPoints < 2) return readings.slice(-maxPoints);

  const step = (readings.length - 1) / (maxPoints - 1);
  const sampled: SensorReading[] = [];
  for (let index = 0; index < maxPoints; index += 1) {
    sampled.push(readings[Math.round(index * step)]);
  }
  return sampled;
}

function queryErrorMessage(
  error: { message: string },
  fallback: string,
): string {
  if (process.env.NODE_ENV === "development") {
    return `${fallback}: ${error.message}`;
  }
  return fallback;
}

/**
 * Loads everything the dashboard needs in one server-side pass.
 * A missing Supabase configuration is not an exception: it returns a
 * serializable snapshot with `configured: false` so the UI can explain setup.
 */
export async function getDashboardSnapshot(
  deviceId: string = getDefaultDeviceId(),
): Promise<DashboardSnapshot> {
  const base: DashboardSnapshot = {
    deviceId,
    fetchedAt: new Date().toISOString(),
    configured: false,
    latest: null,
    state: null,
    history: [],
  };

  const supabase = getSupabaseReadClient();
  if (!supabase) return base;

  const since = new Date(Date.now() - HISTORY_WINDOW_MS).toISOString();

  const [latestResult, stateResult, historyResult] = await Promise.all([
    supabase
      .from("sensor_readings")
      .select("*")
      .eq("device_id", deviceId)
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("device_state")
      .select("*")
      .eq("device_id", deviceId)
      .maybeSingle(),
    supabase
      .from("sensor_readings")
      .select("*")
      .eq("device_id", deviceId)
      .gte("created_at", since)
      .order("created_at", { ascending: true })
      .limit(HISTORY_ROW_LIMIT),
  ]);

  const errors: string[] = [];

  if (latestResult.error) {
    errors.push(
      queryErrorMessage(latestResult.error, "Could not load the latest reading"),
    );
  }
  if (stateResult.error) {
    errors.push(
      queryErrorMessage(stateResult.error, "Could not load the device state"),
    );
  }
  if (historyResult.error) {
    errors.push(
      queryErrorMessage(historyResult.error, "Could not load reading history"),
    );
  }

  if (errors.length > 0) {
    console.error("[dashboard] Supabase query failed:", errors.join(" | "));
  }

  const latestRow = latestResult.data?.[0];
  const history = (historyResult.data ?? []).map(mapReading);

  return {
    ...base,
    configured: true,
    latest: latestRow ? mapReading(latestRow) : null,
    state: stateResult.data ? mapState(stateResult.data) : null,
    history: downsampleReadings(history),
    ...(errors.length > 0
      ? { error: errors.join(" ") }
      : {}),
  };
}
