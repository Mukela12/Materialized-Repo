/**
 * A very small cron matcher. No dependency, no daemon, ~60 lines, testable.
 *
 * Supports the five standard fields — minute, hour, day-of-month, month,
 * day-of-week — with `*`, a number, a comma list, a `a-b` range, and `*­/n`
 * steps. Everything is UTC, deliberately: a schedule that silently shifts twice
 * a year with British Summer Time is a schedule that pays people on the wrong
 * day, and "9am" is not worth that.
 *
 * WHY NOT node-cron
 *   A cron daemon fires only while the process is alive. If the server is
 *   restarting or redeploying at 09:00 on Monday the payout run is simply
 *   skipped, silently, until next week. `previousOccurrence` below lets the
 *   scheduler ask "when should this last have run?" and compare that against
 *   what actually did — so a missed window is caught up rather than lost.
 */

export interface CronSpec {
  minute: string;
  hour: string;
  dayOfMonth: string;
  month: string;
  dayOfWeek: string;
}

export function parseCron(expr: string): CronSpec {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Cron expression must have 5 fields, got ${parts.length}: "${expr}"`);
  }
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** Does one field match a value? Handles `*`, `n`, `a,b`, `a-b`, and `*​/n`. */
function fieldMatches(field: string, value: number): boolean {
  for (const term of field.split(",")) {
    if (term === "*") return true;

    const step = term.match(/^(\*|\d+-\d+)\/(\d+)$/);
    if (step) {
      const n = Number(step[2]);
      if (n <= 0) continue;
      if (step[1] === "*") {
        if (value % n === 0) return true;
        continue;
      }
      const [lo, hi] = step[1].split("-").map(Number);
      if (value >= lo && value <= hi && (value - lo) % n === 0) return true;
      continue;
    }

    const range = term.match(/^(\d+)-(\d+)$/);
    if (range) {
      if (value >= Number(range[1]) && value <= Number(range[2])) return true;
      continue;
    }

    if (/^\d+$/.test(term) && Number(term) === value) return true;
  }
  return false;
}

/** True when `date` (UTC) falls on a minute this expression selects. */
export function cronMatches(spec: CronSpec, date: Date): boolean {
  // Cron's day-of-week is 0-6 with both 0 and 7 meaning Sunday.
  const dow = date.getUTCDay();
  const dowMatches = fieldMatches(spec.dayOfWeek, dow) ||
    (dow === 0 && fieldMatches(spec.dayOfWeek, 7));

  // Standard cron quirk: when BOTH day-of-month and day-of-week are restricted,
  // the job runs if EITHER matches — not both. Getting this wrong turns
  // "1st of the month" plus "Mondays" into "only the 1st when it is a Monday".
  const domRestricted = spec.dayOfMonth !== "*";
  const dowRestricted = spec.dayOfWeek !== "*";
  const domMatches = fieldMatches(spec.dayOfMonth, date.getUTCDate());
  const dayOk = domRestricted && dowRestricted
    ? (domMatches || dowMatches)
    : (domMatches && dowMatches);

  return (
    fieldMatches(spec.minute, date.getUTCMinutes()) &&
    fieldMatches(spec.hour, date.getUTCHours()) &&
    fieldMatches(spec.month, date.getUTCMonth() + 1) &&
    dayOk
  );
}

/**
 * The most recent minute at or before `from` that this expression selects, or
 * null if there is none within `lookbackDays`.
 *
 * This is what makes a missed window recoverable: the scheduler compares this
 * against the last run it actually completed, rather than only firing when it
 * happens to be awake on the exact minute.
 */
export function previousOccurrence(
  spec: CronSpec,
  from: Date,
  lookbackDays = 40,
): Date | null {
  const cursor = new Date(from.getTime());
  cursor.setUTCSeconds(0, 0);
  const limit = lookbackDays * 24 * 60;
  for (let i = 0; i <= limit; i++) {
    if (cronMatches(spec, cursor)) return new Date(cursor.getTime());
    cursor.setUTCMinutes(cursor.getUTCMinutes() - 1);
  }
  return null;
}
