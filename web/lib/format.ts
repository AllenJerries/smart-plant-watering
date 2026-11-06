const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * Deterministic relative time formatter. Pass the server `fetchedAt` as `now`
 * during SSR to keep server and client markup identical.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return "never";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "unknown";

  const diff = timestamp - now;
  const absolute = Math.abs(diff);

  if (absolute < 45_000) return "just now";

  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 60) {
    return relativeTime.format(minutes, "minute");
  }

  const hours = Math.round(diff / 3_600_000);
  if (Math.abs(hours) < 24) {
    return relativeTime.format(hours, "hour");
  }

  const days = Math.round(diff / 86_400_000);
  return relativeTime.format(days, "day");
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "—";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export function formatMoisture(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return value.toFixed(1);
}

export function formatRssi(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "—";
  }
  return `${Math.round(value)}`;
}
