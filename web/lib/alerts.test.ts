import { describe, expect, it } from "vitest";
import { decideAlert } from "./alerts";
import type { ReadingPayload } from "./types";

const NOW = new Date("2026-01-01T12:00:00.000Z");
const ONE_HOUR_AGO = new Date(NOW.getTime() - 60 * 60 * 1000).toISOString();
const SEVEN_HOURS_AGO = new Date(
  NOW.getTime() - 7 * 60 * 60 * 1000,
).toISOString();

function payload(overrides: Partial<ReadingPayload> = {}): ReadingPayload {
  return {
    deviceId: "plant-01",
    raw: 2400,
    moisture: 25,
    rssi: -61,
    ...overrides,
  };
}

describe("decideAlert", () => {
  it("alerts on the first dry reading", () => {
    const decision = decideAlert(
      payload(),
      { lastAlertType: null, lastAlertAt: null },
      NOW,
    );

    expect(decision.nextState).toBe("DRY");
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe("DRY");
    expect(decision.message).toContain("25.0%");
  });

  it("suppresses a repeated dry alert inside the cooldown", () => {
    const decision = decideAlert(
      payload(),
      { lastAlertType: "DRY", lastAlertAt: ONE_HOUR_AGO },
      NOW,
    );

    expect(decision.nextState).toBe("DRY");
    expect(decision.shouldNotify).toBe(false);
    expect(decision.message).toBeNull();
  });

  it("sends a reminder after six hours of persistent dryness", () => {
    const decision = decideAlert(
      payload(),
      { lastAlertType: "DRY", lastAlertAt: SEVEN_HOURS_AGO },
      NOW,
    );

    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe("DRY");
  });

  it("alerts when the previous state was not DRY even inside the cooldown", () => {
    const decision = decideAlert(
      payload(),
      { lastAlertType: "NORMAL", lastAlertAt: ONE_HOUR_AGO },
      NOW,
    );

    expect(decision.shouldNotify).toBe(true);
  });

  it("keeps DRY state inside the hysteresis band", () => {
    const decision = decideAlert(
      payload({ moisture: 35, raw: 2300 }),
      { lastAlertType: "DRY", lastAlertAt: ONE_HOUR_AGO },
      NOW,
    );

    expect(decision.nextState).toBe("DRY");
    expect(decision.shouldNotify).toBe(false);
  });

  it("treats the hysteresis band as NORMAL when recovering", () => {
    const decision = decideAlert(
      payload({ moisture: 35, raw: 2300 }),
      { lastAlertType: "NORMAL", lastAlertAt: null },
      NOW,
    );

    expect(decision.nextState).toBe("NORMAL");
    expect(decision.shouldNotify).toBe(false);
  });

  it("resets to NORMAL above the recovery threshold", () => {
    const decision = decideAlert(
      payload({ moisture: 45, raw: 2200 }),
      { lastAlertType: "DRY", lastAlertAt: ONE_HOUR_AGO },
      NOW,
    );

    expect(decision.nextState).toBe("NORMAL");
    expect(decision.shouldNotify).toBe(false);
  });

  it("alerts on a disconnected sensor", () => {
    const decision = decideAlert(
      payload({ raw: 4095, moisture: 0 }),
      { lastAlertType: "NORMAL", lastAlertAt: null },
      NOW,
    );

    expect(decision.nextState).toBe("FAULT");
    expect(decision.shouldNotify).toBe(true);
    expect(decision.reason).toBe("FAULT");
    expect(decision.message).toContain("Sensor Fault");
  });

  it("suppresses repeated fault alerts inside the cooldown", () => {
    const decision = decideAlert(
      payload({ raw: 10, moisture: 0 }),
      { lastAlertType: "FAULT", lastAlertAt: ONE_HOUR_AGO },
      NOW,
    );

    expect(decision.nextState).toBe("FAULT");
    expect(decision.shouldNotify).toBe(false);
  });

  it("recovers from FAULT once valid readings return", () => {
    const decision = decideAlert(
      payload({ moisture: 35, raw: 2300 }),
      { lastAlertType: "FAULT", lastAlertAt: ONE_HOUR_AGO },
      NOW,
    );

    expect(decision.nextState).toBe("NORMAL");
    expect(decision.shouldNotify).toBe(false);
  });
});
