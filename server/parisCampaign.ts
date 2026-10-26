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
