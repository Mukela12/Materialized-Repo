/**
 * What a detection job says about itself, in words the uploader sees. Shared,
 * so the upload modal recognises each case by the same text the server stores.
 */

/** Every tagged brand is not live yet or has no products: nothing to look for. */
export const NO_CATALOG_NOTE =
  "None of the tagged brands have products the AI can look for yet";

/** The model could not be reached for any frame (key, model, network). */
export const SCAN_FAILED_NOTE = "The AI scan couldn't run";

/** A scan left processing by a restart or crash, found when someone next looks. */
export const SCAN_STALLED_NOTE = "The AI scan stopped before it finished";

/** How long a scan may sit in queued/processing before it counts as stalled. */
export const SCAN_STALL_MS = 10 * 60 * 1000;

/** A job still "running" long after it started was cut off (a deploy, a crash). */
export function isStalledScan(
  job: { status?: string | null; startedAt?: Date | string | null; createdAt?: Date | string | null },
  now: Date = new Date(),
): boolean {
  if (job.status !== "processing" && job.status !== "queued") return false;
  const since = job.startedAt ?? job.createdAt;
  if (!since) return false;
  const t = new Date(since).getTime();
  return Number.isFinite(t) && now.getTime() - t > SCAN_STALL_MS;
}
