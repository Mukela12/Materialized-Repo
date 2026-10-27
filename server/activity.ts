/**
 * Activity: who comes in, where they land, where they leave, and whether the
 * voucher codes handed out are being used. Asked for by the client on 22 Oct
 * 2026 after hundreds of codes produced almost no sign-ups and nothing in the
 * app could say whether anyone had even opened a link.
 *
 * First-party only. The browser sends a page view on each route change with a
 * random visitor id it keeps itself and a session id that renews after 30
 * minutes idle; the server adds the signed-in user, if any. No IP address, no
 * user agent string, no third party. Admin accounts are left out of every
 * figure so the team's own testing does not read as traction.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";
import type { Attribution, cleanPageView } from "./activityRules";

async function voucherIdForCode(code: string | null): Promise<string | null> {
  if (!code) return null;
  const r = await db.execute(sql`select id from vouchers where regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = ${code} limit 1`);
  return (r.rows[0] as { id: string } | undefined)?.id ?? null;
}

export async function recordPageView(v: NonNullable<ReturnType<typeof cleanPageView>>, userId: string | null): Promise<void> {
  const voucherId = await voucherIdForCode(v.code);
  await db.execute(sql`
    insert into activity_events (type, visitor_id, session_id, user_id, path, referrer_host, device, voucher_id)
    values ('page_view', ${v.visitorId}, ${v.sessionId}, ${userId}, ${v.path}, ${v.referrerHost}, ${v.device}, ${voucherId})`);
  if (userId) {
    // At most one write a minute per person: "last seen" needs no finer grain.
    await db.execute(sql`
      update users set last_seen_at = now()
      where id = ${userId} and (last_seen_at is null or last_seen_at < now() - interval '1 minute')`);
  }
}

/** A sign-in: counted on the account and kept as an event for the timeline. */
export async function recordLogin(userId: string): Promise<void> {
  await db.execute(sql`update users set last_login_at = now(), last_seen_at = now(), login_count = login_count + 1 where id = ${userId}`);
  await db.execute(sql`insert into activity_events (type, user_id) values ('login', ${userId})`);
}

/** An account made. Not a sign-in: most still have an email to confirm first. */
export async function recordSignup(userId: string, from?: Attribution): Promise<void> {
  if (from && (from.utmSource || from.utmCampaign || from.referrer)) {
    await db.execute(sql`
      update users set signup_utm_source = ${from.utmSource}, signup_utm_medium = ${from.utmMedium},
        signup_utm_campaign = ${from.utmCampaign}, signup_referrer = ${from.referrer}
      where id = ${userId}`);
  }
  await db.execute(sql`insert into activity_events (type, user_id) values ('signup', ${userId})`);
}

/**
 * Where an account came from, in words, for a row aliased "u". In order: the
 * code they joined with (a partner or event batch, a brand's invite, a
 * program's invite), then the campaign link that brought them (paid Google
 * clicks read "Google Ads"), then the site that referred them, then Direct.
 */
export const sourceOf = sql`coalesce(
  (select case
      when v.batch_id like 'invite:%' then 'Invited by ' || coalesce((select b.name from brands b where 'invite:' || b.id = v.batch_id), 'a brand')
      when v.batch_id like 'program:%' then coalesce((select ps.program_name from program_senders ps where v.batch_id like 'program:' || ps.user_id || ':%' limit 1), 'Program invite')
      else coalesce(nullif(v.partner, ''), nullif(v.label, ''), 'Voucher code') end
   from voucher_redemptions r join vouchers v on v.id = r.voucher_id where r.user_id = u.id order by r.redeemed_at limit 1),
  case
    when u.signup_utm_source = 'google' and u.signup_utm_medium in ('cpc', 'ppc', 'paid', 'paidsearch', 'paid-search') then 'Google Ads'
    when u.signup_utm_source is not null then initcap(u.signup_utm_source) || coalesce(' · ' || u.signup_utm_campaign, '')
  end,
  u.signup_referrer,
  'Direct')`;

/** When they started paying, if they have. */
export const subscribedAtOf = sql`(select s.subscribed_at from brand_subscriptions s where s.user_id = u.id and s.status in ('active', 'trialing') limit 1)`;

/**
 * Everything the admin Activity tab shows, for the last `days` days.
 * Events from admin accounts are excluded throughout; anonymous visitors are
 * included (they are who the codes are meant to reach).
 */
export async function activityReport(days: number) {
  const since = sql`now() - make_interval(days => ${days})`;
  // Events that count: not from an admin account, and not from a browser an
  // admin has used, so the team's own visits to the login page before signing
  // in are not read as strangers arriving.
  const counted = sql`(
    (e.user_id is null or not exists (select 1 from users a where a.id = e.user_id and a.is_admin))
    and (e.visitor_id is null or not exists (
      select 1 from activity_events x join users a on a.id = x.user_id
      where x.visitor_id = e.visitor_id and a.is_admin)))`;

  const totals = (await db.execute(sql`
    select
      (select count(distinct e.visitor_id) from activity_events e where e.at >= ${since} and e.type = 'page_view' and ${counted})::int as visitors,
      (select count(distinct e.session_id) from activity_events e where e.at >= ${since} and e.type = 'page_view' and ${counted})::int as sessions,
      (select count(*) from users u where u.created_at >= ${since} and not u.is_admin)::int as signups,
      (select count(*) from activity_events e where e.at >= ${since} and e.type = 'login' and ${counted})::int as logins,
      (select count(distinct e.user_id) from activity_events e where e.at >= ${since} and e.user_id is not null and ${counted})::int as active_users,
      (select count(distinct e.visitor_id) from activity_events e where e.at >= ${since} and e.voucher_id is not null and ${counted})::int as code_link_visitors,
      (select min(at) from activity_events) as tracking_since
  `)).rows[0];

  // Each session's first and last page: where people come in and where they stop.
  const sessionEnds = sql`
    select e.session_id,
      (array_agg(e.path order by e.at asc))[1] as landing,
      (array_agg(e.path order by e.at desc))[1] as exit,
      count(*) as pages,
      bool_or(e.user_id is not null) as signed_in,
      (array_agg(e.device order by e.at asc))[1] as device
    from activity_events e
    where e.at >= ${since} and e.type = 'page_view' and e.session_id is not null and ${counted}
    group by e.session_id`;
  const landing = (await db.execute(sql`
    select landing as path, count(*)::int as sessions, count(*) filter (where pages = 1)::int as bounced
    from (${sessionEnds}) s group by landing order by sessions desc limit 12`)).rows;
  const exits = (await db.execute(sql`
    select exit as path, count(*)::int as sessions
    from (${sessionEnds}) s where pages > 1 group by exit order by sessions desc limit 12`)).rows;
  const devices = (await db.execute(sql`
    select coalesce(device, 'unknown') as device, count(*)::int as sessions
    from (${sessionEnds}) s group by 1 order by 2 desc`)).rows;

  // Voucher batches: handed out, links opened, accounts made, people who came back.
  const codes = (await db.execute(sql`
    select coalesce(nullif(v.partner, ''), nullif(v.label, ''), 'Unlabelled') as batch,
      count(distinct v.id)::int as issued,
      count(distinct v.id) filter (where v.revoked_at is null)::int as live,
      (select count(distinct e.visitor_id) from activity_events e where e.voucher_id = any(array_agg(v.id)))::int as opened,
      count(distinct r.user_id)::int as signed_up,
      count(distinct r.user_id) filter (where u.last_seen_at > r.redeemed_at + interval '1 day')::int as came_back,
      max(r.redeemed_at) as last_signup
    from vouchers v
    left join voucher_redemptions r on r.voucher_id = v.id
    left join users u on u.id = r.user_id
    where v.batch_id is null or (v.batch_id not like 'invite:%' and v.batch_id not like 'program:%')
    group by 1
    order by issued desc
    limit 40`)).rows;

  // Codes sent from inside the app (brand creator passes, program invites).
  const invites = (await db.execute(sql`
    select case when v.batch_id like 'program:%' then 'Program invites' else 'Brand creator passes' end as source,
      count(*)::int as sent,
      count(r.id)::int as signed_up
    from vouchers v left join voucher_redemptions r on r.voucher_id = v.id
    where v.batch_id like 'invite:%' or v.batch_id like 'program:%'
    group by 1`)).rows;

  const people = (await db.execute(sql`
    select u.id, u.email, u.display_name, u.role, u.created_at, u.last_login_at, u.last_seen_at, u.login_count,
      coalesce(u.is_admin, false) as is_admin,
      (select count(*) from videos v where v.creator_id = u.id)::int as videos,
      (select e.path from activity_events e where e.user_id = u.id and e.type = 'page_view' order by e.at desc limit 1) as last_page,
      (select coalesce(nullif(v.partner, ''), v.label) from voucher_redemptions r join vouchers v on v.id = r.voucher_id where r.user_id = u.id limit 1) as via_code,
      ${sourceOf} as source,
      ${subscribedAtOf} as subscribed_at
    -- The team's own accounts are listed too, marked, so they can find their
    -- own videos and visits (client, 27 Oct 2026); every total above still
    -- leaves them out.
    from users u
    order by coalesce(u.last_seen_at, u.created_at) desc nulls last
    limit 200`)).rows;

  return { days, totals, landing, exits, devices, codes, invites, people };
}

/**
 * One person, for the admin's one-pager (client, 24 Oct 2026: "should the users
 * be clicked on to reveal a one-pager with their stats and charts?"). The
 * daily series cover the last 30 days.
 */
export async function personReport(userId: string) {
  const person = (await db.execute(sql`
    select u.id, u.email, u.display_name, u.role, u.created_at, u.last_login_at, u.last_seen_at, u.login_count,
      u.free_access_until, u.email_opt_out_at, ${sourceOf} as source, ${subscribedAtOf} as subscribed_at,
      (select s.plan from brand_subscriptions s where s.user_id = u.id and s.status in ('active', 'trialing') limit 1) as plan,
      (select b.name from brands b where b.owner_id = u.id order by b.name limit 1) as brand_name,
      (select e.segment from email_journey_enrollments e where e.user_id = u.id) as journey,
      u.journey_segment, coalesce(u.is_admin, false) as is_admin
    from users u where u.id = ${userId}`)).rows[0];
  if (!person) return null;

  const totals = (await db.execute(sql`
    select
      (select count(*) from videos v where v.creator_id = ${userId})::int as videos,
      -- Counted from the events, like the charts and the competition ranking, so
      -- the headline and the trend can never disagree.
      (select count(*) from analytics_events a where a.creator_id = ${userId} and a.event_type = 'view')::int as views,
      (select count(*) from analytics_events a where a.creator_id = ${userId} and a.event_type = 'click')::int as clicks,
      (select coalesce(sum(v.total_revenue), 0) from videos v where v.creator_id = ${userId})::float as revenue,
      (select count(distinct vb.brand_id) from videos v join video_brands vb on vb.video_id = v.id where v.creator_id = ${userId})::int as brands_tagged,
      (select count(*) from activity_events e where e.user_id = ${userId} and e.type = 'page_view')::int as page_views`)).rows[0];

  // One row per day for 30 days, zeros included, so the charts never skip a day.
  const daily = (await db.execute(sql`
    with d as (select generate_series(current_date - 29, current_date, interval '1 day')::date as day)
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(*) from analytics_events a where a.creator_id = ${userId} and a.event_type = 'view' and a.created_at::date = d.day)::int as views,
      (select count(*) from analytics_events a where a.creator_id = ${userId} and a.event_type = 'click' and a.created_at::date = d.day)::int as clicks,
      (select count(*) from activity_events e where e.user_id = ${userId} and e.type = 'page_view' and e.at::date = d.day)::int as visits
    from d order by d.day`)).rows;

  const videos = (await db.execute(sql`
    select v.id, v.title, v.status, v.created_at,
      (select count(*) from analytics_events a where a.video_id = v.id and a.event_type = 'view')::int as views,
      (select count(*) from analytics_events a where a.video_id = v.id and a.event_type = 'click')::int as clicks,
      coalesce(v.total_revenue, 0)::float as revenue,
      (select count(*) from video_brands vb where vb.video_id = v.id)::int as brands
    from videos v where v.creator_id = ${userId} order by v.created_at desc limit 50`)).rows;

  const pages = (await db.execute(sql`
    select e.path, e.at, e.device from activity_events e
    where e.user_id = ${userId} and e.type = 'page_view' order by e.at desc limit 12`)).rows;

  const emails = (await db.execute(sql`
    select t.subject, t.position, s.status, s.at from email_journey_sends s join email_journey_steps t on t.id = s.step_id
    where s.user_id = ${userId} and s.status = 'sent' order by s.at desc limit 20`)).rows;

  const { factsFor } = await import("./journeyStore");
  const f = (await factsFor([userId])).get(userId);
  return {
    person, daily, videos, pages, emails,
    totals: { ...totals, invitesSent: f?.invitesSent ?? 0, invitesJoined: f?.invitesJoined ?? 0, products: f?.products ?? 0 },
  };
}

/**
 * The Most Engaged Video competition (client, 24 Oct 2026): every creator's
 * videos with views and product clicks over a period, each with its creator's
 * source, so the admin can compare Paris Creator Week against Partner A and
 * so on. Counted from the analytics events, so a period means that period.
 */
export async function engagementReport(days: number | null) {
  const since = days ? sql`now() - make_interval(days => ${days})` : sql`'-infinity'::timestamp`;
  const rows = (await db.execute(sql`
    select v.id, v.title, v.status, u.id as creator_id, u.display_name as creator, u.email, ${sourceOf} as source,
      count(a.id) filter (where a.event_type = 'view')::int as views,
      count(a.id) filter (where a.event_type = 'click')::int as clicks
    from videos v
    join users u on u.id = v.creator_id and not coalesce(u.is_admin, false)
    left join analytics_events a on a.video_id = v.id and a.created_at >= ${since}
    group by v.id, u.id
    order by clicks desc, views desc
    limit 300`)).rows as any[];
  return rows.map((r) => ({ ...r, ctr: r.views > 0 ? Math.round((r.clicks / r.views) * 1000) / 10 : 0 }));
}
