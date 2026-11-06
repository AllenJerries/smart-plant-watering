interface SignalBarsProps {
  bars: number;
  className?: string;
}

/**
 * Four ascending bars, used for the ESP32's Wi-Fi RSSI.
 * `bars` is clamped to 0–4; 0 renders an empty (unknown) indicator.
 */
export function SignalBars({ bars, className = "" }: SignalBarsProps) {
  const level = Math.max(0, Math.min(4, Math.round(bars)));
  const activeColor =
    level >= 3
      ? "bg-emerald-400"
      : level === 2
        ? "bg-amber-300"
        : "bg-rose-400";

  return (
    <div
      className={`flex items-end gap-1 ${className}`}
      role="img"
      aria-label={`${level} of 4 Wi-Fi signal bars`}
    >
      {[1, 2, 3, 4].map((bar) => (
        <span
          key={bar}
          className={`w-1.5 rounded-full transition-colors ${
            bar <= level ? activeColor : "bg-white/10"
          }`}
          style={{ height: `${6 + bar * 4}px` }}
        />
      ))}
    </div>
  );
}
