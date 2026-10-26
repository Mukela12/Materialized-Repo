/**
 * Email journeys: the database side. Rules live in server/journeys.ts.
 */
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "./db";
import {
  CONDITIONS, ENROL_GRACE_DAYS, MIN_GAP_HOURS, decide, renderStep,
  type Facts, type Passes, type Step,
} from "./journeys";
import { inviteCapPerBrand, isPayingBrand } from "./inviteVoucher";
import { TRIAL_DAYS as PLAN_TRIAL_DAYS } from "../shared/plans";
import type { JobResult } from "./scheduler";

const rows = <T>(r: { rows: unknown[] }) => r.rows as T[];

function stepOf(r: any): Step {
  return {
    id: r.id, segment: r.segment, position: r.position, anchor: r.anchor, day: r.day, condition: r.condition,
    subject: r.subject, body: r.body, ctaLabel: r.cta_label, ctaPath: r.cta_path, enabled: r.enabled, plain: !!r.plain,
  };
}

/**
 * Which journey someone belongs in: an admin's choice for that person, else
 * the journey mapped to the partner whose code they joined with, else their
 * account type's.
 */
const resolvedSegment = sql`coalesce(
  u.journey_segment,
  (select p.segment from voucher_redemptions r
     join vouchers v on v.id = r.voucher_id
     join email_journey_partners p on p.partner = coalesce(nullif(v.partner, ''), v.label)
   where r.user_id = u.id limit 1),
  case u.role when 'brand' then 'brands' when 'affiliate' then 'publishers' else 'creators' end)`;

/** Who may get journey email at all. */
const reachable = sql`not coalesce(u.is_admin, false) and u.email_verified and u.email_opt_out_at is null`;

/** Put new accounts into the journey they belong in, if it is switched on. */
export async function enrolNew(): Promise<number> {
  const r = await db.execute(sql`
    insert into email_journey_enrollments (user_id, segment)
    select u.id, s.segment from users u
    cross join lateral (select ${resolvedSegment} as segment) s
    join email_journeys j on j.segment = s.segment and j.enabled_at is not null
    where ${reachable}
      and u.created_at >= j.enabled_at - make_interval(days => ${ENROL_GRACE_DAYS})
      and not exists (select 1 from email_journey_enrollments e where e.user_id = u.id)
    on conflict (user_id) do nothing`);
  return r.rowCount ?? 0;
}

/** Everything the conditions look at, for a set of people, in one query. */
export async function factsFor(userIds: string[]): Promise<Map<string, Facts>> {
  if (userIds.length === 0) return new Map();
  const ids = sql.join(userIds.map((id) => sql`${id}`), sql`, `);
  const r = await db.execute(sql`
    with mine as (
      select u.id as user_id, v.id as voucher_id from users u
      join vouchers v on v.batch_id like 'program:' || u.id || ':%'
        or v.batch_id in (select 'invite:' || b.id from brands b where b.owner_id = u.id)
      where u.id in (${ids})
    ), joined as (
      select m.user_id, r.user_id as invitee from mine m join voucher_redemptions r on r.voucher_id = m.voucher_id
    )
    select u.id, u.last_seen_at,
      (select count(*) from videos v where v.creator_id = u.id)::int as uploads,
      exists (select 1 from videos v join video_brands vb on vb.video_id = v.id where v.creator_id = u.id) as brand_tagged,
      (select count(*) from products p join brands b on b.id = p.brand_id where b.owner_id = u.id)::int as products,
      (select count(*) from mine m where m.user_id = u.id)::int as invites_sent,
      (select count(*) from joined j where j.user_id = u.id)::int as invites_joined,
      (select count(*) from joined j join videos v on v.creator_id = j.invitee where j.user_id = u.id)::int as invitee_uploads,
      exists (select 1 from brand_subscriptions s where s.user_id = u.id and s.status in ('active', 'trialing')) as subscribed,
      exists (select 1 from brand_subscriptions s where s.user_id = u.id and s.status = 'active'
        and s.subscribed_at + make_interval(days => ${PLAN_TRIAL_DAYS}) <= now()) as paying
    from users u where u.id in (${ids})`);
  const out = new Map<string, Facts>();
  for (const f of rows<any>(r)) {
    out.set(f.id, {
      uploads: f.uploads, brandTagged: f.brand_tagged, products: f.products, invitesSent: f.invites_sent,
      invitesJoined: f.invites_joined, inviteeUploads: f.invitee_uploads, subscribed: f.subscribed, paying: f.paying,
      lastSeenAt: f.last_seen_at ? new Date(f.last_seen_at) : null,
    });
  }
  return out;
}

/**
 * Free passes each person can still hand out: a brand's creator passes (its
 * own limit, or 10 starting out / 100 on the paid plan), plus a partner's
 * program invites for designers, influencers and publishers.
 */
export async function passesFor(userIds: string[], now = new Date()): Promise<Map<string, Passes>> {
  if (userIds.length === 0) return new Map();
  const ids = sql.join(userIds.map((id) => sql`${id}`), sql`, `);
  const sent = (u: string, type: string) => sql`(select count(*) from vouchers v where v.batch_id = 'program:' || ${sql.raw(u)} || ':' || ${type})::int`;
  const r = await db.execute(sql`
    select u.id, b.id as brand_id, b.invite_pass_limit, s.status as sub_status, s.subscribed_at,
      (select count(*) from vouchers v where v.batch_id = 'invite:' || b.id)::int as brand_sent,
      ps.brand_limit, ps.creator_limit, ps.publisher_limit,
      ${sent("u.id", "brand")} as program_brand_sent,
      ${sent("u.id", "creator")} as program_creator_sent,
      ${sent("u.id", "publisher")} as program_publisher_sent
    from users u
    left join lateral (select * from brands b where b.owner_id = u.id order by b.id limit 1) b on u.role = 'brand'
    left join brand_subscriptions s on s.user_id = u.id
    left join program_senders ps on ps.user_id = u.id
    where u.id in (${ids})`);
  const out = new Map<string, Passes>();
  for (const x of rows<any>(r)) {
    const left = (limit: number | null, used: number) => Math.max(0, (limit ?? 0) - (used ?? 0));
    const paying = isPayingBrand(x.sub_status ? { status: x.sub_status, subscribedAt: x.subscribed_at } : null, PLAN_TRIAL_DAYS, now);
    // Only a brand account has creator passes of its own.
    const brandCap = x.brand_id == null ? 0 : (x.invite_pass_limit ?? inviteCapPerBrand(paying));
    out.set(x.id, {
      creator: left(brandCap, x.brand_sent) + left(x.creator_limit, x.program_creator_sent),
      brand: left(x.brand_limit, x.program_brand_sent),
      publisher: left(x.publisher_limit, x.program_publisher_sent),
    });
  }
  return out;
}

/** The person's own unsubscribe token, made the first time it is needed. */
async function emailTokenFor(userId: string): Promise<string> {
  const fresh = randomBytes(24).toString("base64url");
  const r = await db.execute(sql`
    update users set email_token = coalesce(email_token, ${fresh}) where id = ${userId} returning email_token`);
  return (r.rows[0] as any).email_token;
}

interface Candidate {
  user_id: string; email: string; display_name: string | null; role: string; created_at: string;
  free_access_until: string | null; company: string | null; last_sent: string | null;
  from_name: string | null; reply_to: string | null; plan_started_at: string | null;
}

/**
 * One pass: enrol, then for each enrolled person work out which of their
 * journey's emails are due, send at most one, and record skips. Safe to run
 * twice at once: an email is claimed by inserting its row before it is sent.
 */
export async function runJourneys(opts: {
  now: Date; origin: string;
  send: (emails: import("./emailService").JourneyEmail[]) => Promise<{ failed: Set<number>; error?: string }>;
}): Promise<JobResult> {
  const { now, origin } = opts;
  const enrolled = await enrolNew();

  const people = rows<Candidate>(await db.execute(sql`
    select u.id as user_id, u.email, u.display_name, u.role, u.created_at, u.free_access_until,
      (select b.name from brands b where b.owner_id = u.id order by b.name limit 1) as company,
      (select max(s.at) from email_journey_sends s where s.user_id = u.id and s.status = 'sent') as last_sent,
      e.segment, j.from_name, j.reply_to,
      (select s.subscribed_at from brand_subscriptions s where s.user_id = u.id and s.status in ('active', 'trialing') limit 1) as plan_started_at
    from email_journey_enrollments e
    join users u on u.id = e.user_id
    join email_journeys j on j.segment = e.segment and j.enabled_at is not null
    where ${reachable}`));
  if (people.length === 0) return { status: "skipped", items: 0, detail: `no one enrolled${enrolled ? `, ${enrolled} new` : ""}` };

  const steps = rows<any>(await db.execute(sql`select * from email_journey_steps order by segment, position`)).map(stepOf);
  const prior = new Map(rows<{ k: string; status: string; attempts: number; at: string }>(await db.execute(sql`
    select user_id || ':' || step_id as k, status, attempts, at from email_journey_sends`)).map((r) => [r.k, r]));
  const facts = await factsFor(people.map((p) => p.user_id));
  const passes = await passesFor(people.map((p) => p.user_id), now);

  const outgoing: { userId: string; stepId: string; email: import("./emailService").JourneyEmail }[] = [];
  let skipped = 0;
  for (const p of people as (Candidate & { segment: string })[]) {
    const f = facts.get(p.user_id);
    if (!f) continue;
    const clock = {
      createdAt: new Date(p.created_at),
      freeAccessUntil: p.free_access_until ? new Date(p.free_access_until) : null,
      lastSeenAt: f.lastSeenAt,
      planTrialEndsAt: p.plan_started_at ? new Date(new Date(p.plan_started_at).getTime() + PLAN_TRIAL_DAYS * 86_400_000) : null,
    };
    const recent = p.last_sent && now.getTime() - new Date(p.last_sent).getTime() < MIN_GAP_HOURS * 3_600_000;
    let queued = false;
    for (const step of steps.filter((s) => s.segment === p.segment)) {
      const before = prior.get(`${p.user_id}:${step.id}`);
      // A "days without visiting" reminder may go again; everything else goes once.
      const again = step.anchor === "inactive" && before?.status === "sent";
      if (before && !again && (before.status !== "failed" || before.attempts >= 3)) continue;
      const d = decide(step, clock, f, now, again ? new Date(before!.at) : null);
      if (d.action === "skip") {
        await db.execute(sql`
          insert into email_journey_sends (user_id, step_id, status, reason) values (${p.user_id}, ${step.id}, 'skipped', ${d.reason})
          on conflict (user_id, step_id) do update set status = 'skipped', reason = excluded.reason, at = now()
          where email_journey_sends.status = 'failed'`);
        skipped++;
      } else if (d.action === "send" && !recent && !queued) {
        // Claim first. A row already there (another run got it) means not ours.
        const claim = again ? await db.execute(sql`
          update email_journey_sends set status = 'sending', at = now()
          where user_id = ${p.user_id} and step_id = ${step.id} and status = 'sent'
          returning id`) : await db.execute(sql`
          insert into email_journey_sends (user_id, step_id, status) values (${p.user_id}, ${step.id}, 'sending')
          on conflict (user_id, step_id) do update set status = 'sending', attempts = email_journey_sends.attempts + 1, at = now()
          where email_journey_sends.status = 'failed' and email_journey_sends.attempts < 3
          returning id`);
        if (!claim.rows.length) continue;
        const token = await emailTokenFor(p.user_id);
        const r = renderStep(step, {
          displayName: p.display_name, companyName: p.company ?? (p.role === "creator" ? null : p.display_name), role: p.role,
          passes: passes.get(p.user_id),
        }, origin);
        outgoing.push({
          userId: p.user_id, stepId: step.id,
          email: {
            to: p.email, ...r, plain: step.plain, fromName: p.from_name, replyTo: p.reply_to,
            unsubscribeUrl: `${origin}/unsubscribe/${token}`,
            unsubscribePostUrl: `${origin}/api/email/unsubscribe/${token}`,
          },
        });
        queued = true;
      }
    }
  }

  let sent = 0;
  let error: string | undefined;
  if (outgoing.length) {
    const res = await opts.send(outgoing.map((o) => o.email));
    error = res.error;
    for (let i = 0; i < outgoing.length; i++) {
      const ok = !res.failed.has(i);
      if (ok) sent++;
      await db.execute(sql`
        update email_journey_sends set status = ${ok ? "sent" : "failed"}, reason = ${ok ? null : (res.error ?? "send failed").slice(0, 300)}, at = now()
        where user_id = ${outgoing[i].userId} and step_id = ${outgoing[i].stepId}`);
    }
  }
  const failed = outgoing.length - sent;
  return {
    status: failed ? "failed" : sent || skipped || enrolled ? "success" : "skipped",
    items: sent,
    detail: `${sent} sent, ${skipped} skipped, ${failed} failed, ${enrolled} newly enrolled` + (error ? `; ${error}` : ""),
  };
}

/** A run that died between claiming and recording leaves 'sending' rows; free them. */
export async function releaseStuckSends(): Promise<void> {
  await db.execute(sql`
    update email_journey_sends set status = 'failed', reason = 'interrupted'
    where status = 'sending' and at < now() - interval '30 minutes'`);
}

// ── Admin ────────────────────────────────────────────────────────────────────

export async function journeysOverview() {
  const journeys = rows<any>(await db.execute(sql`
    select j.*,
      (select count(*) from email_journey_enrollments e where e.segment = j.segment)::int as enrolled,
      (select count(*) from email_journey_sends s join email_journey_steps t on t.id = s.step_id where t.segment = j.segment and s.status = 'sent')::int as sent,
      (select count(*) from email_journey_enrollments e join users u on u.id = e.user_id where e.segment = j.segment and u.email_opt_out_at is not null)::int as unsubscribed
    from email_journeys j order by j.sort`));
  const steps = rows<any>(await db.execute(sql`
    select t.*,
      count(s.id) filter (where s.status = 'sent')::int as sent,
      count(s.id) filter (where s.status = 'skipped')::int as skipped,
      count(s.id) filter (where s.status = 'failed')::int as failed
    from email_journey_steps t left join email_journey_sends s on s.step_id = t.id
    group by t.id
    order by t.segment, case t.anchor when 'signup' then 0 when 'trial_end' then 1 else 2 end, t.day, t.position`));
  const partners = rows<any>(await db.execute(sql`
    select coalesce(nullif(v.partner, ''), v.label) as partner, count(*)::int as codes, p.segment
    from vouchers v left join email_journey_partners p on p.partner = coalesce(nullif(v.partner, ''), v.label)
    where coalesce(nullif(v.partner, ''), v.label) is not null
      and (v.batch_id is null or (v.batch_id not like 'invite:%' and v.batch_id not like 'program:%'))
    group by 1, p.segment order by 2 desc`));
  return {
    journeys,
    steps: steps.map((s) => ({ ...stepOf(s), reviewNote: s.review_note, updatedAt: s.updated_at, sent: s.sent, skipped: s.skipped, failed: s.failed })),
    partners,
    conditions: Object.entries(CONDITIONS).map(([key, c]) => ({ key, label: c.label })),
  };
}

export async function setJourneyEnabled(segment: string, on: boolean): Promise<boolean> {
  const r = await db.execute(sql`
    update email_journeys set enabled_at = ${on ? sql`coalesce(enabled_at, now())` : null}, updated_at = now()
    where segment = ${segment}`);
  return (r.rowCount ?? 0) > 0;
}

export async function getStep(id: string): Promise<Step | null> {
  const r = await db.execute(sql`select * from email_journey_steps where id = ${id}`);
  return r.rows[0] ? stepOf(r.rows[0]) : null;
}

export async function updateStep(id: string, e: {
  subject: string; body: string; ctaLabel: string | null; ctaPath: string | null;
  day: number; anchor: string; condition: string; enabled: boolean; resolveNote: boolean; plain: boolean;
}): Promise<boolean> {
  const r = await db.execute(sql`
    update email_journey_steps set subject = ${e.subject}, body = ${e.body}, cta_label = ${e.ctaLabel}, cta_path = ${e.ctaPath},
      day = ${e.day}, anchor = ${e.anchor}, condition = ${e.condition}, enabled = ${e.enabled}, plain = ${e.plain},
      review_note = case when ${e.resolveNote} then null else review_note end, updated_at = now()
    where id = ${id}`);
  return (r.rowCount ?? 0) > 0;
}

export async function setJourneySender(segment: string, v: { fromName: string | null; replyTo: string | null }): Promise<boolean> {
  const r = await db.execute(sql`
    update email_journeys set from_name = ${v.fromName}, reply_to = ${v.replyTo}, updated_at = now() where segment = ${segment}`);
  return (r.rowCount ?? 0) > 0;
}

export async function journeySender(segment: string): Promise<{ fromName: string | null; replyTo: string | null }> {
  const r = await db.execute(sql`select from_name, reply_to from email_journeys where segment = ${segment}`);
  const j = r.rows[0] as any;
  return { fromName: j?.from_name ?? null, replyTo: j?.reply_to ?? null };
}

export async function setPartnerSegment(partner: string, segment: string | null): Promise<void> {
  if (segment) {
    await db.execute(sql`
      insert into email_journey_partners (partner, segment) values (${partner}, ${segment})
      on conflict (partner) do update set segment = excluded.segment`);
  } else {
    await db.execute(sql`delete from email_journey_partners where partner = ${partner}`);
  }
}

export async function isJourneyOn(segment: string): Promise<boolean> {
  const r = await db.execute(sql`select 1 from email_journeys where segment = ${segment} and enabled_at is not null`);
  return r.rows.length > 0;
}

// ── Unsubscribe ──────────────────────────────────────────────────────────────

const TOKEN = /^[A-Za-z0-9_-]{20,64}$/;

export async function preferencesFor(token: string): Promise<{ email: string; optedOut: boolean } | null> {
  if (!TOKEN.test(token)) return null;
  const r = await db.execute(sql`select email, email_opt_out_at from users where email_token = ${token}`);
  const u = r.rows[0] as any;
  if (!u) return null;
  // Enough to recognise your own address, not enough to harvest it from a link.
  const [name, domain] = String(u.email).split("@");
  return { email: `${name.slice(0, 2)}${"•".repeat(Math.min(6, Math.max(1, name.length - 2)))}@${domain}`, optedOut: !!u.email_opt_out_at };
}

export async function setOptOut(token: string, out: boolean): Promise<boolean> {
  if (!TOKEN.test(token)) return false;
  const r = await db.execute(sql`
    update users set email_opt_out_at = ${out ? sql`coalesce(email_opt_out_at, now())` : null} where email_token = ${token}`);
  return (r.rowCount ?? 0) > 0;
}

