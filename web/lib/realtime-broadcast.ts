import { deviceTopic } from "./realtime-topic";
import type { DeviceState, SensorReading } from "./types";

/**
 * Server-side publisher for Supabase Realtime Broadcast.
 *
 * Postgres Changes requires the table to be added to the `supabase_realtime`
 * publication, which can only be done from SQL. Broadcast has no such
 * requirement: the ingest route publishes each accepted reading (and alert
 * state change) directly, so the dashboard updates instantly even before
 * `schema.sql` has been applied.
 *
 * Publishing is best-effort. The dashboard keeps a one-second polling fallback,
 * so a broadcast failure must never fail the ingest request.
 */

const BROADCAST_TIMEOUT_MS = 1_500;

type BroadcastEvent = "reading" | "state";

async function publish(
  deviceId: string,
  event: BroadcastEvent,
  payload: SensorReading | DeviceState,
): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return;

  try {
    const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: deviceTopic(deviceId),
            event,
            payload,
            private: false,
          },
        ],
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(BROADCAST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.warn(
        `[realtime] Broadcast ${event} failed: HTTP ${response.status}`,
      );
    }
  } catch (error) {
    console.warn(
      `[realtime] Broadcast ${event} failed:`,
      error instanceof Error ? error.message : error,
    );
  }
}

export function broadcastReading(reading: SensorReading): Promise<void> {
  return publish(reading.device_id, "reading", reading);
}

export function broadcastState(state: DeviceState): Promise<void> {
  return publish(state.device_id, "state", state);
}
