/**
 * Which stored videos may be deleted, and which may never be.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Video storage is the platform's one unbounded cost: a free account that
 * uploads and walks away keeps costing money forever. The client's instinct was
 * to delete every file 30 days after upload. That collides with a decision she
 * made earlier — lapsed accounts keep their profile and videos so they can
 * reactivate by paying — and it deletes the only reason to come back.
 *
 * The agreed policy, and what this module encodes:
 *
 *   paying subscriber      never expires
 *   free access lapsed     eligible GRACE_DAYS after the free window ended
 *   embedded anywhere      never expires, whatever the account did
 *   licensed by anyone     never expires, whatever the account did
 *
 * ── The order of the rules is the safety property ────────────────────────────
 * Protection is evaluated BEFORE eligibility, not after. A video embedded on a
 * magazine's page is protected because it is embedded — not because we also
 * happened to notice the account was still paying. Read the other way round,
 * one lapsed account is enough to take a publisher's live page dark mid-campaign
 * and stop the attribution that pays them, which costs more than the storage
 * ever saved.
 *
 * ── Deliberately blunt about embeds ──────────────────────────────────────────
 * "Embedded" means an embed_deployments row exists AT ALL, not one seen
 * recently. lastSeenAt only advances when someone loads the page, so a live
 * page with no traffic this month looks identical to a page that was taken
 * down — and the two failure modes are not symmetrical. Nothing is lost by
 * keeping a file we could have deleted; a broken embed on someone else's site
 * is not recoverable by us at all.
 */

/** How long after a free window closes the account keeps its videos. */
export const DEFAULT_GRACE_DAYS = 60;

export interface RetentionCandidate {
  videoId: string;
  userId: string;
  /** Stored delivery URL — what the host is asked to delete. */
  videoUrl: string;
  /**
   * When this account's free access ended. Null means it never had a free
   * window that closed, which includes active subscribers: the query that
   * builds candidates excludes them, and this is the second line of defence.
   */
  freeAccessEndedAt: Date | null;
  /** Embed deployments recorded for this video, ever. */
  embedCount: number;
  /** Paid licenses taken on this video, ever. */
  licenseCount: number;
}

export type RetentionVerdict =
  | { delete: false; reason: string }
  | { delete: true; reason: string };

export function judgeRetention(
  c: RetentionCandidate,
  now: Date,
  graceDays: number = DEFAULT_GRACE_DAYS,
): RetentionVerdict {
  // Protection first — see the header. These outrank every account state.
  if (c.embedCount > 0) {
    return { delete: false, reason: "embedded on a publisher site" };
  }
  if (c.licenseCount > 0) {
    return { delete: false, reason: "licensed by a buyer" };
  }

  if (!c.freeAccessEndedAt) {
    return { delete: false, reason: "no closed free window" };
  }

  const eligibleAt = addDays(c.freeAccessEndedAt, graceDays);
  if (now < eligibleAt) {
    return { delete: false, reason: `within the ${graceDays}-day grace period` };
  }

  return { delete: true, reason: `lapsed ${graceDays}+ days, unpaid, not embedded` };
}

export function addDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * 86_400_000);
}

/**
 * Deleting media is irreversible, so it stays off until switched on
 * deliberately — the same posture as SCHEDULER_ENABLED and the overage job's
 * per-plan billing gate. Absent or anything other than "true" is a dry run:
 * the job reports exactly what it WOULD delete and touches nothing.
 */
export function deletionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.RETENTION_DELETE_ENABLED === "true";
}
