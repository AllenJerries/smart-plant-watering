import {
  ALERT_COOLDOWN_MS,
  DRY_THRESHOLD,
  RECOVERY_THRESHOLD,
  isSensorFault,
} from "./status";
import type { AlertType, ReadingPayload } from "./types";

export const ALERT_COOLDOWN_HOURS = ALERT_COOLDOWN_MS / (60 * 60 * 1000);

export interface AlertStateSnapshot {
  lastAlertType: AlertType | null;
  lastAlertAt: string | null;
}

export interface AlertDecision {
  /** State that should be persisted after this reading. */
  nextState: AlertType;
  shouldNotify: boolean;
  reason: "DRY" | "FAULT" | null;
  /** HTML message for Telegram. Null when no notification is needed. */
  message: string | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function cooldownElapsed(lastAlertAt: string | null, now: Date): boolean {
  if (!lastAlertAt) return true;
  const timestamp = Date.parse(lastAlertAt);
  if (Number.isNaN(timestamp)) return true;
  return now.getTime() - timestamp >= ALERT_COOLDOWN_MS;
}

function signalText(rssi: number | null): string {
  return rssi === null ? "n/a" : `${rssi} dBm`;
}

export function buildDryAlertMessage(
  payload: ReadingPayload,
  now: Date,
): string {
  return [
    "🌱 <b>Smart Plant Alert</b>",
    "<b>Soil moisture is critically low.</b>",
    "",
    `Device: <code>${escapeHtml(payload.deviceId)}</code>`,
    `Moisture: <b>${payload.moisture.toFixed(1)}%</b> (dry threshold ${DRY_THRESHOLD}%)`,
    `Raw ADC: <code>${payload.raw}</code>`,
    `Wi-Fi: ${signalText(payload.rssi)}`,
    `Time: ${now.toISOString()}`,
    "",
    `Water the plant. The alert clears automatically above ${RECOVERY_THRESHOLD}%.`,
  ].join("\n");
}

export function buildFaultAlertMessage(
  payload: ReadingPayload,
  now: Date,
): string {
  return [
    "⚠️ <b>Smart Plant Sensor Fault</b>",
    "<b>Reading is outside the valid ADC range.</b>",
    "",
    `Device: <code>${escapeHtml(payload.deviceId)}</code>`,
    `Raw ADC: <code>${payload.raw}</code> (valid range 51–4089)`,
    `Wi-Fi: ${signalText(payload.rssi)}`,
    `Time: ${now.toISOString()}`,
    "",
    "Check the sensor wiring, power, and GPIO34 connection.",
  ].join("\n");
}

/**
 * Pure alert state machine.
 *
 * Rules:
 *  - FAULT takes priority when raw ADC is at the rails (disconnected sensor).
 *  - moisture < 30%  -> DRY, notify on state change or after the 6 h cooldown.
 *  - moisture > 40%  -> NORMAL (clears DRY / FAULT).
 *  - 30–40%          -> hysteresis band: keep DRY if already dry, else NORMAL.
 */
export function decideAlert(
  payload: ReadingPayload,
  state: AlertStateSnapshot,
  now: Date = new Date(),
): AlertDecision {
  if (isSensorFault(payload.raw)) {
    const shouldNotify =
      state.lastAlertType !== "FAULT" ||
      cooldownElapsed(state.lastAlertAt, now);

    return {
      nextState: "FAULT",
      shouldNotify,
      reason: shouldNotify ? "FAULT" : null,
      message: shouldNotify ? buildFaultAlertMessage(payload, now) : null,
    };
  }

  if (payload.moisture < DRY_THRESHOLD) {
    const shouldNotify =
      state.lastAlertType !== "DRY" ||
      cooldownElapsed(state.lastAlertAt, now);

    return {
      nextState: "DRY",
      shouldNotify,
      reason: shouldNotify ? "DRY" : null,
      message: shouldNotify ? buildDryAlertMessage(payload, now) : null,
    };
  }

  if (payload.moisture > RECOVERY_THRESHOLD) {
    return {
      nextState: "NORMAL",
      shouldNotify: false,
      reason: null,
      message: null,
    };
  }

  // Hysteresis band. A recovered FAULT is considered NORMAL once readings are
  // valid again, even if moisture sits between 30% and 40%.
  return {
    nextState: state.lastAlertType === "DRY" ? "DRY" : "NORMAL",
    shouldNotify: false,
    reason: null,
    message: null,
  };
}
