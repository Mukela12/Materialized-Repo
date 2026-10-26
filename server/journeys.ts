/**
 * Email journeys: the rules, with no database and no mail client, so they can
 * be tested on their own. The store (server/journeyStore.ts) gathers people
 * and facts; this decides what each person gets, when, and what it says.
 *
 * The client's brief (the "MTRLZD DEV" doc, Oct 2026): 12 emails per audience,
 * on a day schedule, where "behavioural events should override" the timing.
 * Here that means each email has a day and a condition, and it goes on the
 * first run after its day on which the condition holds. If the condition still
 * doesn't hold LATE_DAYS later, it is skipped for good rather than arriving
 * out of context a week on.
 */
import { escapeHtml } from "./programInvites";

export const SEGMENTS = [
  "creators", "brands", "publishers", "talent_agencies", "brand_agencies", "fashion_weeks", "film_festivals",
] as const;
export type Segment = (typeof SEGMENTS)[number];

/** Without a partner mapping or an admin override, the account type decides. */
export function defaultSegment(role: string): Segment {
  return role === "brand" ? "brands" : role === "affiliate" ? "publishers" : "creators";
}

/** What the app knows about a person, for deciding which emails apply. */
export interface Facts {
  uploads: number;
  brandTagged: boolean;
  products: number;
  invitesSent: number;
  invitesJoined: number;
  inviteeUploads: number;
  subscribed: boolean;
  /** On the paid plan: subscribed and past the trial (server/inviteVoucher.ts isPayingBrand). */
  paying?: boolean;
  lastSeenAt: Date | null;
}

export const CONDITIONS: Record<string, { label: string; test: (f: Facts, now: Date) => boolean }> = {
  always: { label: "Everyone", test: () => true },
  no_upload: { label: "Hasn't uploaded a video", test: (f) => f.uploads === 0 },
  has_upload: { label: "Has uploaded a video", test: (f) => f.uploads > 0 },
  uploaded_not_tagged: { label: "Uploaded, but hasn't tagged a brand", test: (f) => f.uploads > 0 && !f.brandTagged },
  under_2_uploads: { label: "Fewer than 2 uploads", test: (f) => f.uploads < 2 },
  under_4_uploads: { label: "Fewer than 4 uploads", test: (f) => f.uploads < 4 },
  no_brand_tagged: { label: "Hasn't tagged a brand", test: (f) => !f.brandTagged },
  brand_tagged: { label: "Has tagged a brand", test: (f) => f.brandTagged },
  no_products: { label: "No products added yet", test: (f) => f.products === 0 },
  no_invites_sent: { label: "Hasn't sent any invites", test: (f) => f.invitesSent === 0 },
  invites_sent: { label: "Has sent invites", test: (f) => f.invitesSent > 0 },
  no_invites_joined: { label: "No one they invited has joined", test: (f) => f.invitesJoined === 0 },
  invites_joined: { label: "Someone they invited has joined", test: (f) => f.invitesJoined > 0 },
  invitee_uploaded: { label: "Someone they invited has uploaded", test: (f) => f.inviteeUploads > 0 },
  not_subscribed: { label: "Not on a paid plan", test: (f) => !f.subscribed },
  not_paying: { label: "Not paying yet (no plan, or still in the trial)", test: (f) => !f.paying },
  inactive_7d: {
    label: "Not seen in 7 days",
    test: (f, now) => !f.lastSeenAt || now.getTime() - f.lastSeenAt.getTime() > 7 * DAY,
  },
  needs_feature: { label: "Paused: needs a feature the app doesn't have", test: () => false },
};

export const ANCHORS = {
  signup: "Days after sign-up",
  trial_end: "Days from the end of the free period",
  inactive: "Days without visiting",
} as const;

const DAY = 86_400_000;
/** How long past its day an email may still go, if its condition comes true. */
export const LATE_DAYS = 3;
/** At most one journey email per person in this many hours. */
export const MIN_GAP_HOURS = 20;
/** Accounts made this long before a journey is switched on still join it. */
export const ENROL_GRACE_DAYS = 2;

export interface Step {
  id: string; segment: string; position: number; anchor: string; day: number; condition: string;
  subject: string; body: string; ctaLabel: string | null; ctaPath: string | null; enabled: boolean;
  /** Sent without the logo and layout, like a personal email. Spam filters are kinder to these. */
  plain?: boolean;
}

export interface PersonClock {
  createdAt: Date; freeAccessUntil: Date | null; lastSeenAt?: Date | null;
  /** When the trial on their paid plan ends, if they have started one (the 30-day Stripe trial). */
  planTrialEndsAt?: Date | null;
}

/** An "inactive" reminder goes again only after the person came back and drifted off, and not within this many days. */
export const REPEAT_GAP_DAYS = 7;

/**
 * When a step is due for one person. "Trial end" falls back to 30 days after
 * sign-up for anyone without a free period, which is what the doc assumes.
 */
export function dueAt(step: Pick<Step, "anchor" | "day">, p: PersonClock): Date {
  const base = step.anchor === "trial_end"
    ? (p.planTrialEndsAt ?? p.freeAccessUntil ?? new Date(p.createdAt.getTime() + 30 * DAY))
    : p.createdAt;
  return new Date(base.getTime() + step.day * DAY);
}

export type Decision =
  | { action: "wait" }
  | { action: "send" }
  | { action: "skip"; reason: "late" | "condition" | "paused" };

/** What to do with one step for one person right now. */
export function decide(step: Step, p: PersonClock, facts: Facts, now: Date, lastSentAt: Date | null = null): Decision {
  if (step.anchor === "inactive") return decideInactive(step, p, facts, now, lastSentAt);
  const due = dueAt(step, p).getTime();
  if (now.getTime() < due) return { action: "wait" };
  const closes = due + LATE_DAYS * DAY;
  const paused = !step.enabled || step.condition === "needs_feature";
  const holds = !paused && (CONDITIONS[step.condition]?.test(facts, now) ?? false);
  if (holds) return now.getTime() <= closes ? { action: "send" } : { action: "skip", reason: "late" };
  if (now.getTime() <= closes) return { action: "wait" };
  return { action: "skip", reason: paused ? "paused" : "condition" };
}

/**
 * "We haven't seen you in N days." Not tied to a date, so it never goes stale
 * and is never skipped: it waits until the person has been away long enough.
 * It can go again, but only if they came back after the last one and then
 * drifted off again, and not within REPEAT_GAP_DAYS of it.
 */
function decideInactive(step: Step, p: PersonClock, facts: Facts, now: Date, lastSentAt: Date | null): Decision {
  const lastSeen = p.lastSeenAt ?? p.createdAt;
  if (now.getTime() < lastSeen.getTime() + step.day * DAY) return { action: "wait" };
  if (lastSentAt) {
    const returnedSince = lastSeen.getTime() > lastSentAt.getTime();
    if (!returnedSince || now.getTime() < lastSentAt.getTime() + REPEAT_GAP_DAYS * DAY) return { action: "wait" };
  }
  const paused = !step.enabled || step.condition === "needs_feature";
  const holds = !paused && (CONDITIONS[step.condition]?.test(facts, now) ?? false);
  return holds ? { action: "send" } : { action: "wait" };
}

/** Free passes this person can still hand out, for {{CreatorPasses}} and friends. */
export interface Passes { creator: number; brand: number; publisher: number }
export interface Person { displayName: string | null; companyName: string | null; role: string; passes?: Passes }

const PASS_FIELDS: Record<string, keyof Passes> = { creatorpasses: "creator", brandpasses: "brand", publisherpasses: "publisher" };
const PASS_FIELD = /\{\{\s*(CreatorPasses|BrandPasses|PublisherPasses)\s*\}\}/gi;
const passOf = (p: Person, field: string) => Math.max(0, Math.floor(p.passes?.[PASS_FIELDS[field.toLowerCase()]] ?? 0));

/**
 * The client, 26 Oct 2026: one welcome email for everyone, with "you have 10
 * Creator Passes" only for the people who have some. A line that mentions a
 * pass count of 0 is left out, and a paragraph left empty goes with it.
 */
function dropZeroPassLines(text: string, p: Person): string {
  return text.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.split("\n")
    .filter((line) => !Array.from(line.matchAll(PASS_FIELD)).some((m) => passOf(p, m[1]) === 0))
    .join("\n")).filter((block) => block.trim()).join("\n\n");
}

export function firstNameOf(displayName: string | null | undefined): string {
  const first = (displayName ?? "").trim().split(/\s+/)[0] ?? "";
  // An address or a handle is not a name to greet someone by.
  return /[@_\d]/.test(first) ? "" : first;
}

/**
 * Fill {{FirstName}} and {{CompanyName}}. Without a first name, "Hi Ana," reads
 * "Hi there," and a subject that opened with the name opens with the rest.
 */
export function merge(text: string, p: Person, opts: { subject?: boolean } = {}): string {
  const first = firstNameOf(p.displayName);
  const company = (p.companyName ?? "").trim() || (p.role === "brand" ? "your brand" : "your team");
  let t = opts.subject ? text : dropZeroPassLines(text, p);
  if (!first) {
    if (opts.subject) t = t.replace(/^\s*\{\{\s*FirstName\s*\}\},?\s*/i, "").replace(/^./, (c) => c.toUpperCase());
    t = t.replace(/\bHi \{\{\s*FirstName\s*\}\}/gi, "Hi there");
  }
  return t
    .replace(/\{\{\s*FirstName\s*\}\}/gi, first || "there")
    .replace(/\{\{\s*CompanyName\s*\}\}/gi, company)
    .replace(PASS_FIELD, (_, f: string) => String(passOf(p, f)));
}

/** Merge fields an admin may use; anything else in double braces is a typo. */
export function unknownFields(text: string): string[] {
  return Array.from(text.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g), (m) => m[1])
    .filter((f) => !/^(FirstName|CompanyName|CreatorPasses|BrandPasses|PublisherPasses)$/i.test(f));
}

const PORTAL: Record<string, string> = { creator: "/creator", brand: "/brand", affiliate: "/affiliate" };
const UPLOAD: Record<string, string> = { creator: "/creator/my-videos", brand: "/brand", affiliate: "/affiliate/library" };
const PLANS: Record<string, string> = { creator: "/creator/settings/subscription", brand: "/brand/settings/subscription", affiliate: "/affiliate/settings" };

/**
 * A button's link for this person. Paths may use {portal}, {upload} and
 * {plans}, so one email works for whichever kind of account receives it.
 * Only paths on our own site: an email from MTRLZD links to MTRLZD.
 */
export function ctaUrl(path: string | null, role: string, origin: string): string {
  const portal = PORTAL[role] ?? "/creator";
  let p = (path || "{portal}")
    .replace("{portal}", portal)
    .replace("{upload}", UPLOAD[role] ?? portal)
    .replace("{plans}", PLANS[role] ?? portal);
  if (!p.startsWith("/") || p.startsWith("//")) p = portal;
  return origin.replace(/\/$/, "") + p;
}

/** Plain paragraphs, blank-line separated; lines starting "•" become a list. */
export function bodyToHtml(body: string): string {
  return body.replace(/\r\n?/g, "\n").split(/\n{2,}/).map((block) => block.trim()).filter(Boolean).map((block) => {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.every((l) => /^[•\-*]\s+/.test(l))) {
      return `<ul style="margin:0 0 16px;padding-left:20px;color:#555;font-size:15px;line-height:1.7;">${
        lines.map((l) => `<li>${escapeHtml(l.replace(/^[•\-*]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p>${lines.map(escapeHtml).join("<br>")}</p>`;
  }).join("");
}

export function bodyToText(body: string): string {
  return body.replace(/\r\n?/g, "\n").trim();
}

export interface RenderedJourneyEmail { subject: string; bodyHtml: string; text: string; ctaLabel: string | null; ctaUrl: string }

/** One step, for one person. The caller wraps bodyHtml in the site's email layout. */
export function renderStep(step: Pick<Step, "subject" | "body" | "ctaLabel" | "ctaPath">, p: Person, origin: string): RenderedJourneyEmail {
  const body = merge(step.body, p);
  const url = ctaUrl(step.ctaPath, p.role, origin);
  const label = step.ctaLabel ? merge(step.ctaLabel, p) : null;
  return {
    subject: merge(step.subject, p, { subject: true }).slice(0, 200),
    bodyHtml: bodyToHtml(body),
    text: bodyToText(body) + (label ? `\n\n${label}: ${url}` : ""),
    ctaLabel: label,
    ctaUrl: url,
  };
}

/** What an admin may change on a step, checked. */
export function checkStepEdit(b: Record<string, unknown>): { error: string } | {
  subject: string; body: string; ctaLabel: string | null; ctaPath: string | null;
  day: number; anchor: string; condition: string; enabled: boolean; resolveNote: boolean; plain: boolean;
} {
  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  const body = typeof b.body === "string" ? b.body.trim() : "";
  if (!subject || subject.length > 200) return { error: "The subject needs to be between 1 and 200 characters." };
  if (!body || body.length > 6000) return { error: "The message needs to be between 1 and 6,000 characters." };
  const bad = unknownFields(subject + "\n" + body + "\n" + String(b.ctaLabel ?? ""));
  if (bad.length) return { error: `Unknown merge field {{${bad[0]}}}. Use {{FirstName}}, {{CompanyName}}, {{CreatorPasses}}, {{BrandPasses}} or {{PublisherPasses}}.` };
  const day = Number(b.day);
  if (!Number.isInteger(day) || day < -60 || day > 365) return { error: "The day needs to be a whole number between -60 and 365." };
  const anchor = String(b.anchor ?? "signup");
  if (!(anchor in ANCHORS)) return { error: "Unknown timing." };
  if (anchor !== "trial_end" && day < 0) return { error: "That number of days can't be negative." };
  if (anchor === "inactive" && day < 1) return { error: "Days without visiting needs to be at least 1." };
  const condition = String(b.condition ?? "always");
  if (!(condition in CONDITIONS)) return { error: "Unknown condition." };
  const ctaLabel = typeof b.ctaLabel === "string" && b.ctaLabel.trim() ? b.ctaLabel.trim().slice(0, 80) : null;
  const rawPath = typeof b.ctaPath === "string" ? b.ctaPath.trim() : "";
  if (rawPath && !/^(\{(portal|upload|plans)\}|\/(?!\/))[A-Za-z0-9/_\-{}?=&.]*$/.test(rawPath)) {
    return { error: "The button link must be a page on MTRLZD, like /brand/inventory or {portal}/invites." };
  }
  return {
    subject, body, ctaLabel, ctaPath: rawPath || null, day, anchor, condition,
    enabled: b.enabled !== false, resolveNote: b.resolveNote === true, plain: b.plain === true,
  };
}

const EMAIL = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;

/**
 * Who a journey's emails come from, by name, and where replies go. The
 * address itself stays the verified noreply@ one; a reply-to is what lets a
 * recipient's "reply" reach a person.
 */
export function checkSender(b: Record<string, unknown>): { error: string } | { fromName: string | null; replyTo: string | null } {
  const fromName = typeof b.fromName === "string" ? b.fromName.trim() : "";
  const replyTo = typeof b.replyTo === "string" ? b.replyTo.trim().toLowerCase() : "";
  if (fromName.length > 60 || /[<>"\r\n@]/.test(fromName)) return { error: "The sender name can't be longer than 60 characters or contain < > \" or @." };
  if (replyTo && (replyTo.length > 200 || !EMAIL.test(replyTo))) return { error: "That reply-to address doesn't look like an email address." };
  return { fromName: fromName || null, replyTo: replyTo || null };
}
