/**
 * ============================================================================
 * Smart Plant Watering System — ESP32 telemetry node
 * ============================================================================
 *
 * Hardware
 *   - ESP32 Dev Module
 *   - Capacitive Soil Moisture Sensor v1.2
 *     VCC  -> 3V3
 *     GND  -> GND
 *     AOUT -> GPIO34 (ADC1, input-only)
 *
 * Behaviour
 *   1. Wake from deep sleep (timer or reset).
 *   2. Average 10 ADC samples, discarding the min and max.
 *   3. Convert raw ADC to 0–100 % moisture and detect a disconnected probe.
 *   4. Join Wi-Fi, capture RSSI, and POST JSON over HTTP(S) with x-api-key.
 *   5. Sleep for five minutes and repeat.
 *
 * Security note
 *   Plain HTTP is supported for local development only (for example a Next.js
 *   dev server on your LAN). Production deployments must use an HTTPS URL.
 *   For HTTPS, `client.setInsecure()` is used so the sketch works without
 *   embedding a CA bundle. For a hardened deployment, replace it with
 *   `client.setCACert(...)` using the root CA for your server (or use a pinned
 *   certificate).
 * ============================================================================
 */

#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_sleep.h>

// ============================================================================
// User configuration
// ============================================================================

#ifndef WIFI_SSID
#define WIFI_SSID "JERRIES-NITRO-FOX 4050"
#endif

#ifndef WIFI_PASS
#define WIFI_PASS "9360972523"
#endif

#ifndef SERVER_URL
#define SERVER_URL "http://10.38.226.160:3000/api/reading"
#endif

#ifndef API_KEY
#define API_KEY "allen_plant_secure_key_2026"
#endif

#ifndef DEVICE_ID
#define DEVICE_ID "plant-01"
#endif

// Calibration: raw ADC in dry air vs. submerged in water.
// Capacitive sensors read HIGHER when dry, so DRY_RAW > WET_RAW.
#ifndef DRY_RAW
#define DRY_RAW 3000
#endif

#ifndef WET_RAW
#define WET_RAW 1300
#endif

#ifndef SENSOR_PIN
#define SENSOR_PIN 34
#endif

// ============================================================================
// Tunables
// ============================================================================

#define SAMPLE_COUNT 10
#define SAMPLE_DELAY_MS 10
#define SLEEP_SECONDS (5 * 60)
#define WIFI_TIMEOUT_MS 20000
#define HTTP_TIMEOUT_MS 12000
#define SERIAL_BAUD 115200
#define JSON_BUFFER_SIZE 256

static_assert(DRY_RAW > WET_RAW, "DRY_RAW must be greater than WET_RAW");
static_assert(SAMPLE_COUNT >= 3, "Need at least 3 samples to drop min/max");

RTC_DATA_ATTR uint32_t bootCount = 0;

// ============================================================================
// Helpers
// ============================================================================

const char *wakeCauseToString(esp_sleep_wakeup_cause_t cause) {
  switch (cause) {
    case ESP_SLEEP_WAKEUP_TIMER:
      return "timer";
    case ESP_SLEEP_WAKEUP_UNDEFINED:
      return "power-on/reset";
    default:
      return "other";
  }
}

bool configurationLooksValid() {
  if (strcmp(WIFI_SSID, "YOUR_WIFI_NAME") == 0) return false;
  if (strcmp(WIFI_PASS, "YOUR_WIFI_PASSWORD") == 0) return false;
  if (strcmp(API_KEY, "replace-with-a-long-random-secret") == 0) return false;
  if (strstr(SERVER_URL, "your-project") != nullptr) return false;

  const bool httpUrl = strncmp(SERVER_URL, "http://", 7) == 0;
  const bool httpsUrl = strncmp(SERVER_URL, "https://", 8) == 0;
  if (!httpUrl && !httpsUrl) return false;

  return true;
}

/**
 * Reads GPIO34 ten times, sorts the samples, drops the lowest and highest,
 * and returns the mean of the remaining eight values.
 */
uint16_t readAveragedRaw() {
  uint16_t samples[SAMPLE_COUNT];

  for (uint8_t i = 0; i < SAMPLE_COUNT; i++) {
    samples[i] = static_cast<uint16_t>(analogRead(SENSOR_PIN));
    delay(SAMPLE_DELAY_MS);
  }

  // Insertion sort (only 10 elements; keeps the sketch dependency-free).
  for (uint8_t i = 1; i < SAMPLE_COUNT; i++) {
    const uint16_t key = samples[i];
    int8_t j = static_cast<int8_t>(i) - 1;
    while (j >= 0 && samples[j] > key) {
      samples[j + 1] = samples[j];
      j--;
    }
    samples[j + 1] = key;
  }

  uint32_t sum = 0;
  for (uint8_t i = 1; i < SAMPLE_COUNT - 1; i++) {
    sum += samples[i];
  }

  return static_cast<uint16_t>(sum / (SAMPLE_COUNT - 2));
}

/**
 * Maps a raw ADC value to 0–100 % moisture with one decimal of resolution.
 * The mapping is inverted because the capacitive probe's voltage falls as
 * soil moisture rises.
 */
float rawToMoisture(uint16_t raw) {
  const long mapped = map(
      static_cast<long>(raw),
      static_cast<long>(DRY_RAW),
      static_cast<long>(WET_RAW),
      0L,
      1000L);
  const long constrained = constrain(mapped, 0L, 1000L);
  return static_cast<float>(constrained) / 10.0f;
}

bool connectWifi() {
  WiFi.persistent(false);
  WiFi.setAutoReconnect(false);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);

  Serial.printf("Connecting to Wi-Fi \"%s\"", WIFI_SSID);

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED &&
         millis() - startedAt < WIFI_TIMEOUT_MS) {
    delay(400);
    Serial.print('.');
  }
  Serial.println();

  if (WiFi.status() != WL_CONNECTED) {
    Serial.printf("Wi-Fi connection failed (status %d).\n",
                  static_cast<int>(WiFi.status()));
    return false;
  }

  Serial.printf("Wi-Fi connected: %s | RSSI %d dBm\n",
                WiFi.localIP().toString().c_str(),
                static_cast<int>(WiFi.RSSI()));
  return true;
}

bool postReading(const char *payload) {
  const bool useTls = strncmp(SERVER_URL, "https://", 8) == 0;

  WiFiClient plainClient;
  WiFiClientSecure secureClient;
  WiFiClient *client = &plainClient;

  if (useTls) {
    // TODO: pin the server CA for production hardening.
    secureClient.setInsecure();
    client = &secureClient;
  }

  HTTPClient http;
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setUserAgent("smart-plant-watering/1.0 (ESP32)");

  if (!http.begin(*client, SERVER_URL)) {
    Serial.printf("%s begin() failed — check SERVER_URL.\n",
                  useTls ? "HTTPS" : "HTTP");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-api-key", API_KEY);

  const int statusCode = http.POST(String(payload));

  if (statusCode > 0) {
    String response = http.getString();
    response.trim();
    if (response.length() > 300) {
      response = response.substring(0, 300) + "...";
    }

    Serial.printf("POST %s -> HTTP %d\n", SERVER_URL, statusCode);
    if (response.length() > 0) {
      Serial.printf("Response: %s\n", response.c_str());
    }
  } else {
    Serial.printf("POST failed: %s\n",
                  http.errorToString(statusCode).c_str());
  }

  http.end();
  client->stop();

  return statusCode >= 200 && statusCode < 300;
}

[[noreturn]] void goToSleep() {
  Serial.printf("Deep sleep for %u seconds.\n",
                static_cast<unsigned>(SLEEP_SECONDS));
  Serial.flush();

  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);

  esp_sleep_enable_timer_wakeup(
      static_cast<uint64_t>(SLEEP_SECONDS) * 1000000ULL);
  esp_deep_sleep_start();

  // Deep sleep should never return; keep the compiler satisfied if it does.
  while (true) {
    delay(1000);
  }
}

// ============================================================================
// Arduino lifecycle
// ============================================================================

void setup() {
  Serial.begin(SERIAL_BAUD);
  delay(300);

  bootCount++;
  Serial.println();
  Serial.println("==============================================");
  Serial.println(" Smart Plant Watering — ESP32 telemetry node");
  Serial.println("==============================================");
  Serial.printf("Boot #%lu | wake cause: %s\n",
                static_cast<unsigned long>(bootCount),
                wakeCauseToString(esp_sleep_get_wakeup_cause()));

  if (!configurationLooksValid()) {
    Serial.println(
        "Configuration incomplete. Set WIFI_SSID, WIFI_PASS, SERVER_URL, "
        "API_KEY and DEVICE_ID before flashing.");
    goToSleep();
  }

  if (strncmp(SERVER_URL, "http://", 7) == 0) {
    Serial.println(
        "WARNING: SERVER_URL uses plain HTTP. Use HTTPS for production.");
  }

  // GPIO34 is input-only. 12-bit resolution + 11 dB attenuation covers the
  // 0–3.3 V range of the capacitive sensor.
  pinMode(SENSOR_PIN, INPUT);
  analogReadResolution(12);
  analogSetAttenuation(ADC_11db);
  delay(20);  // Let the ADC input settle after wake.

  const uint16_t raw = readAveragedRaw();
  const bool sensorFault = (raw <= 50) || (raw >= 4090);
  const float moisture = sensorFault ? 0.0f : rawToMoisture(raw);

  Serial.printf("Raw ADC: %u | Moisture: %.1f%% | Sensor fault: %s\n",
                static_cast<unsigned>(raw),
                moisture,
                sensorFault ? "yes" : "no");

  if (!connectWifi()) {
    Serial.println("Skipping upload; sleeping to conserve power.");
    goToSleep();
  }

  const int rssi = static_cast<int>(WiFi.RSSI());

  char payload[JSON_BUFFER_SIZE];
  const int written = snprintf(
      payload,
      sizeof(payload),
      "{\"deviceId\":\"%s\",\"raw\":%u,\"moisture\":%.1f,\"rssi\":%d}",
      DEVICE_ID,
      static_cast<unsigned>(raw),
      moisture,
      rssi);

  if (written <= 0 || written >= static_cast<int>(sizeof(payload))) {
    Serial.println("JSON payload overflow; sleeping.");
    goToSleep();
  }

  Serial.printf("Payload: %s\n", payload);
  const bool sent = postReading(payload);
  Serial.println(sent ? "Upload complete." : "Upload failed; not queued.");

  goToSleep();
}

void loop() {
  // setup() always ends in deep sleep. This is only a safety net.
  delay(1000);
}
