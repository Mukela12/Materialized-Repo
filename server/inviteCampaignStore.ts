/**
 * Invite campaigns: the database side. Rules live in server/inviteCampaigns.ts.
 */
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import { vouchers } from "@shared/schema";
import { mintCodes } from "./vouchers";
import {
  DEFAULTS, MAX_CONTACTS_PER_UPLOAD, campaignBatchId, checkContact, daysToFinish, inviteVoucher, nextSendAt,
  renderInvite, shareThisRun, startOfUtcDay,
  type CampaignSettings, type Contact, type ContactIn, type ContactType,
} from "./inviteCampaigns";
import type { JobResult } from "./scheduler";

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];
const iso = (v: unknown) => (v ? new Date(v as any).toISOString() : null);

export interface Campaign extends CampaignSettings {
  id: string; startedAt: string | null; pausedAt: string | null; createdBy: string | null; createdAt: string;
}

function campaignOf(r: any): Campaign {
  return {
    id: r.id, name: r.name, fromName: r.from_name, replyTo: r.reply_to,
    creatorSubject: r.creator_subject, creatorBody: r.creator_body, brandSubject: r.brand_subject, brandBody: r.brand_body,
    ctaLabel: r.cta_label, creatorFreeDays: r.creator_free_days, brandFreeDays: r.brand_free_days,
    useWithinDays: r.use_within_days, dailyLimit: r.daily_limit, postalAddress: r.postal_address,
    startedAt: iso(r.started_at), pausedAt: iso(r.paused_at), createdBy: r.created_by, createdAt: iso(r.created_at)!,
  };
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const r = await db.execute(sql`select * from invite_campaigns where id = ${id}`);
  return r.rows[0] ? campaignOf(r.rows[0]) : null;
}

export async function createCampaign(createdBy: string): Promise<Campaign> {
  const d = DEFAULTS;
  const r = await db.execute(sql`
    insert into invite_campaigns (name, from_name, reply_to, creator_subject, creator_body, brand_subject, brand_body, cta_label,
      creator_free_days, brand_free_days, use_within_days, daily_limit, created_by)
    values (${d.name}, ${d.fromName}, ${d.replyTo}, ${d.creatorSubject}, ${d.creatorBody}, ${d.brandSubject}, ${d.brandBody}, ${d.ctaLabel},
      ${d.creatorFreeDays}, ${d.brandFreeDays}, ${d.useWithinDays}, ${d.dailyLimit}, ${createdBy})
    returning *`);
  return campaignOf(r.rows[0]);
}

/**
 * Save settings. A pass already sent keeps the terms it was sent with: its
 * voucher was minted then. The partner name is on those vouchers too, so the
 * name can't change once anything has gone out.
 */
export async function saveCampaign(id: string, s: CampaignSettings): Promise<"ok" | "missing" | "name_locked"> {
  const c = await getCampaign(id);
  if (!c) return "missing";
  if (s.name !== c.name && (await countSent(id)) > 0) return "name_locked";
  await db.execute(sql`
    update invite_campaigns set name = ${s.name}, from_name = ${s.fromName}, reply_to = ${s.replyTo},
      creator_subject = ${s.creatorSubject}, creator_body = ${s.creatorBody}, brand_subject = ${s.brandSubject}, brand_body = ${s.brandBody},
      cta_label = ${s.ctaLabel}, creator_free_days = ${s.creatorFreeDays}, brand_free_days = ${s.brandFreeDays},
      use_within_days = ${s.useWithinDays}, daily_limit = ${s.dailyLimit}, postal_address = ${s.postalAddress}, updated_at = now()
    where id = ${id}`);
  return "ok";
}

async function countSent(id: string): Promise<number> {
  const r = await db.execute(sql`select count(*)::int as n from invite_contacts where campaign_id = ${id} and status in ('sent', 'sending')`);
  return (r.rows[0] as any).n;
}

/** Only a campaign that has sent nothing can be deleted: sent passes are real codes. */
export async function deleteCampaign(id: string): Promise<"ok" | "missing" | "has_sent"> {
  if (!(await getCampaign(id))) return "missing";
  if ((await countSent(id)) > 0) return "has_sent";
  await db.execute(sql`delete from invite_campaigns where id = ${id}`);
  return "ok";
}

export async function setCampaignState(id: string, action: "start" | "pause" | "resume"): Promise<boolean> {
  const set = action === "pause"
    ? sql`paused_at = coalesce(paused_at, now())`
    : sql`started_at = coalesce(started_at, now()), paused_at = null`;
  const r = await db.execute(sql`update invite_campaigns set ${set}, updated_at = now() where id = ${id}`);
  return (r.rowCount ?? 0) > 0;
}

// ── The list ─────────────────────────────────────────────────────────────────

export type SkipReason = "invalid" | "twice" | "on_list" | "has_account" | "unsubscribed" | "other_campaign";

export interface UploadResult {
  added: number;
  added_by_type: Record<ContactType, number>;
  skipped: { email: string; reason: SkipReason; detail: string }[];
}

/**
 * Add people to a campaign's list, in the order given. Left out: bad rows,
 * anyone listed twice, anyone already on it, anyone who already has an
 * account (they are in the journeys already), anyone who unsubscribed from
 * an earlier invite, and anyone a different campaign has already invited.
 */
export async function addContacts(campaignId: string, list: ContactIn[], defaultType: ContactType | null): Promise<UploadResult | { error: string }> {
  if (!(await getCampaign(campaignId))) return { error: "No such campaign." };
  if (list.length === 0) return { error: "No one on that list." };
  if (list.length > MAX_CONTACTS_PER_UPLOAD) return { error: `Up to ${MAX_CONTACTS_PER_UPLOAD.toLocaleString("en-US")} people per upload.` };

  const skipped: UploadResult["skipped"] = [];
  const ok: Contact[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const c = checkContact(raw, defaultType);
    if (!c.ok) { skipped.push({ email: c.email, reason: "invalid", detail: c.error }); continue; }
    if (seen.has(c.contact.email)) { skipped.push({ email: c.contact.email, reason: "twice", detail: "Listed twice" }); continue; }
    seen.add(c.contact.email);
    ok.push(c.contact);
  }
  const emails = ok.map((c) => c.email);
  const known = new Map<string, { reason: SkipReason; detail: string }>();
  if (emails.length) {
    const list = sql.join(emails.map((e) => sql`${e}`), sql`, `);
    for (const r of rows<{ email: string; campaign_id: string; name: string; opted_out_at: string | null }>(await db.execute(sql`
      select c.email, c.campaign_id, k.name, c.opted_out_at from invite_contacts c join invite_campaigns k on k.id = c.campaign_id
      where c.email in (${list})`))) {
      const prior = known.get(r.email);
      if (r.opted_out_at) known.set(r.email, { reason: "unsubscribed", detail: "Unsubscribed from an earlier invite" });
      else if (prior?.reason === "unsubscribed") continue;
      else if (r.campaign_id === campaignId) known.set(r.email, { reason: "on_list", detail: "Already on this list" });
      else if (!prior) known.set(r.email, { reason: "other_campaign", detail: `Already invited in ${r.name}` });
    }
    for (const r of rows<{ email: string }>(await db.execute(sql`select lower(email) as email from users where lower(email) in (${list})`))) {
      if (known.get(r.email)?.reason !== "unsubscribed") known.set(r.email, { reason: "has_account", detail: "Already has an MTRLZD account" });
    }
  }
  const fresh = ok.filter((c) => {
    const k = known.get(c.email);
    if (k) skipped.push({ email: c.email, ...k });
    return !k;
  });

  const by: Record<ContactType, number> = { creator: 0, brand: 0 };
  if (fresh.length) {
    const start = (rows<{ n: number }>(await db.execute(sql`
      select coalesce(max(position), 0)::int as n from invite_contacts where campaign_id = ${campaignId}`))[0]?.n ?? 0) + 1;
    for (let i = 0; i < fresh.length; i += 500) {
      const chunk = fresh.slice(i, i + 500);
      const values = sql.join(chunk.map((c, j) => sql`(${campaignId}, ${start + i + j}, ${c.email}, ${c.name}, ${c.company}, ${c.type}, ${randomBytes(24).toString("base64url")})`), sql`, `);
      const r = await db.execute(sql`
        insert into invite_contacts (campaign_id, position, email, name, company, type, token) values ${values}
        on conflict (campaign_id, email) do nothing returning type`);
      for (const x of rows<{ type: ContactType }>(r)) by[x.type]++;
    }
  }
  return { added: by.creator + by.brand, added_by_type: by, skipped };
}

/** Take someone off the list before their invite goes. */
export async function removeContact(campaignId: string, contactId: number): Promise<"ok" | "missing" | "sent"> {
  const r = await db.execute(sql`select status from invite_contacts where id = ${contactId} and campaign_id = ${campaignId}`);
  const c = r.rows[0] as any;
  if (!c) return "missing";
  if (c.status === "sent" || c.status === "sending") return "sent";
  await db.execute(sql`delete from invite_contacts where id = ${contactId} and campaign_id = ${campaignId}`);
  return "ok";
}

export interface ContactRow {
  id: number; position: number; email: string; name: string; company: string | null; type: ContactType;
  status: "queued" | "sending" | "sent" | "failed" | "skipped"; reason: string | null;
  sentAt: string | null; optedOutAt: string | null; code: string | null; joinedAt: string | null;
}

/**
 * Joined: signed up with their pass, or made an account with that email after
 * the invite went (they may have signed up without the code).
 */
const joinedAt = sql`coalesce(
  (select min(r.redeemed_at) from voucher_redemptions r where r.voucher_id = c.voucher_id),
  (select min(u.created_at) from users u where lower(u.email) = c.email and c.sent_at is not null and u.created_at >= c.sent_at))`;

export async function listContacts(campaignId: string): Promise<ContactRow[]> {
  return rows<any>(await db.execute(sql`
    select c.*, v.code, ${joinedAt} as joined_at from invite_contacts c left join vouchers v on v.id = c.voucher_id
    where c.campaign_id = ${campaignId} order by c.position`)).map((r) => ({
    id: r.id, position: r.position, email: r.email, name: r.name, company: r.company, type: r.type,
    status: r.status, reason: r.reason, sentAt: iso(r.sent_at), optedOutAt: iso(r.opted_out_at), code: r.code ?? null, joinedAt: iso(r.joined_at),
  }));
}

/** The first person of this type waiting on the list, so the preview reads as they'll get it. */
export async function sampleContact(campaignId: string, type: ContactType): Promise<Contact | null> {
  const r = await db.execute(sql`
    select email, name, company, type from invite_contacts where campaign_id = ${campaignId} and type = ${type}
    order by (status = 'queued') desc, position limit 1`);
  return (r.rows[0] as unknown as Contact) ?? null;
}

export interface CampaignSummary extends Campaign {
  totals: { contacts: number; waiting: number; sent: number; joined: number; unsubscribed: number; failed: number; skipped: number; sentToday: number };
  byType: Record<ContactType, number>;
  state: "draft" | "sending" | "paused" | "finished";
  nextSendAt: string | null;
  daysLeft: number;
}

export async function listCampaigns(now = new Date()): Promise<CampaignSummary[]> {
  const today = startOfUtcDay(now).toISOString();
  const cs = rows<any>(await db.execute(sql`select * from invite_campaigns order by created_at desc`)).map(campaignOf);
  if (cs.length === 0) return [];
  const stats = new Map(rows<any>(await db.execute(sql`
    select c.campaign_id,
      count(*)::int as contacts,
      count(*) filter (where c.status = 'queued' or (c.status = 'failed' and c.attempts < 3))::int as waiting,
      count(*) filter (where c.status = 'sent')::int as sent,
      count(*) filter (where c.status = 'sent' and ${joinedAt} is not null)::int as joined,
      count(*) filter (where c.opted_out_at is not null or exists (
        select 1 from invite_contacts o where o.email = c.email and o.opted_out_at is not null))::int as unsubscribed,
      count(*) filter (where c.status = 'failed' and c.attempts >= 3)::int as failed,
      count(*) filter (where c.status = 'skipped')::int as skipped,
      count(*) filter (where c.status in ('sent', 'sending') and c.sent_at >= ${today}::timestamp)::int as sent_today,
      count(*) filter (where c.type = 'creator')::int as creators,
      count(*) filter (where c.type = 'brand')::int as brands
    from invite_contacts c group by c.campaign_id`)).map((r) => [r.campaign_id, r]));
  return cs.map((c) => {
    const s = stats.get(c.id) ?? {};
    const totals = {
      contacts: s.contacts ?? 0, waiting: s.waiting ?? 0, sent: s.sent ?? 0, joined: s.joined ?? 0,
      unsubscribed: s.unsubscribed ?? 0, failed: s.failed ?? 0, skipped: s.skipped ?? 0, sentToday: s.sent_today ?? 0,
    };
    const state: CampaignSummary["state"] = !c.startedAt ? "draft" : c.pausedAt ? "paused" : totals.waiting === 0 ? "finished" : "sending";
    return {
      ...c, totals, byType: { creator: s.creators ?? 0, brand: s.brands ?? 0 }, state,
      nextSendAt: state === "sending" || state === "draft" ? nextSendAt(now, c.dailyLimit, totals.sentToday).toISOString() : null,
      daysLeft: daysToFinish(totals.waiting, c.dailyLimit),
    };
  });
}

// ── Sending ──────────────────────────────────────────────────────────────────

export interface OutgoingInvite {
  to: string; subject: string; html: string; text: string;
  fromName: string | null; replyTo: string | null; unsubscribePostUrl: string;
}

const codeTaken = async (code: string) =>
  (await db.execute(sql`select 1 from vouchers where regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = ${code.replace(/[^A-Z0-9]/gi, "").toUpperCase()}`)).rows.length > 0;

/** Someone whose address unsubscribed anywhere, or who now has an account, isn't sent an invite. */
async function markNoLongerInvitable(campaignId: string): Promise<number> {
  const r = await db.execute(sql`
    update invite_contacts c set status = 'skipped',
      reason = case when exists (select 1 from invite_contacts o where o.email = c.email and o.opted_out_at is not null)
        then 'unsubscribed' else 'has_account' end
    where c.campaign_id = ${campaignId} and c.status in ('queued', 'failed') and c.voucher_id is null
      and (exists (select 1 from invite_contacts o where o.email = c.email and o.opted_out_at is not null)
        or exists (select 1 from users u where lower(u.email) = c.email))`);
  return r.rowCount ?? 0;
}

let running: Promise<JobResult> | null = null;

/**
 * One run of every sending campaign: each sends its share of today's number.
 * One run at a time in this process, and each person is claimed before their
 * email is sent, so a person is never sent two invites.
 */
export function runInviteCampaigns(opts: {
  now: Date; origin: string;
  send: (emails: OutgoingInvite[]) => Promise<{ failed: Set<number>; error?: string }>;
}): Promise<JobResult> {
  if (running) return Promise.resolve({ status: "skipped", items: 0, detail: "a run is already going" });
  running = runOnce(opts).finally(() => { running = null; });
  return running;
}

async function runOnce(opts: Parameters<typeof runInviteCampaigns>[0]): Promise<JobResult> {
  const { now, origin } = opts;
  await db.execute(sql`
    update invite_contacts set status = 'failed', reason = 'interrupted'
    where status = 'sending' and sent_at < ${new Date(now.getTime() - 30 * 60_000).toISOString()}::timestamp`);
  const campaigns = rows<any>(await db.execute(sql`
    select * from invite_campaigns where started_at is not null and paused_at is null order by created_at`)).map(campaignOf);
  if (campaigns.length === 0) return { status: "skipped", items: 0, detail: "no campaign is sending" };

  let sent = 0, failed = 0, skipped = 0;
  let error: string | undefined;
  const today = startOfUtcDay(now).toISOString();
  for (const c of campaigns) {
    if (!c.postalAddress) continue;
    skipped += await markNoLongerInvitable(c.id);
    const [{ n: sentToday }] = rows<{ n: number }>(await db.execute(sql`
      select count(*)::int as n from invite_contacts where campaign_id = ${c.id} and status in ('sent', 'sending') and sent_at >= ${today}::timestamp`));
    const share = shareThisRun(now, c.dailyLimit, sentToday);
    if (share <= 0) continue;
    const claimed = rows<any>(await db.execute(sql`
      update invite_contacts set status = 'sending', attempts = attempts + 1, sent_at = ${now.toISOString()}::timestamp
      where id in (
        select id from invite_contacts where campaign_id = ${c.id} and (status = 'queued' or (status = 'failed' and attempts < 3))
        order by position limit ${share} for update skip locked)
      returning *`)).sort((a, b) => a.position - b.position);
    if (claimed.length === 0) continue;

    const outgoing: { contactId: number; voucherId: string; email: OutgoingInvite }[] = [];
    for (const k of claimed) {
      const contact: Contact = { email: k.email, name: k.name, company: k.company, type: k.type };
      // A retry reuses the pass minted the first time.
      let voucherId: string | null = k.voucher_id;
      let code: string, useBy: Date;
      if (voucherId) {
        const v = (await db.execute(sql`select code, expires_at from vouchers where id = ${voucherId}`)).rows[0] as any;
        code = v.code; useBy = new Date(v.expires_at);
      } else {
        [code] = await mintCodes(1, codeTaken);
        const row = inviteVoucher({ code, campaignId: c.id, campaignName: c.name, contact, settings: c, now, createdBy: c.createdBy });
        const [v] = await db.insert(vouchers).values(row as any).returning({ id: vouchers.id, expiresAt: vouchers.expiresAt });
        voucherId = v.id; useBy = new Date(v.expiresAt as any);
        await db.execute(sql`update invite_contacts set voucher_id = ${voucherId} where id = ${k.id}`);
      }
      const r = renderInvite({ settings: c, contact, code, useBy, origin, unsubscribeUrl: `${origin}/unsubscribe/${k.token}` });
      outgoing.push({
        contactId: k.id, voucherId: voucherId!,
        email: { to: k.email, subject: r.subject, html: r.html, text: r.text, fromName: c.fromName, replyTo: c.replyTo, unsubscribePostUrl: `${origin}/api/email/unsubscribe/${k.token}` },
      });
    }

    const res = await opts.send(outgoing.map((o) => o.email));
    if (res.error) error = res.error;
    for (let i = 0; i < outgoing.length; i++) {
      const ok = !res.failed.has(i);
      if (ok) sent++; else failed++;
      await db.execute(sql`
        update invite_contacts set status = ${ok ? "sent" : "failed"}, reason = ${ok ? null : (res.error ?? "send failed").slice(0, 300)},
          sent_at = ${ok ? sql`sent_at` : sql`null`}
        where id = ${outgoing[i].contactId}`);
    }
    // A pass whose email failed for the last time is taken back.
    await db.execute(sql`
      delete from vouchers v using invite_contacts c
      where c.voucher_id = v.id and c.campaign_id = ${c.id} and c.status = 'failed' and c.attempts >= 3
        and not exists (select 1 from voucher_redemptions r where r.voucher_id = v.id)`);
  }
  return {
    status: failed ? "failed" : sent || skipped ? "success" : "skipped",
    items: sent,
    detail: `${sent} invites sent, ${failed} failed, ${skipped} no longer invitable` + (error ? `; ${error}` : ""),
  };
}

// ── Unsubscribe (the same /unsubscribe/:token page as the journeys) ─────────

export async function contactPreferences(token: string): Promise<{ email: string; optedOut: boolean } | null> {
  const r = await db.execute(sql`
    select c.email, exists (select 1 from invite_contacts o where o.email = c.email and o.opted_out_at is not null) as opted_out
    from invite_contacts c where c.token = ${token}`);
  const c = r.rows[0] as any;
  return c ? { email: c.email, optedOut: !!c.opted_out } : null;
}

/** An opt-out covers the address, on every campaign it's on. */
export async function setContactOptOut(token: string, out: boolean): Promise<boolean> {
  const r = await db.execute(sql`select email from invite_contacts where token = ${token}`);
  const c = r.rows[0] as any;
  if (!c) return false;
  if (out) {
    await db.execute(sql`update invite_contacts set opted_out_at = now() where token = ${token} and opted_out_at is null`);
  } else {
    await db.execute(sql`update invite_contacts set opted_out_at = null where email = ${c.email}`);
  }
  return true;
}

/** When someone resubscribes from their account's link, their invite opt-out goes too. */
export async function clearContactOptOut(email: string): Promise<void> {
  await db.execute(sql`update invite_contacts set opted_out_at = null where email = ${email.toLowerCase()}`);
}

export { campaignBatchId };
