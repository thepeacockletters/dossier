import { describe, expect, it } from "vitest";

import { addDays, dayOf } from "./days";

describe("days", () => {
  it("reads the day in the user's time zone", () => {
    expect(dayOf(new Date("2026-10-18T23:30:00Z"), "Europe/Berlin")).toBe("2026-10-19");
    expect(dayOf(new Date("2026-10-18T23:30:00Z"), "America/New_York")).toBe("2026-10-18");
  });

  it("counts days across months and years", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});
