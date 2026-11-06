# Verdant — Smart Plant Watering System

A portfolio-grade, end-to-end IoT system: an ESP32 capacitive soil probe sends
authenticated HTTPS telemetry to a Next.js serverless API, Supabase stores the
history and alert state, Telegram delivers low-moisture alerts with hysteresis
and a cooldown, and a responsive glassmorphic dashboard visualizes everything.

```
┌─────────────────────┐      HTTPS POST + x-api-key      ┌──────────────────────┐
│  ESP32 + probe v1.2 │ ───────────────────────────────► │ Next.js /api/reading │
│  GPIO34 · ADC1      │   { deviceId, raw, moisture,     │ Vercel serverless    │
│  deep sleep 5 min   │     rssi }                       └──────────┬───────────┘
└─────────────────────┘                                            │
                                                                   │ insert + state
                                                                   ▼
                                                        ┌──────────────────────┐
                                                        │ Supabase Postgres    │
                                                        │ sensor_readings      │
                                                        │ device_state         │
                                                        └──────────┬───────────┘
                                                                   │
                                             30–40% hysteresis     │ 6 h cooldown
                                                                   ▼
                                                        ┌──────────────────────┐
                                                        │ Telegram Bot API     │
                                                        └──────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ Dashboard (Next.js server snapshot + Supabase Realtime)                      │
│ live moisture · raw ADC · RSSI bars · plant status · online/offline · 24 h  │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Features

- **ESP32 firmware** — 10-sample ADC average with min/max rejection, calibration
  mapping, disconnected-sensor detection, HTTPS POST, and five-minute deep sleep.
- **Hardened ingest API** — constant-time API key check, JSON validation, body
  size limits, content-type enforcement, structured responses, and non-fatal
  notification failures.
- **Alert state machine** — dry alerts below 30%, recovery above 40% (hysteresis),
  six-hour reminder cooldown, and a separate `FAULT` state for a floating probe.
- **Supabase schema** — indexed time-series table, per-device state table,
  row-level security, read-only public policies, and an `updated_at` trigger.
- **Glassmorphic dashboard** — animated moisture ring, raw ADC and RSSI metrics,
  plant health scale, online/offline heartbeat, 24-hour Recharts trend, and
  graceful setup/empty/error states.
- **Live updates** — the ingest API publishes each accepted reading over Supabase
  Realtime Broadcast, so the dashboard updates without a refresh. Postgres
  Changes subscriptions are also wired up, and a one-second poll covers any
  Realtime outage.
- **Tests** — 20 Vitest cases covering alert hysteresis/cooldown and payload
  validation.

## Repository layout

```text
smart-plant-watering/
├── README.md
├── firmware/
│   ├── platformio.ini
│   ├── README.md
│   └── src/main.cpp
└── web/
    ├── app/
    │   ├── api/dashboard/route.ts
    │   ├── api/reading/route.ts
    │   ├── globals.css
    │   ├── icon.svg
    │   ├── layout.tsx
    │   └── page.tsx
    ├── components/
    │   ├── Dashboard.tsx
    │   ├── MoistureChart.tsx
    │   └── SignalBars.tsx
    ├── lib/
    │   ├── alerts.ts / alerts.test.ts
    │   ├── dashboard.ts
    │   ├── database.types.ts
    │   ├── format.ts
    │   ├── status.ts
    │   ├── supabase.ts
    │   ├── telegram.ts
    │   ├── types.ts
    │   └── validation.ts / validation.test.ts
    ├── .env.example
    ├── package.json
    ├── schema.sql
    └── seed.sql
```

## Quick start

### Prerequisites

- Node.js **20.9+**
- A Supabase project
- A Telegram bot
- An ESP32 Dev Module + Capacitive Soil Moisture Sensor v1.2

### 1. Create the database

1. Open your Supabase project → **SQL Editor**.
2. Paste and run `web/schema.sql`.
3. Optional: run `web/seed.sql` to insert 24 hours of demo readings so the
   dashboard and chart are populated immediately.

### 2. Create a Telegram bot

1. Message [@BotFather](https://t.me/BotFather), run `/newbot`, and copy the
   token.
2. Send any message to your new bot.
3. Open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` and copy
   `result[0].message.chat.id` as `TELEGRAM_CHAT_ID`.

### 3. Configure environment variables

```bash
cd web
cp .env.example .env.local
```

Fill in:

| Variable | Where to find it |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (**server-only**) |
| `ESP32_SECRET_KEY` | Generate a long random string (see below) |
| `TELEGRAM_BOT_TOKEN` | BotFather |
| `TELEGRAM_CHAT_ID` | `getUpdates` |
| `PLANT_DEVICE_ID` | Defaults to `plant-01` |

Generate a device secret:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `SUPABASE_SERVICE_ROLE_KEY` must never be prefixed with `NEXT_PUBLIC_` and
> must never be committed. `.env*.local` is git-ignored.

### 4. Start the local dev server

```bash
cd web
npm install
npm run dev
```

Open **http://localhost:3000**.

### 5. Send a test reading

```bash
curl -X POST http://localhost:3000/api/reading \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ESP32_SECRET_KEY" \
  -d '{"deviceId":"plant-01","raw":2150,"moisture":50,"rssi":-62}'
```

Expected: `201 Created`, a persisted reading, and `alert.state: "NORMAL"`.

Try the alert path:

```bash
# First dry reading -> Telegram alert, state DRY
curl -X POST http://localhost:3000/api/reading \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ESP32_SECRET_KEY" \
  -d '{"deviceId":"plant-01","raw":2900,"moisture":24,"rssi":-66}'

# Second dry reading inside 6 h -> no duplicate alert
curl -X POST http://localhost:3000/api/reading \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ESP32_SECRET_KEY" \
  -d '{"deviceId":"plant-01","raw":2880,"moisture":25,"rssi":-66}'

# Moisture above 40% -> state resets to NORMAL
curl -X POST http://localhost:3000/api/reading \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_ESP32_SECRET_KEY" \
  -d '{"deviceId":"plant-01","raw":2050,"moisture":45,"rssi":-60}'
```

## ESP32 firmware

### Wiring

| Sensor v1.2 | ESP32 Dev Module |
| --- | --- |
| VCC | 3V3 |
| GND | GND |
| AOUT | GPIO34 (ADC1) |

Use 3.3 V for the sensor so its analog output stays within the ESP32 ADC range.
GPIO34 is input-only and on ADC1, which keeps working while Wi-Fi is active.

### Configure

Edit the macros at the top of `firmware/src/main.cpp`:

```cpp
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASS "YOUR_WIFI_PASSWORD"
#define SERVER_URL "https://your-project.vercel.app/api/reading"
#define API_KEY "the-same-value-as-ESP32_SECRET_KEY"
#define DEVICE_ID "plant-01"
#define DRY_RAW 3000
#define WET_RAW 1300
#define SENSOR_PIN 34
```

`DEVICE_ID` must match `PLANT_DEVICE_ID` (or the dashboard's `deviceId` query
parameter).

### Calibrate the probe

Capacitive probes read **higher** when dry and **lower** when wet.

1. Flash with the serial monitor open.
2. Note the `Raw ADC` value in dry air / dry soil → set `DRY_RAW`.
3. Place the sensing portion in water (keep the electronics dry) and note the
   value → set `WET_RAW`.
4. Re-flash.

The sketch maps `DRY_RAW → 0%`, `WET_RAW → 100%`, clamps to 0–100%, and flags
`raw <= 50` or `raw >= 4090` as a disconnected/floating sensor.

### Flash with Arduino IDE

1. Install the **ESP32 board package** from Boards Manager.
2. Select **ESP32 Dev Module** and the correct serial port.
3. Open `firmware/src/main.cpp`, update the macros, and click **Upload**.
4. Open Serial Monitor at **115200 baud**.

No third-party libraries are required — Wi-Fi, HTTPS, HTTPClient, and deep sleep
ship with the ESP32 Arduino core.

### Flash with PlatformIO

```bash
cd firmware
pio run -t upload
pio device monitor -b 115200
```

The node reads, uploads, and enters a five-minute timer deep sleep. USB serial
disconnects during sleep; press **EN** to wake it manually.

## API

### `POST /api/reading`

Headers:

```http
Content-Type: application/json
x-api-key: <ESP32_SECRET_KEY>
```

Body:

```json
{
  "deviceId": "plant-01",
  "raw": 2150,
  "moisture": 50.0,
  "rssi": -62
}
```

Validation:

- `deviceId`: 1–64 chars, letters/numbers/`-`/`_`
- `raw`: integer 0–4095
- `moisture`: number 0–100
- `rssi`: optional nullable integer −150–0
- Body limit: 4 KB

Responses: `201` saved, `400` invalid body, `401` bad API key, `413` body too
large, `415` wrong content type, `500` database/configuration failure, `503`
Supabase not configured.

### `GET /api/dashboard?deviceId=plant-01`

Returns the latest reading, alert state, and up to 24 hours of history for the
dashboard. `Cache-Control: no-store` is set on every response.

### Alert state machine

| Reading | Next state | Telegram |
| --- | --- | --- |
| `raw <= 50` or `raw >= 4090` | `FAULT` | On state change or after 6 h |
| `moisture < 30%` | `DRY` | On state change or after 6 h |
| `moisture > 40%` | `NORMAL` | No (clears alert) |
| `30% <= moisture <= 40%` | Keep `DRY` if already dry, else `NORMAL` | No (hysteresis) |

The cooldown timestamp only advances after Telegram confirms delivery, so a
transient Telegram outage is retried on the next reading. The reading itself is
persisted even when notification delivery fails.

## Dashboard

- Live metrics: moisture %, raw ADC, RSSI with 1–4 bars, plant status
  (Dry / Optimal / Overwatered), and Online/Offline heartbeat.
- Offline after 15 minutes without a reading.
- 24-hour Recharts area chart with dry/wet reference lines.
- Server-rendered first paint, then Supabase Realtime subscriptions for new
  readings and alert-state changes. The ingest API broadcasts every accepted
  reading immediately, so no browser refresh is needed. A one-second poll is
  kept as a fallback and the page also refreshes when the tab becomes visible.
- Two push paths are wired up: Realtime Broadcast (works out of the box) and
  Postgres Changes (requires `schema.sql` to have added both tables to the
  `supabase_realtime` publication). Broadcast is the primary path, so the
  dashboard shows `Live` even before that SQL is applied.
- Graceful states for missing Supabase config, empty history, database errors,
  sensor faults, and stale devices.

## Tests and build

```bash
cd web
npm run typecheck
npm test
npm run build
```

## Deploy to Vercel

1. Import the repository into Vercel.
2. Set **Root Directory** to `web`.
3. Add every variable from `web/.env.example` in **Project Settings →
   Environment Variables**.
4. Deploy.
5. Set the firmware `SERVER_URL` to
   `https://<your-project>.vercel.app/api/reading` and re-flash.

The Supabase schema only grants `SELECT` to `anon`/`authenticated`; writes use
the service role key inside the serverless route.

## Security notes

- API keys are compared with SHA-256 hashes and `timingSafeEqual`.
- The service role key is only read by server-side modules.
- Input is validated and size-limited; Telegram messages are HTML-escaped.
- RLS is enabled on both tables with read-only policies.
- `client.setInsecure()` is used in firmware for portability. For a hardened
  deployment, pin the server CA with `setCACert()` and rotate `ESP32_SECRET_KEY`
  periodically.
- For high-volume deployments, add rate limiting (Vercel WAF or Upstash) and a
  retention job for old readings.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Dashboard says “Connect Supabase” | Check `web/.env.local` and restart `npm run dev`. |
| `401 Unauthorized` | Firmware `API_KEY` must equal `ESP32_SECRET_KEY`. |
| `503 Database is not configured` | Set `SUPABASE_SERVICE_ROLE_KEY` server-side. |
| `415` from the API | Send `Content-Type: application/json`. |
| Telegram silent | Start a chat with the bot, verify `TELEGRAM_CHAT_ID`, check the API response's `alert.error`. |
| Chart empty | Run `web/seed.sql` or wait for the ESP32's next five-minute cycle. |
| Device shows Offline | No reading in 15 minutes; check Wi-Fi, power, and deep-sleep wake. |
| Raw ADC is 0 or 4095 | Check probe wiring/3.3 V supply; recalibrate `DRY_RAW`/`WET_RAW`. |
