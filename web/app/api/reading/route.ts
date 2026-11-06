import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { decideAlert } from "@/lib/alerts";
import { broadcastReading, broadcastState } from "@/lib/realtime-broadcast";
import { getSupabaseAdmin } from "@/lib/supabase";
import { sendTelegramAlert } from "@/lib/telegram";
import { parseReadingPayload } from "@/lib/validation";
import type { AlertType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 4_096;
const NO_STORE = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

/**
 * Hashes both values before comparing so the comparison is constant-time and
 * does not leak the expected key length.
 */
function secureCompare(provided: string, expected: string): boolean {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

async function handlePost(request: Request): Promise<NextResponse> {
  const expectedKey = process.env.ESP32_SECRET_KEY?.trim();
  if (!expectedKey) {
    console.error("[ingest] ESP32_SECRET_KEY is not configured.");
    return json({ error: "Server is not configured for device ingest." }, 500);
  }

  const providedKey = request.headers.get("x-api-key");
  if (!providedKey || !secureCompare(providedKey, expectedKey)) {
    return json({ error: "Unauthorized." }, 401);
  }

  const contentType =
    request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return json({ error: "Content-Type must be application/json." }, 415);
  }

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large." }, 413);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) {
    return json({ error: "Request body is too large." }, 413);
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return json({ error: "Malformed JSON body." }, 400);
  }

  const parsed = parseReadingPayload(parsedBody);
  if (!parsed.ok) {
    return json({ error: parsed.error }, 400);
  }
  const payload = parsed.data;

  const supabase = getSupabaseAdmin();
  if (!supabase) {
    console.error(
      "[ingest] Supabase admin client is unavailable (check SUPABASE_SERVICE_ROLE_KEY).",
    );
    return json({ error: "Database is not configured." }, 503);
  }

  // Telemetry is always persisted first; a notification failure must not lose
  // the reading.
  const { data: inserted, error: insertError } = await supabase
    .from("sensor_readings")
    .insert({
      device_id: payload.deviceId,
      moisture_pct: payload.moisture,
      raw_value: payload.raw,
      rssi: payload.rssi,
    })
    .select("id, created_at")
    .single();

  if (insertError || !inserted) {
    console.error(
      "[ingest] Failed to insert reading:",
      insertError?.message ?? "no row returned",
    );
    return json({ error: "Could not persist reading." }, 500);
  }

  const readingResponse = {
    id: inserted.id,
    deviceId: payload.deviceId,
    moisture: payload.moisture,
    raw: payload.raw,
    rssi: payload.rssi,
    createdAt: inserted.created_at,
  };

  // Push the new row to the dashboard immediately, before the slower alert
  // evaluation and Telegram delivery. Broadcast does not depend on the
  // `supabase_realtime` publication, so this works without extra SQL setup.
  await broadcastReading({
    id: inserted.id,
    device_id: payload.deviceId,
    moisture_pct: payload.moisture,
    raw_value: payload.raw,
    rssi: payload.rssi,
    created_at: inserted.created_at,
  });

  const { data: stateRow, error: stateError } = await supabase
    .from("device_state")
    .select("*")
    .eq("device_id", payload.deviceId)
    .maybeSingle();

  if (stateError) {
    console.error("[ingest] Failed to load device state:", stateError.message);
    return json(
      {
        ok: true,
        reading: readingResponse,
        alert: {
          state: "UNKNOWN",
          sent: false,
          reason: null,
          error: "Alert state unavailable; notification skipped.",
        },
      },
      201,
    );
  }

  const decision = decideAlert(payload, {
    lastAlertType: stateRow?.last_alert_type ?? null,
    lastAlertAt: stateRow?.last_alert_at ?? null,
  });

  let alertSent = false;
  let alertError: string | undefined;

  if (decision.shouldNotify && decision.message) {
    const result = await sendTelegramAlert(decision.message);
    alertSent = result.ok;
    if (!result.ok) alertError = result.error;
  }

  const nowIso = new Date().toISOString();
  const stateUpdate: {
    device_id: string;
    last_alert_type: AlertType;
    updated_at: string;
    last_alert_at?: string;
  } = {
    device_id: payload.deviceId,
    last_alert_type: decision.nextState,
    updated_at: nowIso,
    // Only advance the cooldown timestamp after a successful delivery, so a
    // transient Telegram outage is retried on the next reading.
    ...(alertSent ? { last_alert_at: nowIso } : {}),
  };

  const { error: upsertError } = await supabase
    .from("device_state")
    .upsert(stateUpdate, { onConflict: "device_id" });

  if (upsertError) {
    console.error("[ingest] Failed to update device state:", upsertError.message);
  } else {
    await broadcastState({
      device_id: payload.deviceId,
      last_alert_type: decision.nextState,
      last_alert_at: alertSent ? nowIso : (stateRow?.last_alert_at ?? null),
      updated_at: nowIso,
    });
  }

  return json(
    {
      ok: true,
      reading: readingResponse,
      alert: {
        state: decision.nextState,
        sent: alertSent,
        reason: decision.reason,
        ...(alertError ? { error: alertError } : {}),
        ...(upsertError ? { statePersisted: false } : {}),
      },
    },
    201,
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    return await handlePost(request);
  } catch (error) {
    console.error("[ingest] Unhandled error:", error);
    return json({ error: "Internal server error." }, 500);
  }
}
