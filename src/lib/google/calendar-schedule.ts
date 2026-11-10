import "server-only";

import { logServerError } from "@/lib/log";

import { googleConnection } from "./account";
import { pullInterviewEvents } from "./availability";

// Interviews moved or deleted in Google Calendar come back into Dossier on a
// timer in the process, as well as when a page that shows them loads. Run a
// single instance of the app.

const INTERVAL_MS = 10 * 60_000;
/** The first check after a start, rather than a whole interval later: the computer may have been off (#325). */
const FIRST_CHECK_AFTER_MS = 60_000;

const globalForCalendar = globalThis as unknown as { calendarTimer?: ReturnType<typeof setTimeout>; calendarRunning?: boolean };

/** One check, unless one is running or Google refuses the saved access (#136). */
async function check(): Promise<void> {
  if (globalForCalendar.calendarRunning) return;
  globalForCalendar.calendarRunning = true;
  try {
    const connection = await googleConnection();
    if (connection.status === "connected" && !connection.signInProblem) await pullInterviewEvents();
  } catch (error) {
    logServerError("calendar check", error);
  } finally {
    globalForCalendar.calendarRunning = false;
  }
}

/** Starts the calendar timer, once per process (dev reloads keep the one they have). */
export function startCalendarSchedule(): void {
  if (globalForCalendar.calendarTimer) return;
  const schedule = (delay: number) => {
    globalForCalendar.calendarTimer = setTimeout(() => void check().finally(() => schedule(INTERVAL_MS)), delay);
    globalForCalendar.calendarTimer.unref?.();
  };
  schedule(FIRST_CHECK_AFTER_MS);
}
