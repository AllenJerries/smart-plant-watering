/**
 * Shared Realtime topic for a single device.
 *
 * Both the ingest API (publisher) and the dashboard (subscriber) must use the
 * exact same topic string, so it lives in one place.
 */
export function deviceTopic(deviceId: string): string {
  return `plant:${deviceId}`;
}
