/**
 * What a voucher date means.
 *
 * The admin picks days, not instants: "starts 28 Sep", "expires 27 Nov". A day
 * has to become one instant, and the admin form used to send the bare
 * "2026-11-27" through `new Date()`, which is midnight UTC: 7pm in New York
 * on the 26th. Codes shown as expiring 27 Nov stopped working the evening
 * before, on Thanksgiving.
 *
 * The rule, the same one the invitation offer already uses (inviteVoucher.ts):
 *
 *  - The expiry day is the LAST day a code works. It is stored as 05:00 UTC
 *    the next morning, so the whole day is covered in every US timezone
 *    (midnight in New York in winter, 1am in summer, 9pm in Los Angeles).
 *  - The start day is stored as 05:00 UTC that morning, around midnight in
 *    New York.
 *
 * A full ISO instant (from a script or the API) is taken as given.
 */

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ROLLOVER_HOUR_UTC = 5;
const HOUR = 60 * 60 * 1000;

export type VoucherEdge = "start" | "end";

/** "2026-11-27" -> the instant that day starts (start) or ends (end). */
export function voucherDayToInstant(day: string, edge: VoucherEdge): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + (edge === "end" ? 1 : 0), ROLLOVER_HOUR_UTC));
}

/**
 * Parse a date from the admin. `undefined` stays undefined (leave alone),
 * null or "" is null (clear), a day or an ISO instant is a Date.
 */
export function parseVoucherDate(raw: unknown, edge: VoucherEdge): Date | null | undefined | { error: string } {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  if (typeof raw !== "string") return { error: "must be a date string or null" };
  const d = DAY.test(raw) ? voucherDayToInstant(raw, edge) : new Date(raw);
  return Number.isNaN(d.getTime()) ? { error: "must be a valid date" } : d;
}

/**
 * The day to show for a stored instant, as YYYY-MM-DD. For an expiry that is
 * the last day the code works: stepping back 6 hours lands 05:00 UTC on the
 * previous day, which is also what the invitation copy shows.
 */
export function voucherInstantToDay(instant: string | Date, edge: VoucherEdge): string {
  const t = new Date(instant).getTime();
  return new Date(edge === "end" ? t - 6 * HOUR : t).toISOString().slice(0, 10);
}
