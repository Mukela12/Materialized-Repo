/**
 * The Creator Toolkit (client, 18 Nov 2026): the creator homepage's partner
 * tool cards, Creator Challenge card and Creator Film Awards banner. Content
 * and calendar live in shared/creatorToolkit.ts; this file stores them.
 *
 * videos.challenge_month is deliberately NOT in the Drizzle schema: the video
 * PATCH route accepts the table's columns, and entering the challenge must go
 * through enterChallenge, which checks the entry window and the owner.
 */
import { sql } from "drizzle-orm";
import {
  DEFAULT_TOOLKIT, toolkitSchema, challengeStatus, judgingWindow, toolIsLive, announcementIsLive,
  type CreatorToolkit,
} from "@shared/creatorToolkit";

const KEY = "creator_toolkit";
type Db = { execute: (q: any) => Promise<{ rows: any[] }> };
async function db(): Promise<Db> {
  return (await import("./db")).db as unknown as Db;
}

/** The saved toolkit, or the defaults when nothing valid is saved. */
export async function getToolkit(): Promise<CreatorToolkit> {
  const r = await (await db()).execute(sql`select value from site_content where key = ${KEY}`);
  const parsed = toolkitSchema.safeParse(r.rows[0]?.value);
  return parsed.success ? parsed.data : DEFAULT_TOOLKIT;
}

export async function saveToolkit(value: CreatorToolkit, by: string): Promise<void> {
  await (await db()).execute(sql`
    insert into site_content (key, value, updated_by, updated_at)
    values (${KEY}, ${JSON.stringify(value)}::jsonb, ${by}, localtimestamp)
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = localtimestamp`);
}

/**
 * What a creator's homepage gets: only live tool cards (with their position,
 * which the click counter is keyed by), the challenge and the awards, the
 * calendar, and the viewer's own entry and registration.
 */
export async function toolkitForViewer(userId: string, now: Date = new Date()) {
  const t = await getToolkit();
  const status = challengeStatus(now);
  const d = await db();
  const [entries, reg] = await Promise.all([
    d.execute(sql`select id, title from videos where creator_id = ${userId} and challenge_month = ${status.month} order by created_at`),
    d.execute(sql`select handle from film_award_registrations where user_id = ${userId}`),
  ]);
  return {
    tools: t.tools.map((tool, i) => ({ ...tool, slot: i })).filter(toolIsLive),
    challenge: t.challenge,
    awards: t.awards,
    announcement: announcementIsLive(t.announcement) ? t.announcement : null,
    status,
    myEntries: entries.rows as { id: string; title: string }[],
    registeredHandle: (reg.rows[0]?.handle as string | undefined) ?? null,
  };
}

/** Count a click on tool card `slot` and return where it goes, or null for no live card there. */
export async function recordToolClick(slot: number, userId: string | null): Promise<string | null> {
  const t = await getToolkit();
  const tool = t.tools[slot];
  if (!tool || !toolIsLive(tool)) return null;
  await (await db()).execute(sql`insert into toolkit_clicks (tool_name, link_url, user_id) values (${tool.name}, ${tool.linkUrl}, ${userId})`);
  return tool.linkUrl;
}

export type EntryResult = { ok: true; month: string | null } | { ok: false; status: number; error: string };

/**
 * Enter (or withdraw) one of the creator's own videos in this month's
 * challenge. Entering is only possible while entries are open; withdrawing
 * only for this month's entry.
 */
export async function setChallengeEntry(videoId: string, userId: string, enter: boolean, now: Date = new Date()): Promise<EntryResult> {
  const d = await db();
  const r = await d.execute(sql`select creator_id, challenge_month from videos where id = ${videoId}`);
  const v = r.rows[0];
  if (!v) return { ok: false, status: 404, error: "Video not found" };
  if (v.creator_id !== userId) return { ok: false, status: 403, error: "You can only enter your own videos" };
  const status = challengeStatus(now);
  if (enter) {
    if (!status.open) return { ok: false, status: 409, error: "Entries are open from the 1st to the 15th of each month" };
    if (v.challenge_month && v.challenge_month !== status.month) return { ok: false, status: 409, error: "This video was already entered in an earlier month" };
    await d.execute(sql`update videos set challenge_month = ${status.month} where id = ${videoId}`);
    return { ok: true, month: status.month };
  }
  if (v.challenge_month !== status.month || !status.open) return { ok: false, status: 409, error: "Only this month's entry can be withdrawn while entries are open" };
  await d.execute(sql`update videos set challenge_month = null where id = ${videoId}`);
  return { ok: true, month: null };
}

export async function registerForFilmAwards(userId: string, email: string, handle: string): Promise<void> {
  const h = handle.startsWith("@") ? handle : `@${handle}`;
  await (await db()).execute(sql`
    insert into film_award_registrations (user_id, email, handle) values (${userId}, ${email}, ${h})
    on conflict (user_id) do update set email = excluded.email, handle = excluded.handle, updated_at = localtimestamp`);
}

/**
 * Admin's report: clicks per tool (all time and last 30 days), Film Awards
 * registrations, and a month's challenge entries with what each did from the
 * 1st of the month to the 15th of the next (the judging window). Sales are
 * real orders (accruals and in-video orders); reposts are first pick-ups by
 * anyone other than the creator.
 */
export async function toolkitReport(month: string, now: Date = new Date()) {
  const w = judgingWindow(month);
  if (!w) return null;
  const to = w.to.getTime() > now.getTime() ? now : w.to;
  const d = await db();
  const [clicks, regs, entries] = await Promise.all([
    d.execute(sql`
      select tool_name, count(*)::int as total,
        count(*) filter (where created_at >= localtimestamp - interval '30 days')::int as last30
      from toolkit_clicks group by 1 order by 2 desc`),
    d.execute(sql`
      select r.email, r.handle, r.created_at, u.display_name, u.role::text as role
      from film_award_registrations r join users u on u.id = r.user_id
      order by r.created_at desc limit 2000`),
    d.execute(sql`
      with e as (
        select v.id, v.title, v.creator_id, v.thumbnail_url from videos v where v.challenge_month = ${month}
      )
      select e.id, e.title, e.thumbnail_url, u.display_name as creator, u.email,
        (select count(*) from analytics_events a where a.video_id = e.id and a.event_type = 'view' and a.created_at >= ${w.from} and a.created_at < ${to})::int as views,
        (select count(*) from analytics_events a where a.video_id = e.id and a.event_type = 'click' and a.created_at >= ${w.from} and a.created_at < ${to})::int as clicks,
        ((select count(*) from platform_fee_accruals f where f.video_id = e.id and f.attribution_state = 'attributed' and f.status <> 'void'
            and f.occurred_at >= ${w.from} and f.occurred_at < ${to})
         + (select count(*) from video_orders o where o.video_id = e.id and o.status = 'paid' and o.paid_at >= ${w.from} and o.paid_at < ${to}
            and not exists (select 1 from platform_fee_accruals f where f.store_connection_id is null and f.external_order_id = o.stripe_checkout_session_id)))::int as sales,
        (select count(distinct r.who) from (
            select ed.affiliate_id as who, ed.first_seen_at as at from embed_deployments ed where ed.video_id = e.id
            union all select ca.affiliate_id, ca.created_at from campaign_affiliates ca where ca.video_id = e.id
          ) r where r.who <> e.creator_id and r.at >= ${w.from} and r.at < ${to})::int as reposts
      from e join users u on u.id = e.creator_id`),
  ]);
  const ranked = (entries.rows as any[])
    .map((r) => ({ ...r, total: r.views + r.clicks + r.sales + r.reposts }))
    .sort((a, b) => b.total - a.total || b.sales - a.sales || b.clicks - a.clicks || String(a.title).localeCompare(String(b.title)));
  return {
    month,
    window: { from: w.from.toISOString(), to: w.to.toISOString() },
    clicks: clicks.rows as { tool_name: string; total: number; last30: number }[],
    registrations: regs.rows as { email: string; handle: string; created_at: string; display_name: string; role: string }[],
    entries: ranked as { id: string; title: string; thumbnail_url: string | null; creator: string; email: string; views: number; clicks: number; sales: number; reposts: number; total: number }[],
  };
}
