import { describe, expect, it } from "vitest";

import { zonedTime } from "./zoned-time";

describe("zonedTime", () => {
  it("turns a wall-clock time into an instant, across DST", () => {
    expect(zonedTime(2026, 10, 20, 9, 0, "Europe/Berlin").toISOString()).toBe("2026-10-20T07:00:00.000Z");
    // After the switch to winter time on 25 October.
    expect(zonedTime(2026, 10, 26, 9, 0, "Europe/Berlin").toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(zonedTime(2026, 10, 20, 9, 0, "America/New_York").toISOString()).toBe("2026-10-20T13:00:00.000Z");
  });
});
