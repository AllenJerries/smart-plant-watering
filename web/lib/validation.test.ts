import { describe, expect, it } from "vitest";
import { isValidDeviceId, parseReadingPayload } from "./validation";

describe("parseReadingPayload", () => {
  it("accepts a valid ESP32 payload", () => {
    const result = parseReadingPayload({
      deviceId: "plant-01",
      raw: 2150,
      moisture: 50.04,
      rssi: -63,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({
        deviceId: "plant-01",
        raw: 2150,
        moisture: 50.04,
        rssi: -63,
      });
    }
  });

  it("treats a missing rssi as null", () => {
    const result = parseReadingPayload({
      deviceId: "plant-01",
      raw: 2150,
      moisture: 50,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.rssi).toBeNull();
  });

  it("rejects invalid device ids", () => {
    const result = parseReadingPayload({
      deviceId: "plant 01!",
      raw: 2150,
      moisture: 50,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects out-of-range raw values", () => {
    const result = parseReadingPayload({
      deviceId: "plant-01",
      raw: 5000,
      moisture: 50,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects non-integer raw values", () => {
    const result = parseReadingPayload({
      deviceId: "plant-01",
      raw: 123.4,
      moisture: 50,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects string moisture values", () => {
    const result = parseReadingPayload({
      deviceId: "plant-01",
      raw: 2150,
      moisture: "50",
    });

    expect(result.ok).toBe(false);
  });

  it("rejects positive rssi values", () => {
    const result = parseReadingPayload({
      deviceId: "plant-01",
      raw: 2150,
      moisture: 50,
      rssi: 10,
    });

    expect(result.ok).toBe(false);
  });

  it("rejects non-object bodies", () => {
    expect(parseReadingPayload(null).ok).toBe(false);
    expect(parseReadingPayload([]).ok).toBe(false);
    expect(parseReadingPayload("hello").ok).toBe(false);
  });
});

describe("isValidDeviceId", () => {
  it("accepts safe slugs", () => {
    expect(isValidDeviceId("plant-01")).toBe(true);
    expect(isValidDeviceId("BALCONY_2")).toBe(true);
  });

  it("rejects unsafe values", () => {
    expect(isValidDeviceId("")).toBe(false);
    expect(isValidDeviceId("-plant")).toBe(false);
    expect(isValidDeviceId("plant/01")).toBe(false);
    expect(isValidDeviceId("a".repeat(65))).toBe(false);
  });
});
