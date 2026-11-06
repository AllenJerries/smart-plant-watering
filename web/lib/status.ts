import type { PlantStatus } from "./types";

/** Below this moisture percentage the soil is considered dry. */
export const DRY_THRESHOLD = 30;

/**
 * Moisture must climb back above this value before a DRY alert is cleared.
 * The 30–40% band is the hysteresis zone, preventing alert flapping.
 */
export const RECOVERY_THRESHOLD = 40;

/** Above this value the plant is considered overwatered. */
export const OVERWATERED_THRESHOLD = 70;

/** Repeat alerts are suppressed for this long while the condition persists. */
export const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/** A device with no reading in this window is shown as offline. */
export const OFFLINE_AFTER_MS = 15 * 60 * 1000;

/** Raw ADC values outside this range indicate a disconnected/floating sensor. */
export const FAULT_RAW_MIN = 50;
export const FAULT_RAW_MAX = 4090;

export function getPlantStatus(
  moisture: number | null | undefined,
): PlantStatus | null {
  if (moisture === null || moisture === undefined || !Number.isFinite(moisture)) {
    return null;
  }
  if (moisture < DRY_THRESHOLD) return "DRY";
  if (moisture > OVERWATERED_THRESHOLD) return "OVERWATERED";
  return "OPTIMAL";
}

export function isReadingOnline(
  createdAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!createdAt) return false;
  const timestamp = Date.parse(createdAt);
  if (Number.isNaN(timestamp)) return false;
  return now - timestamp <= OFFLINE_AFTER_MS;
}

/** Returns 0 (unknown) or 1–4 bars for a Wi-Fi RSSI value in dBm. */
export function getSignalBars(rssi: number | null | undefined): number {
  if (rssi === null || rssi === undefined || !Number.isFinite(rssi)) return 0;
  if (rssi >= -55) return 4;
  if (rssi >= -65) return 3;
  if (rssi >= -75) return 2;
  return 1;
}

export function getSignalLabel(bars: number): string {
  switch (bars) {
    case 4:
      return "Excellent";
    case 3:
      return "Good";
    case 2:
      return "Fair";
    case 1:
      return "Weak";
    default:
      return "No signal";
  }
}

export function isSensorFault(raw: number | null | undefined): boolean {
  if (raw === null || raw === undefined || !Number.isFinite(raw)) return false;
  return raw <= FAULT_RAW_MIN || raw >= FAULT_RAW_MAX;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
