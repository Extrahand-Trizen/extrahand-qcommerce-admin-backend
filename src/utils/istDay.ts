/**
 * The IST (Asia/Kolkata) calendar day for a given instant, as "YYYY-MM-DD".
 *
 * India observes no DST, so a fixed +05:30 offset is exact. Used by the Track B
 * rejection-cycle bookkeeping to decide when a new day has started (midnight IST
 * resets the daily + cycle counters).
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function istDayString(d: Date = new Date()): string {
  return new Date(d.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function getCurrentISTTime(d: Date = new Date()): {
  dateStr: string;
  hours: number;
  minutes: number;
  currentMinutesOfDay: number;
} {
  const istDate = new Date(d.getTime() + IST_OFFSET_MS);
  const dateStr = istDate.toISOString().slice(0, 10);
  const hours = istDate.getUTCHours();
  const minutes = istDate.getUTCMinutes();
  const currentMinutesOfDay = hours * 60 + minutes;
  return { dateStr, hours, minutes, currentMinutesOfDay };
}

export function parseTimeToMinutesOfDay(timeStr?: string | null): number {
  if (!timeStr || typeof timeStr !== 'string') return 0;
  const trimmed = timeStr.trim().toUpperCase();
  if (trimmed === 'ALL DAY' || trimmed === '24/7') return 0;

  // Match 12-hour format e.g. "10:00 AM", "9:30PM", "12:00 PM", "10 AM"
  const match12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (match12) {
    let hours = parseInt(match12[1], 10);
    const minutes = match12[2] ? parseInt(match12[2], 10) : 0;
    const meridian = match12[3];
    if (meridian === 'AM' && hours === 12) hours = 0;
    if (meridian === 'PM' && hours < 12) hours += 12;
    return hours * 60 + minutes;
  }

  // Match 24-hour format e.g. "10:00", "09:30", "14:45"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (match24) {
    const hours = parseInt(match24[1], 10);
    const minutes = parseInt(match24[2], 10);
    return hours * 60 + minutes;
  }

  return 0;
}

export function getAsiaKolkataDayBounds(d: Date = new Date()): { startOfDay: Date; endOfDay: Date } {
  const dayStr = istDayString(d);
  const startOfDay = new Date(`${dayStr}T00:00:00.000+05:30`);
  const endOfDay = new Date(`${dayStr}T23:59:59.999+05:30`);
  return { startOfDay, endOfDay };
}


