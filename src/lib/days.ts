// Days as "2026-10-19" strings, in the user's time zone, for the job agent's
// daily schedule.

/** A day as "2026-10-19". */
export type Day = string;

/** The day a moment falls on in a time zone. */
export function dayOf(moment: Date, timeZone: string): Day {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(moment).map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

/** The day `count` days after `day` (before, when negative). */
export function addDays(day: Day, count: number): Day {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + count)).toISOString().slice(0, 10);
}
