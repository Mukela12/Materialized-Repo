/**
 * Placement Review: the rules between AI detection and the live carousel.
 * See DETECTION_REVIEW.md and migrations/0037_detection_review.sql.
 *
 * Detection proposes placements; a person accepts, deletes (rejects) or sends
 * back to pending each one; only accepted placements can become overlays.
 */
import type { DetectionReviewStatus, VideoDetectionResult } from "@shared/schema";

export const REVIEW_STATUSES: readonly DetectionReviewStatus[] = ["pending", "accepted", "rejected"];

export interface ReviewRequest {
  status: DetectionReviewStatus;
  startTime?: string;
  endTime?: string;
}

/**
 * Validate a review from the client. Timing is optional (a correction made in
 * the inspector); when given it must be a sane window inside the video.
 */
export function parseReviewRequest(
  body: unknown,
  durationSeconds: number | null | undefined,
): ReviewRequest | { error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.status !== "string" || !REVIEW_STATUSES.includes(b.status as DetectionReviewStatus)) {
    return { error: "status must be pending, accepted or rejected" };
  }
  const out: ReviewRequest = { status: b.status as DetectionReviewStatus };

  const hasStart = b.startTime !== undefined && b.startTime !== null && b.startTime !== "";
  const hasEnd = b.endTime !== undefined && b.endTime !== null && b.endTime !== "";
  if (hasStart !== hasEnd) return { error: "startTime and endTime go together" };
  if (hasStart && hasEnd) {
    const start = Number(b.startTime);
    const end = Number(b.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) {
      return { error: "startTime and endTime must be seconds" };
    }
    if (end <= start) return { error: "endTime must be after startTime" };
    if (durationSeconds && start >= durationSeconds) {
      return { error: "startTime is past the end of the video" };
    }
    // Clamp rather than refuse: a window running past the end just ends with the video.
    const clampedEnd = durationSeconds ? Math.min(end, durationSeconds) : end;
    out.startTime = start.toFixed(2);
    out.endTime = clampedEnd.toFixed(2);
  }
  return out;
}

/**
 * Once a placement is on the carousel it is an overlay, edited and removed in
 * the overlay editor. Changing its review state here would claim to take it
 * off the carousel while leaving it live.
 */
export function reviewLocked(result: Pick<VideoDetectionResult, "importedAt">): boolean {
  return !!result.importedAt;
}

/** Results ready for "Add accepted to carousel". */
export function importable<T extends Pick<VideoDetectionResult, "reviewStatus" | "importedAt">>(results: T[]): T[] {
  return results.filter((r) => r.reviewStatus === "accepted" && !r.importedAt);
}

/**
 * Queue order: undecided first (that is the work), then accepted, then
 * rejected; within each, most confident first, as in the prototype.
 */
export function queueOrder<T extends Pick<VideoDetectionResult, "reviewStatus" | "confidence">>(results: T[]): T[] {
  const rank: Record<DetectionReviewStatus, number> = { pending: 0, accepted: 1, rejected: 2 };
  return [...results].sort((a, b) =>
    rank[a.reviewStatus] - rank[b.reviewStatus] || Number(b.confidence) - Number(a.confidence));
}

export function reviewCounts(results: Pick<VideoDetectionResult, "reviewStatus" | "importedAt">[]) {
  return {
    pending: results.filter((r) => r.reviewStatus === "pending").length,
    accepted: results.filter((r) => r.reviewStatus === "accepted").length,
    rejected: results.filter((r) => r.reviewStatus === "rejected").length,
    readyToImport: importable(results).length,
  };
}

/** The stored JSON box, or null when missing or malformed. */
export function parseBoundingBox(raw: string | null): { x: number; y: number; width: number; height: number } | null {
  if (!raw) return null;
  try {
    const b = JSON.parse(raw);
    const nums = [b?.x, b?.y, b?.width, b?.height].map(Number);
    return nums.every(Number.isFinite) ? { x: nums[0], y: nums[1], width: nums[2], height: nums[3] } : null;
  } catch {
    return null;
  }
}
