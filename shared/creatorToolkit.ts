/**
 * The Creator Toolkit on the creator homepage (client, 18 Nov 2026): two
 * cards promoting partner tools (a video explaining the tool, a tracked
 * sign-up link and an optional voucher code), the monthly Creator Challenge,
 * and a full-width banner for the Creator Film Awards. Admin edits all of it
 * (Admin > Homepage); server/creatorToolkit.ts stores and validates it.
 */
import { z } from "zod";

const text = (max: number) => z.string().trim().max(max);
/** Optional https link; blank is allowed and means "none". */
const link = z.string().trim().max(1000).refine((v) => v === "" || /^https:\/\/[^\s]+$/i.test(v), "Use a full https:// link");

export const toolCardSchema = z.object({
  enabled: z.boolean(),
  name: text(60),
  tagline: text(160),
  /** A video that explains the tool (mp4, or any https video link). */
  videoUrl: link,
  /** Shown before the video plays; optional. */
  posterUrl: link,
  ctaLabel: text(40),
  /** The partner's referral or sign-up link. Clicks go through MTRLZD so they are counted. */
  linkUrl: link,
  voucherCode: text(40),
});
export type ToolCard = z.infer<typeof toolCardSchema>;

export const challengeSchema = z.object({
  enabled: z.boolean(),
  title: text(80),
  prize: text(40),
  body: text(400),
});
export type ChallengeCard = z.infer<typeof challengeSchema>;

export const awardsSchema = z.object({
  enabled: z.boolean(),
  title: text(80),
  place: text(80),
  dates: text(60),
  /** Short lines, one per highlight. */
  highlights: z.array(text(80)).max(6),
  videoUrl: link,
  posterUrl: link,
});
export type AwardsBanner = z.infer<typeof awardsSchema>;

export const toolkitSchema = z.object({
  tools: z.array(toolCardSchema).length(2),
  challenge: challengeSchema,
  awards: awardsSchema,
});
export type CreatorToolkit = z.infer<typeof toolkitSchema>;

const emptyTool: ToolCard = { enabled: false, name: "", tagline: "", videoUrl: "", posterUrl: "", ctaLabel: "Sign up", linkUrl: "", voucherCode: "" };

/** What shows before admin has edited anything: the challenge and the awards, no tools. */
export const DEFAULT_TOOLKIT: CreatorToolkit = {
  tools: [{ ...emptyTool }, { ...emptyTool }],
  challenge: {
    enabled: true,
    title: "Creator Challenge",
    prize: "$2,000",
    body: "Upload a video, tick Enter Creator Challenge, publish and share it with your audience. The most views, clicks, sales and reposts wins the cash prize.",
  },
  awards: {
    enabled: true,
    title: "Creator Film Awards",
    place: "At the Cannes Film Festival",
    dates: "May 11 to 22, 2027",
    highlights: ["Over $125,000 in prizes", "International media", "Red carpet", "Private mansion party", "Interactive video entries"],
    videoUrl: "",
    posterUrl: "",
  },
};

/** A tool card is shown only when it is switched on and has a name and a link. */
export function toolIsLive(t: ToolCard): boolean {
  return t.enabled && t.name.trim() !== "" && t.linkUrl.trim() !== "";
}

// ─── The challenge calendar ───────────────────────────────────────────────────

/** Entries open on the 1st and close at the end of the 15th (UTC). */
export const ENTRY_LAST_DAY = 15;

/** "YYYY-MM" of an instant, in UTC. */
export function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

/**
 * This month's challenge: whether entries are open now, when they close, and
 * when the winner is announced (the 15th of the following month, after 28
 * days of data).
 */
export function challengeStatus(now: Date = new Date()): { month: string; open: boolean; opensAt: string; closesAt: string; announceAt: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const opensAt = new Date(Date.UTC(y, m, 1));
  const closesAt = new Date(Date.UTC(y, m, ENTRY_LAST_DAY + 1));
  const announceAt = new Date(Date.UTC(y, m + 1, 15));
  const open = now.getTime() >= opensAt.getTime() && now.getTime() < closesAt.getTime();
  return { month: monthKey(now), open, opensAt: opensAt.toISOString(), closesAt: closesAt.toISOString(), announceAt: announceAt.toISOString() };
}

/** The window a month's entries are judged on: the 1st of that month to the 15th of the next. */
export function judgingWindow(month: string): { from: Date; to: Date } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  if (mo < 0 || mo > 11) return null;
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 15)) };
}

export const filmAwardRegistrationSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  handle: z.string().trim().min(1, "Add your handle").max(80).regex(/^@?[A-Za-z0-9._-]+$/, "Letters, numbers, dots, dashes and underscores only"),
});
