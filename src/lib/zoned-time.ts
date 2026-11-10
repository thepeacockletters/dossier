// Wall-clock times in a time zone, DST included, without a date library.

/** The parts of `date` as a wall clock in `timeZone`. */
function wallClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  );
  const weekday = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1;
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: +parts.hour, minute: +parts.minute, second: +parts.second, weekday };
}

/** The instant a wall-clock time in `timeZone` is, DST included. */
export function zonedTime(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // Twice, so a guess on the other side of a DST change settles.
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const clock = wallClock(new Date(instant), timeZone);
    const offset = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute, clock.second) - instant;
    instant = guess - offset;
  }
  return new Date(instant);
}
