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
import type { cleanPageView } from "./activityRules";

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
export async function recordSignup(userId: string): Promise<void> {
  await db.execute(sql`insert into activity_events (type, user_id) values ('signup', ${userId})`);
}

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
      (select e.path from activity_events e where e.user_id = u.id and e.type = 'page_view' order by e.at desc limit 1) as last_page,
      (select coalesce(nullif(v.partner, ''), v.label) from voucher_redemptions r join vouchers v on v.id = r.voucher_id where r.user_id = u.id limit 1) as via_code
    from users u
    where not u.is_admin
    order by coalesce(u.last_seen_at, u.created_at) desc nulls last
    limit 200`)).rows;

  return { days, totals, landing, exits, devices, codes, invites, people };
}
