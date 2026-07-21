/**
 * Outbound-link attribution for embedded shoppable videos.
 *
 * When a viewer clicks a product in an embed, the link to the brand's store must
 * carry the video/publisher UTM so the resulting sale can be traced back (and later
 * reconciled or captured by a store webhook). Without this the internal click is
 * tracked but the hand-off to the store loses all attribution.
 */

/**
 * Append Materialized attribution params to an outbound product URL. Preserves any
 * existing query string and fragment. Returns the URL unchanged when there's no UTM
 * code, and null when there's no URL.
 */
export function appendUtm(url: string | null | undefined, utmCode: string): string | null {
  if (!url) return null;
  if (!utmCode) return url;

  const params: Array<[string, string]> = [
    ["utm_source", "materialized"],
    ["utm_medium", "shoppable_video"],
    ["utm_campaign", utmCode],
    ["mtrlzd_ref", utmCode],
  ];

  try {
    const u = new URL(url);
    for (const [k, v] of params) u.searchParams.set(k, v);
    return u.toString();
  } catch {
    // Relative or malformed URL — append manually, keeping any fragment last.
    const query = params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
    const hashIdx = url.indexOf("#");
    const base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
    const hash = hashIdx >= 0 ? url.slice(hashIdx) : "";
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}${query}${hash}`;
  }
}
