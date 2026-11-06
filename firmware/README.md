# ESP32 firmware

## Wiring

| Sensor v1.2 | ESP32 Dev Module |
| ----------- | ---------------- |
| VCC         | 3V3              |
| GND         | GND              |
| AOUT        | GPIO34 (ADC1)    |

GPIO34 is input-only and belongs to ADC1, so it remains usable while Wi-Fi is
active. Power the sensor from **3.3 V** to keep AOUT within the ESP32's ADC
range.

## Configure

Edit the macros at the top of `src/main.cpp`:

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

`DEVICE_ID` must match `PLANT_DEVICE_ID` in the web app (or the `deviceId` you
pass to `/api/dashboard`).

## Calibrate

Capacitive probes read **higher** in dry air and **lower** in water.

1. Flash the sketch with the serial monitor open.
2. Hold the probe in dry air / dry soil and note `Raw ADC`.
3. Put the sensing portion in a glass of water (keep the electronics dry) and
   note `Raw ADC` again.
4. Set `DRY_RAW` to the dry reading and `WET_RAW` to the wet reading.
5. Re-flash.

The firmware maps `DRY_RAW → 0%` and `WET_RAW → 100%`, clamps the result to
0–100%, and flags `raw <= 50` or `raw >= 4090` as a disconnected/floating
sensor.

## Flash with Arduino IDE

1. Install the **ESP32 board package** via Boards Manager.
2. Select **ESP32 Dev Module** and the correct port.
3. Open `src/main.cpp`, edit the configuration macros, and click **Upload**.
4. Open Serial Monitor at **115200 baud** to watch one boot cycle.

No third-party Arduino libraries are required.

## Flash with PlatformIO

```bash
cd firmware
pio run -t upload
pio device monitor -b 115200
```

## Deep sleep

The node reads, uploads, and immediately enters a five-minute timer deep sleep.
The USB serial connection drops during sleep; press **EN** to wake it manually.
To debug continuously, temporarily raise `SLEEP_SECONDS` or comment out the
`goToSleep()` calls.

## HTTPS trust model

`WiFiClientSecure::setInsecure()` is used to keep the sketch portable and
dependency-free. It encrypts traffic but does **not** verify the server
certificate. For production, replace it with `setCACert()` (or certificate
pinning) and rotate the API key periodically.
