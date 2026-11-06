import type { ReadingPayload } from "./types";

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export function isValidDeviceId(value: string): boolean {
  return DEVICE_ID_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates the untrusted JSON body from the ESP32.
 * Unknown fields are ignored so firmware can add metadata without breaking.
 */
export function parseReadingPayload(input: unknown): ParseResult<ReadingPayload> {
  if (!isRecord(input)) {
    return { ok: false, error: "Body must be a JSON object." };
  }

  if (typeof input.deviceId !== "string" || !isValidDeviceId(input.deviceId)) {
    return {
      ok: false,
      error:
        "deviceId must be 1–64 characters using letters, numbers, '-' or '_'.",
    };
  }

  if (
    typeof input.raw !== "number" ||
    !Number.isInteger(input.raw) ||
    input.raw < 0 ||
    input.raw > 4095
  ) {
    return { ok: false, error: "raw must be an integer between 0 and 4095." };
  }

  if (
    typeof input.moisture !== "number" ||
    !Number.isFinite(input.moisture) ||
    input.moisture < 0 ||
    input.moisture > 100
  ) {
    return { ok: false, error: "moisture must be a number between 0 and 100." };
  }

  let rssi: number | null = null;
  if (input.rssi !== undefined && input.rssi !== null) {
    if (
      typeof input.rssi !== "number" ||
      !Number.isInteger(input.rssi) ||
      input.rssi < -150 ||
      input.rssi > 0
    ) {
      return {
        ok: false,
        error: "rssi must be a nullable integer between -150 and 0.",
      };
    }
    rssi = input.rssi;
  }

  return {
    ok: true,
    data: {
      deviceId: input.deviceId,
      raw: input.raw,
      moisture: Math.round(input.moisture * 100) / 100,
      rssi,
    },
  };
}
