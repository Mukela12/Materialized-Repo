/**
 * A product link as typed, made into one a browser can follow.
 *
 * People type "www.one30m.co". In a carousel that is a RELATIVE link, so the
 * tap went to www.mtrlzd.com/embed/www.one30m.co. Only http(s) is accepted;
 * anything else (javascript:, data:) is dropped rather than linked.
 */
export function normaliseLinkUrl(raw: unknown): string | null {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v.replace(/^\/+/, "")}`;
  try {
    const u = new URL(withScheme);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}
