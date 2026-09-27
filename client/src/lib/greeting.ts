/**
 * The dashboard's opening line. Specific beats generic: "Good afternoon,
 * Miro" with today's date says the page knows who is looking and when,
 * where "Dashboard / Manage your video commerce platform" said nothing.
 */
export function greeting(
  name: string | null | undefined,
  now: Date = new Date(),
  opts: { fullName?: boolean } = {},
): string {
  const h = now.getHours();
  const part = h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  // People get their first name; a brand's account name is a company
  // ("Maison Demo"), and cutting it to "Maison" reads as a mistake.
  const shown = opts.fullName ? (name || "").trim() : (name || "").trim().split(/\s+/)[0];
  return shown ? `${part}, ${shown}` : part;
}

/** "Saturday, 27 September" in the viewer's locale. */
export function todayLabel(now: Date = new Date()): string {
  return now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
}

/** "1 – 27 Sep": the month-to-date window the stats cover. */
export function monthToDateLabel(now: Date = new Date()): string {
  const month = now.toLocaleDateString(undefined, { month: "short" });
  return `1 – ${now.getDate()} ${month}`;
}
