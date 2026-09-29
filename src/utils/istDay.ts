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

export function getAsiaKolkataDayBounds(d: Date = new Date()): { startOfDay: Date; endOfDay: Date } {
  const dayStr = istDayString(d);
  const startOfDay = new Date(`${dayStr}T00:00:00.000+05:30`);
  const endOfDay = new Date(`${dayStr}T23:59:59.999+05:30`);
  return { startOfDay, endOfDay };
}

