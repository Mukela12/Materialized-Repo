/**
 * Paris Creator Week (client, 22 Oct 2026; designed on her Replit copy, ported
 * here 27 Oct). A creator claims two MTRLZD Creator Passes on the campaign
 * page: one for themselves and one for a friend whose handle they give. Both
 * are real single-use vouchers, so they sign up through the normal flow, and
 * both carry the partner "Paris Creator Week", so those accounts show that
 * source in Admin > Activity and in the Most Engaged Video ranking.
 *
 * What a pass gives: free access for a creator account for 30 days from
 * sign-up (her doc's "free 30-day Creator Pass"), and it has to be used within
 * 14 days of the claim (her page's activation window).
 */
import type { Express, Request } from "express";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { parisSignupSchema } from "@shared/paris-campaign";
import { generateVoucherCode, mintCodes, normaliseCode } from "./vouchers";
import { publicOrigin } from "./publicOrigin";

export const PARIS = {
  campaign: "paris-creator-week",
  partner: "Paris Creator Week",
  freeDays: 30,
  activationDays: 14,
  /**
   * Creator bonus on the passes: this % of their sales, for this many months.
   * Three (client, 26 Oct 2026): "ample time to test, publish and see
   * results", then a reason to earn it again rather than keep it for good.
   */
  creatorBonusPct: 5,
  creatorBonusMonths: 3,
} as const;

export class ClaimError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

interface Claim {
  first_name: string; email: string; platform: string; creator_handle: string; friend_handle: string;
  request_id: string | null; creator_code: string; friend_code: string; expires_at: string;
}

async function existingClaim(email: string): Promise<Claim | undefined> {
  const r = await db.execute(sql`
    select c.first_name, c.email, c.platform, c.creator_handle, c.friend_handle, c.request_id,
      cv.code as creator_code, fv.code as friend_code, cv.expires_at
    from campaign_claims c
    join vouchers cv on cv.id = c.creator_voucher_id
    join vouchers fv on fv.id = c.friend_voucher_id
    where c.campaign = ${PARIS.campaign} and c.email = ${email}`);
  return r.rows[0] as unknown as Claim | undefined;
}

/**
 * Mint both passes and record the claim, all or nothing. A repeat of the same
 * submission (same request id and details, e.g. a double tap) gets the same
 * passes back; any other repeat for that email is refused.
 */
export async function claimParisPasses(input: unknown): Promise<{ claim: Claim; created: boolean }> {
  const data = parisSignupSchema.parse(input);
  const prior = await existingClaim(data.email);
  if (prior) {
    const same = data.requestId && prior.request_id === data.requestId && prior.first_name === data.fullName
      && prior.platform === data.platform && prior.creator_handle === data.creatorHandle && prior.friend_handle === data.friendHandle;
    if (same) return { claim: prior, created: false };
    throw new ClaimError("Passes have already been claimed with this email. Check your inbox, or use another email.", 409);
  }

  const [creatorCode, friendCode] = await mintCodes(2, async (code) => {
    const r = await db.execute(sql`select 1 from vouchers where regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = ${normaliseCode(code).replace(/[^A-Z0-9]/g, "")}`);
    return r.rows.length > 0;
  }, () => generateVoucherCode("PCW"));
  const expiresAt = new Date(Date.now() + PARIS.activationDays * 86_400_000);

  try {
    await db.transaction(async (tx) => {
      const insertPass = async (code: string, label: string, assignedTo: string) => (await tx.execute(sql`
        insert into vouchers (code, label, partner, grant_type, role_restriction, max_redemptions, free_days, expires_at, batch_id, assigned_to,
          creator_bonus_pct, creator_bonus_months)
        values (${code}, ${label}, ${PARIS.partner}, 'free_access', 'creator', 1, ${PARIS.freeDays}, ${expiresAt}, ${PARIS.campaign}, ${assignedTo},
          ${PARIS.creatorBonusPct}, ${PARIS.creatorBonusMonths})
        returning id`)).rows[0] as { id: string };
      const mine = await insertPass(creatorCode, "Paris Creator Week: creator pass", `${data.fullName} <${data.email}>`);
      const friend = await insertPass(friendCode, "Paris Creator Week: friend pass", `@${data.friendHandle} (friend of ${data.email})`);
      await tx.execute(sql`
        insert into campaign_claims (campaign, first_name, email, platform, creator_handle, friend_handle, request_id, creator_voucher_id, friend_voucher_id)
        values (${PARIS.campaign}, ${data.fullName}, ${data.email}, ${data.platform}, ${data.creatorHandle}, ${data.friendHandle},
          ${data.requestId ?? null}, ${mine.id}, ${friend.id})`);
    });
  } catch (err: any) {
    // Two submissions racing for the same email: the unique key settles it.
    if (err?.code === "23505") {
      const won = await existingClaim(data.email);
      if (won && data.requestId && won.request_id === data.requestId) return { claim: won, created: false };
      throw new ClaimError("Passes have already been claimed with this email. Check your inbox, or use another email.", 409);
    }
    throw err;
  }
  const claim = await existingClaim(data.email);
  if (!claim) throw new Error("claim vanished after insert");
  return { claim, created: true };
}

/** Where a pass is redeemed: sign-up with the code filled in, as a creator. */
export function passSignupUrl(origin: string, code: string): string {
  return `${origin.replace(/\/$/, "")}/register?code=${encodeURIComponent(code)}&role=creator&utm_source=paris-creator-week&utm_campaign=creator-pass`;
}

const attempts = new Map<string, { count: number; until: number }>();
/** 20 tries an hour per address and email: an event crowd on one Wi-Fi shares an address. */
function tooManyAttempts(req: Request): number | null {
  const now = Date.now();
  attempts.forEach((e, k) => { if (e.until < now) attempts.delete(k); });
  if (attempts.size > 10_000) attempts.clear();
  const key = `${req.ip}:${createHash("sha256").update(String(req.body?.email ?? "").trim().toLowerCase()).digest("hex")}`;
  const e = attempts.get(key) ?? { count: 0, until: now + 3_600_000 };
  e.count++;
  attempts.set(key, e);
  return e.count > 20 ? Math.ceil((e.until - now) / 1000) : null;
}

export function registerParisCampaignRoutes(app: Express) {
  app.post("/api/paris-creator-week/claim", async (req, res) => {
    res.set("Cache-Control", "no-store");
    const wait = tooManyAttempts(req);
    if (wait) {
      res.set("Retry-After", String(wait));
      return res.status(429).json({ error: "Too many attempts. Please try again in an hour." });
    }
    try {
      const { claim, created } = await claimParisPasses(req.body);
      let emailStatus: "sent" | "unavailable" | "failed" | "previously-issued" = created ? "unavailable" : "previously-issued";
      const { isEmailConfigured, sendCampaignPassesEmail } = await import("./emailService");
      if (created && isEmailConfigured()) {
        const origin = publicOrigin(req);
        try {
          await sendCampaignPassesEmail({
            to: claim.email, firstName: claim.first_name, campaignName: "Paris Creator Week",
            creatorCode: claim.creator_code, friendCode: claim.friend_code, friendHandle: claim.friend_handle,
            expiresAt: new Date(claim.expires_at), freeDays: PARIS.freeDays,
            creatorUrl: passSignupUrl(origin, claim.creator_code), friendUrl: passSignupUrl(origin, claim.friend_code),
          });
          emailStatus = "sent";
        } catch (err) {
          console.error("[Paris] pass email failed; passes are saved:", (err as Error)?.message);
          emailStatus = "failed";
        }
      }
      return res.status(created ? 201 : 200).json({
        success: true, creatorCode: claim.creator_code, friendCode: claim.friend_code,
        expiresAt: claim.expires_at, emailStatus,
      });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return res.status(400).json({ error: "Please check the highlighted fields.", fieldErrors: err.flatten().fieldErrors });
      }
      if (err instanceof ClaimError) return res.status(err.status).json({ error: err.message });
      console.error("[Paris] claim failed:", err?.message);
      return res.status(503).json({ error: "We couldn't save your passes. Nothing has been issued. Please try again." });
    }
  });
}

/**
 * Admin: everyone who claimed passes on the campaign page (client, 3 Nov
 * 2026: "where are those names going... is there a spreadsheet"). A claim is
 * not a sign-up, so each pass shows whether it has been used, is still open,
 * or ran out before anyone signed up with it.
 */
export type PassState = "joined" | "open" | "expired";

export function passState(redeemedAt: unknown, expiresAt: unknown, now: Date): PassState {
  if (redeemedAt) return "joined";
  return expiresAt && new Date(expiresAt as string).getTime() <= now.getTime() ? "expired" : "open";
}

export interface ParisPass {
  code: string; state: PassState; joinedAt: string | null; userId: string | null; name: string | null; videos: number;
}
export interface ParisClaimRow {
  id: string; claimedAt: string; firstName: string; email: string; platform: string;
  creatorHandle: string; friendHandle: string; activateBy: string; creator: ParisPass; friend: ParisPass;
}

const isoOrNull = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export function shapeClaim(r: any, now: Date): ParisClaimRow {
  const pass = (p: "c" | "f"): ParisPass => ({
    code: r[`${p}_code`], state: passState(r[`${p}_joined_at`], r.activate_by, now), joinedAt: isoOrNull(r[`${p}_joined_at`]),
    userId: r[`${p}_user_id`] ?? null, name: r[`${p}_name`] ?? null, videos: Number(r[`${p}_videos`] ?? 0),
  });
  return {
    id: r.id, claimedAt: new Date(r.created_at).toISOString(), firstName: r.first_name, email: r.email, platform: r.platform,
    creatorHandle: r.creator_handle, friendHandle: r.friend_handle, activateBy: new Date(r.activate_by).toISOString(),
    creator: pass("c"), friend: pass("f"),
  };
}

export async function parisClaimsReport(now = new Date()) {
  const r = await db.execute(sql`
    select c.id, c.created_at, c.first_name, c.email, c.platform, c.creator_handle, c.friend_handle, cv.expires_at as activate_by,
      cv.code as c_code, cr.redeemed_at as c_joined_at, cr.user_id as c_user_id, coalesce(cu.display_name, cu.username) as c_name,
      (select count(*) from videos v where v.creator_id = cr.user_id)::int as c_videos,
      fv.code as f_code, fr.redeemed_at as f_joined_at, fr.user_id as f_user_id, coalesce(fu.display_name, fu.username) as f_name,
      (select count(*) from videos v where v.creator_id = fr.user_id)::int as f_videos
    from campaign_claims c
    join vouchers cv on cv.id = c.creator_voucher_id
    join vouchers fv on fv.id = c.friend_voucher_id
    left join lateral (select user_id, redeemed_at from voucher_redemptions where voucher_id = cv.id order by redeemed_at limit 1) cr on true
    left join lateral (select user_id, redeemed_at from voucher_redemptions where voucher_id = fv.id order by redeemed_at limit 1) fr on true
    left join users cu on cu.id = cr.user_id
    left join users fu on fu.id = fr.user_id
    where c.campaign = ${PARIS.campaign}
    order by c.created_at desc
    limit 5000`);
  const claims = (r.rows as any[]).map((row) => shapeClaim(row, now));
  const passes = claims.flatMap((c) => [c.creator, c.friend]);
  return {
    totals: {
      claims: claims.length,
      creatorsJoined: claims.filter((c) => c.creator.state === "joined").length,
      friendsJoined: claims.filter((c) => c.friend.state === "joined").length,
      videos: passes.reduce((n, p) => n + p.videos, 0),
    },
    claims,
  };
}
