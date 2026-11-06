export type AlertType = "DRY" | "NORMAL" | "FAULT";

export type PlantStatus = "DRY" | "OPTIMAL" | "OVERWATERED";

/** Validated payload sent by the ESP32. */
export interface ReadingPayload {
  deviceId: string;
  raw: number;
  moisture: number;
  rssi: number | null;
}

/** Normalized reading returned to the dashboard. */
export interface SensorReading {
  id: number;
  device_id: string;
  moisture_pct: number;
  raw_value: number;
  rssi: number | null;
  created_at: string;
}

export interface DeviceState {
  device_id: string;
  last_alert_type: AlertType;
  last_alert_at: string | null;
  updated_at: string;
}

export interface DashboardSnapshot {
  deviceId: string;
  fetchedAt: string;
  configured: boolean;
  latest: SensorReading | null;
  state: DeviceState | null;
  history: SensorReading[];
  error?: string;
}
