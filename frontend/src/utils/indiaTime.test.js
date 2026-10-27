import {
  formatIndiaDateTimeLocal,
  getIndiaDateKey,
  indiaDateTimeLocalToISOString
} from "./indiaTime";

describe("India timezone helpers", () => {
  it("uses the IST calendar date rather than UTC date for date keys", () => {
    expect(getIndiaDateKey(new Date("2026-10-27T20:00:00.000Z"))).toBe("2026-10-28");
  });

  it("round-trips an IST datetime-local value to an absolute instant", () => {
    const instant = indiaDateTimeLocalToISOString("2026-11-02T09:30");

    expect(instant).toBe("2026-11-02T04:00:00.000Z");
    expect(formatIndiaDateTimeLocal(instant)).toBe("2026-11-02T09:30");
  });

  it("rejects invalid IST calendar dates", () => {
    expect(indiaDateTimeLocalToISOString("2026-02-30T09:30")).toBeNull();
  });
});
