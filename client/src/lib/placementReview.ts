/**
 * Client-side helpers for the Placement Review workspace. The rules about
 * what may reach the carousel live on the server (server/placementReview.ts);
 * these only decide what the workspace shows and where it goes next.
 */
export type ReviewStatus = "pending" | "accepted" | "rejected";

export interface Placement {
  id: string;
  productId: string;
  brandId: string;
  confidence: string;
  frameTimestamp: string;
  startTime: string | null;
  endTime: string | null;
  boundingBox: { x: number; y: number; width: number; height: number } | null;
  reviewStatus: ReviewStatus;
  importedAt: string | null;
  product: { id: string; name: string; imageUrl: string | null; price: string | null; productUrl: string | null } | null;
  brandName: string | null;
}

export interface ReviewJob {
  id?: string;
  status: "none" | "queued" | "processing" | "completed" | "failed";
  /** Why a scan ended the way it did (no catalog, failed, stalled). */
  error?: string | null;
  results: Placement[];
  counts: { pending: number; accepted: number; rejected: number; readyToImport: number };
}

/** Words on the screen. "Deleted" is the prototype's word for a rejection. */
export const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending: "To review",
  accepted: "Accepted",
  rejected: "Deleted",
};

/** 0:06, 1:04, 12:30 */
export function formatTime(seconds: number | string | null | undefined): string {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Confidence as a whole percentage. */
export function matchPercent(confidence: string | number): number {
  return Math.round(Math.min(1, Math.max(0, Number(confidence) || 0)) * 100);
}

/**
 * After a decision, the next placement still waiting, looking forward from
 * the one just decided and wrapping round; the same one if nothing is left.
 */
export function nextPendingId(queue: Pick<Placement, "id" | "reviewStatus">[], currentId: string | null): string | null {
  if (queue.length === 0) return null;
  const start = Math.max(0, queue.findIndex((p) => p.id === currentId));
  for (let i = 1; i <= queue.length; i++) {
    const p = queue[(start + i) % queue.length];
    if (p.reviewStatus === "pending" && p.id !== currentId) return p.id;
  }
  return currentId;
}

/** Where a placement sits on the timeline, as percentages of the video. */
export function segment(start: string | null, end: string | null, duration: number): { left: number; width: number } | null {
  if (!duration || duration <= 0) return null;
  const s = Math.min(duration, Math.max(0, Number(start) || 0));
  const e = Math.min(duration, Math.max(s, Number(end) || s));
  // A zero-length window (the metadata fallback stores 0-0) still gets a visible tick.
  const width = Math.max(((e - s) / duration) * 100, 1.2);
  return { left: Math.min((s / duration) * 100, 100 - width), width };
}

/**
 * Stack overlapping placements into lanes, so two products on screen at once
 * are two bars instead of one hiding the other. Greedy by start time: each
 * placement takes the first lane that is free when it starts.
 */
export function assignLanes(placements: Pick<Placement, "id" | "startTime" | "endTime">[]): { lanes: Map<string, number>; count: number } {
  const sorted = [...placements].sort((a, b) => Number(a.startTime) - Number(b.startTime));
  const laneEnds: number[] = [];
  const lanes = new Map<string, number>();
  for (const p of sorted) {
    const s = Number(p.startTime) || 0;
    const e = Math.max(s, Number(p.endTime) || s);
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    lanes.set(p.id, lane);
  }
  return { lanes, count: Math.max(1, laneEnds.length) };
}

/**
 * The brands in a queue, for the brand filter: each with how many placements
 * it has, in name order. The filter only appears when there are two or more.
 */
export function brandFilterOptions(
  queue: Pick<Placement, "brandId" | "brandName" | "reviewStatus">[],
): { id: string; name: string; count: number; pending: number }[] {
  const byId = new Map<string, { id: string; name: string; count: number; pending: number }>();
  for (const p of queue) {
    const b = byId.get(p.brandId) ?? { id: p.brandId, name: p.brandName ?? "Unknown brand", count: 0, pending: 0 };
    b.count++;
    if (p.reviewStatus === "pending") b.pending++;
    byId.set(p.brandId, b);
  }
  return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/** The queue as the brand filter shows it ("all" or one brand's id). */
export function filterByBrand<T extends Pick<Placement, "brandId">>(queue: T[], brandId: string): T[] {
  return brandId === "all" ? queue : queue.filter((p) => p.brandId === brandId);
}
