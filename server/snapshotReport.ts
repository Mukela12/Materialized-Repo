/**
 * The Monday and Thursday snapshot email (client, 16 Nov 2026).
 *
 * The client asked for "a high level snapshot" twice a week so she can see how
 * the platform is doing without signing in: sign-ins, new accounts, videos,
 * sales and revenue, and for each partner how many of their passes became
 * accounts, how many of those signed in, uploaded a video, tagged a product
 * and made a sale.
 *
 * Each report covers the time since the previous one (Thursday's covers Monday
 * to Thursday, Monday's covers Thursday to Monday) and compares it with the
 * same length of time before that. Admin accounts are left out of every
 * figure, as on the Activity tab, so the team's own testing never reads as
 * traction.
 *
 * Sent to the admin address (ADMIN_EMAIL) and the ops address
 * (OPS_ALERT_EMAIL), or to SNAPSHOT_REPORT_TO when that is set (comma
 * separated).
 */
import { sql } from "drizzle-orm";
import { parseCron, previousOccurrence } from "./cron";

/** Mondays and Thursdays at 07:00 UTC: 8am in Paris through the winter. */
export const SNAPSHOT_JOB = "snapshot-report";
export const DEFAULT_SNAPSHOT_CRON = "0 7 * * 1,4";

/**
 * A report found more than this long after its slot is skipped, not sent
 * late. The scheduler catches up missed slots, so without this the first
 * deploy on a Monday afternoon would send Monday's 8am report at teatime.
 */
export const LATE_LIMIT_MS = 6 * 3600_000;

/** Partner rows shown in full; the rest are named in one line. */
export const PARTNER_ROWS = 10;

export interface Money { currency: string; cents: number }

export interface Totals {
  /** Accounts that signed in, or used the app while signed in. */
  active: number;
  newAccounts: number;
  videos: number;
  productsTagged: number;
  sales: number;
  revenue: Money[];
}

export interface PartnerRow {
  name: string;
  passes: number;
  signedUp: number;
  newSignUps: number;
  signedIn: number;
  uploaded: number;
  tagged: number;
  sales: number;
  revenue: Money[];
}

export interface ActiveAccount { name: string; role: string; source: string; pages: number }

export interface Snapshot {
  from: Date;
  to: Date;
  current: Totals;
  previous: Totals;
  totalAccounts: number;
  partners: PartnerRow[];
  /** Every pass not tagged to a partner (events, GTM batches), as one row. */
  otherPasses: PartnerRow;
  mostActive: ActiveAccount[];
}

/** The window a report run at `now` covers, or null when the slot is stale. */
export function snapshotWindow(
  now: Date,
  cron = DEFAULT_SNAPSHOT_CRON,
): { due: Date; from: Date; to: Date; prevFrom: Date } | null {
  const spec = parseCron(cron);
  const due = previousOccurrence(spec, now);
  if (!due || now.getTime() - due.getTime() > LATE_LIMIT_MS) return null;
  const before = previousOccurrence(spec, new Date(due.getTime() - 60_000));
  if (!before) return null;
  const span = due.getTime() - before.getTime();
  return { due, from: before, to: due, prevFrom: new Date(before.getTime() - span) };
}

export function snapshotRecipients(env: NodeJS.ProcessEnv = process.env): string[] {
  const list = env.SNAPSHOT_REPORT_TO
    ? env.SNAPSHOT_REPORT_TO.split(",")
    : [env.ADMIN_EMAIL || "missbethanieashton@gmail.com", env.OPS_ALERT_EMAIL || "mukela.j.katungu@gmail.com"];
  return Array.from(new Set(list.map((s) => s.trim().toLowerCase()).filter((s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s))));
}

// ── Reading the numbers ─────────────────────────────────────────────────────

type Exec = (q: ReturnType<typeof sql>) => Promise<{ rows: any[] }>;

const n = (v: unknown) => Number(v ?? 0) || 0;

function moneyRows(rows: any[]): Money[] {
  return rows.map((r) => ({ currency: String(r.currency || "usd").toLowerCase(), cents: n(r.cents) })).filter((m) => m.cents > 0);
}

const notAdmin = (col: ReturnType<typeof sql>) => sql`not exists (select 1 from users a where a.id = ${col} and a.is_admin)`;

async function totals(exec: Exec, from: Date, to: Date): Promise<Totals> {
  const row = (await exec(sql`
    select
      (select count(distinct e.user_id) from activity_events e
        where e.user_id is not null and e.at >= ${from} and e.at < ${to} and ${notAdmin(sql`e.user_id`)}) as active,
      (select count(*) from users u where u.created_at >= ${from} and u.created_at < ${to} and not coalesce(u.is_admin, false)) as new_accounts,
      (select count(*) from videos v where v.created_at >= ${from} and v.created_at < ${to} and ${notAdmin(sql`v.creator_id`)}) as videos,
      (select count(*) from video_product_overlays o join videos v on v.id = o.video_id
        where o.created_at >= ${from} and o.created_at < ${to} and ${notAdmin(sql`v.creator_id`)}) as tagged,
      (select count(*) from video_orders o where o.status = 'paid' and o.paid_at >= ${from} and o.paid_at < ${to}) as sales
  `)).rows[0] ?? {};
  const revenue = (await exec(sql`
    select lower(currency) as currency, sum(amount_cents) as cents from video_orders
    where status = 'paid' and paid_at >= ${from} and paid_at < ${to} group by 1 order by 2 desc`)).rows;
  return {
    active: n(row.active), newAccounts: n(row.new_accounts), videos: n(row.videos),
    productsTagged: n(row.tagged), sales: n(row.sales), revenue: moneyRows(revenue),
  };
}

/**
 * The pass funnel, one row per partner. Codes a brand or a program sends from
 * inside the app are left out: they are the brand's invites, not the
 * partner's passes, and the Activity tab counts them separately.
 */
async function partnerRows(exec: Exec, from: Date): Promise<{ partners: PartnerRow[]; other: PartnerRow }> {
  const rows = (await exec(sql`
    with passes as (
      select v.id, nullif(v.partner, '') as partner, v.created_at from vouchers v
      where v.batch_id is null or (v.batch_id not like 'invite:%' and v.batch_id not like 'program:%')
    ), joined as (
      select p.partner, r.user_id, r.redeemed_at from passes p join voucher_redemptions r on r.voucher_id = p.id
      where ${notAdmin(sql`r.user_id`)}
    )
    select coalesce(p.partner, '') as name,
      count(distinct p.id) as passes,
      max(p.created_at) as latest,
      (select count(distinct j.user_id) from joined j where j.partner is not distinct from p.partner) as signed_up,
      (select count(distinct j.user_id) from joined j where j.partner is not distinct from p.partner and j.redeemed_at >= ${from}) as new_sign_ups,
      (select count(distinct j.user_id) from joined j join users u on u.id = j.user_id
        where j.partner is not distinct from p.partner and u.login_count > 0) as signed_in,
      (select count(distinct j.user_id) from joined j
        where j.partner is not distinct from p.partner and exists (select 1 from videos v where v.creator_id = j.user_id)) as uploaded,
      (select count(distinct j.user_id) from joined j
        where j.partner is not distinct from p.partner and exists (
          select 1 from videos v join video_product_overlays o on o.video_id = v.id where v.creator_id = j.user_id)) as tagged,
      (select count(*) from video_orders o where o.status = 'paid' and exists (
        select 1 from joined j where j.partner is not distinct from p.partner
          and j.user_id in (o.creator_id, o.brand_user_id, o.affiliate_id))) as sales
    from passes p
    group by p.partner
    order by (p.partner is null), max(p.created_at) desc
  `)).rows;
  const revenue = (await exec(sql`
    with passes as (
      select v.id, nullif(v.partner, '') as partner from vouchers v
      where v.batch_id is null or (v.batch_id not like 'invite:%' and v.batch_id not like 'program:%')
    ), joined as (
      select distinct p.partner, r.user_id from passes p join voucher_redemptions r on r.voucher_id = p.id
    )
    select coalesce(j.partner, '') as name, lower(o.currency) as currency, sum(o.amount_cents) as cents
    from video_orders o join joined j on j.user_id in (o.creator_id, o.brand_user_id, o.affiliate_id)
    where o.status = 'paid'
    group by 1, 2
  `)).rows;
  const toRow = (r: any): PartnerRow => ({
    name: r.name || "Event and GTM passes",
    passes: n(r.passes), signedUp: n(r.signed_up), newSignUps: n(r.new_sign_ups), signedIn: n(r.signed_in),
    uploaded: n(r.uploaded), tagged: n(r.tagged), sales: n(r.sales),
    revenue: moneyRows(revenue.filter((m: any) => (m.name || "") === (r.name || ""))),
  });
  const otherRaw = rows.find((r: any) => !r.name);
  return {
    partners: rows.filter((r: any) => r.name).map(toRow),
    other: otherRaw ? toRow(otherRaw) : { ...toRow({}), name: "Event and GTM passes" },
  };
}

async function mostActive(exec: Exec, from: Date, to: Date): Promise<ActiveAccount[]> {
  const { sourceOf } = await import("./activity");
  return (await exec(sql`
    select u.display_name as name, u.role, ${sourceOf} as source, count(*) as pages
    from activity_events e join users u on u.id = e.user_id
    where e.at >= ${from} and e.at < ${to} and not coalesce(u.is_admin, false)
    group by u.id order by count(*) desc limit 5
  `)).rows.map((r: any) => ({ name: String(r.name ?? ""), role: String(r.role ?? ""), source: String(r.source ?? ""), pages: n(r.pages) }));
}

export async function gatherSnapshot(exec: Exec, w: { from: Date; to: Date; prevFrom: Date }): Promise<Snapshot> {
  const [current, previous, p, active, total] = await Promise.all([
    totals(exec, w.from, w.to),
    totals(exec, w.prevFrom, w.from),
    partnerRows(exec, w.from),
    mostActive(exec, w.from, w.to),
    exec(sql`select count(*) as c from users where not coalesce(is_admin, false)`),
  ]);
  return {
    from: w.from, to: w.to, current, previous,
    totalAccounts: n(total.rows[0]?.c), partners: p.partners, otherPasses: p.other, mostActive: active,
  };
}

// ── Writing the email ───────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function formatMoney(list: Money[]): string {
  if (!list.length) return "$0";
  return list.map((m) => {
    const amount = (m.cents / 100).toLocaleString("en-US", { minimumFractionDigits: m.cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
    const symbol = ({ usd: "$", eur: "€", gbp: "£" } as Record<string, string>)[m.currency];
    return symbol ? `${symbol}${amount}` : `${amount} ${m.currency.toUpperCase()}`;
  }).join(" + ");
}

const day = (d: Date) =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Paris" });

/** "up 3", "down 1" or "same", against the previous window. */
export function change(now: number, before: number): string {
  if (now === before) return "same as before";
  return now > before ? `up ${now - before}` : `down ${before - now}`;
}

export function renderSnapshotEmail(s: Snapshot, appUrl = "https://www.mtrlzd.com"): { subject: string; html: string } {
  const c = s.current, p = s.previous;
  const cards: [string, string, string][] = [
    ["Active accounts", String(c.active), change(c.active, p.active)],
    ["New accounts", String(c.newAccounts), change(c.newAccounts, p.newAccounts)],
    ["Videos uploaded", String(c.videos), change(c.videos, p.videos)],
    ["Products tagged", String(c.productsTagged), change(c.productsTagged, p.productsTagged)],
    ["Sales", String(c.sales), change(c.sales, p.sales)],
    ["Revenue", formatMoney(c.revenue), `before: ${formatMoney(p.revenue)}`],
  ];
  const card = ([label, value, note]: [string, string, string]) => `
    <td width="33%" style="padding:6px;vertical-align:top;">
      <div style="background:#f7f7f5;border:1px solid #ececea;border-radius:10px;padding:14px 12px;">
        <div style="font-size:12px;color:#677A67;font-weight:600;">${esc(label)}</div>
        <div style="font-size:24px;font-weight:800;color:#202120;margin-top:4px;">${esc(value)}</div>
        <div style="font-size:11px;color:#999;margin-top:2px;">${esc(note)}</div>
      </div>
    </td>`;
  const cardRows = [cards.slice(0, 3), cards.slice(3)].map((r) => `<tr>${r.map(card).join("")}</tr>`).join("");

  const th = (t: string, left = false) =>
    `<th style="font-size:11px;color:#677A67;font-weight:600;text-align:${left ? "left" : "right"};padding:6px 4px;border-bottom:1px solid #e8e8e8;">${t}</th>`;
  const td = (t: string, left = false, bold = false) =>
    `<td style="font-size:13px;color:#202120;text-align:${left ? "left" : "right"};padding:2px 4px 8px;border-bottom:1px solid #f0f0f0;${bold ? "font-weight:700;" : ""}">${t}</td>`;
  // The name sits on its own line above the numbers, so seven number columns
  // fit a phone. Partners anyone has joined with come first, then the newest;
  // the rest are named in one line rather than as rows of zeros.
  const nameRow = (name: string) =>
    `<tr><td colspan="7" style="font-size:13px;font-weight:700;color:#202120;padding:10px 4px 2px;">${esc(name)}</td></tr>`;
  const numRow = (r: PartnerRow) => `<tr>
    ${td(String(r.passes))}
    ${td(`${r.signedUp}${r.newSignUps ? ` <span style="color:#3f8f4f;">(+${r.newSignUps})</span>` : ""}`)}
    ${td(String(r.signedIn))}${td(String(r.uploaded))}${td(String(r.tagged))}${td(String(r.sales))}${td(esc(formatMoney(r.revenue)))}
  </tr>`;
  const ranked = [...s.partners].sort((a, b) => Number(b.signedUp > 0) - Number(a.signedUp > 0));
  const shown = ranked.slice(0, PARTNER_ROWS);
  const quiet = ranked.slice(PARTNER_ROWS);
  const rows = [...shown, ...(s.otherPasses.passes ? [s.otherPasses] : [])];
  const partnerTable = rows.length ? `
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;">
      <tr>${th("Passes")}${th("Joined")}${th("Signed in")}${th("Uploaded")}${th("Tagged")}${th("Sales")}${th("Revenue")}</tr>
      ${rows.map((r) => nameRow(r.name) + numRow(r)).join("")}
    </table>
    ${quiet.length ? `<p style="font-size:12px;color:#555;margin-top:10px;">Also ${quiet.length} more ${quiet.length === 1 ? "partner" : "partners"} nobody has joined with yet: ${esc(quiet.map((q) => q.name).join(", "))}.</p>` : ""}
    <p style="font-size:11px;color:#999;margin-top:8px;">Joined, signed in, uploaded and tagged count accounts made with that partner's passes, since the start. (+N) joined since the last report. Sales and revenue are from those accounts' videos.</p>`
    : `<p style="font-size:13px;color:#555;">No partner passes yet.</p>`;

  const active = s.mostActive.length
    ? `<table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;">
        <tr>${th("Account", true)}${th("Type", true)}${th("Came from", true)}${th("Pages")}</tr>
        ${s.mostActive.map((a) => `<tr>${td(esc(a.name), true, true)}${td(esc(a.role === "affiliate" ? "publisher" : a.role), true)}${td(esc(a.source), true)}${td(String(a.pages))}</tr>`).join("")}
      </table>`
    : `<p style="font-size:13px;color:#555;">Nobody outside the team used the app in this period.</p>`;

  const h2 = (t: string) => `<h2 style="font-size:15px;color:#202120;margin:26px 0 4px;">${t}</h2>`;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<style>@media (max-width:480px){.wrap{margin:0 !important;border-radius:0 !important;padding:22px 14px !important}}</style></head>
<body style="margin:0;padding:0;background:#f6f6f6;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div class="wrap" style="max-width:620px;margin:32px auto;background:#ffffff;border-radius:12px;padding:28px 22px;">
    <div style="font-size:12px;letter-spacing:2px;color:#677A67;font-weight:700;">MTRLZD SNAPSHOT</div>
    <h1 style="font-size:20px;color:#202120;margin:6px 0 2px;">${esc(day(s.from))} to ${esc(day(s.to))}</h1>
    <p style="font-size:13px;color:#777;margin:0 0 14px;">Compared with the same number of days before. ${s.totalAccounts} accounts in all, not counting the team.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${cardRows}</table>
    ${h2("Partners")}
    ${partnerTable}
    ${h2("Most active this period")}
    ${active}
    <p style="margin-top:26px;"><a href="${appUrl}/admin" style="display:inline-block;background:#202120;color:#ffffff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 18px;border-radius:8px;">Open the dashboard</a></p>
    <p style="font-size:11px;color:#999;margin-top:18px;">Sent every Monday and Thursday at 8am Paris time. The team's own accounts are left out of every number.</p>
  </div>
</body></html>`;
  const subject = `MTRLZD snapshot, ${day(s.to)}: ${c.active} active, ${c.newAccounts} new, ${c.sales} ${c.sales === 1 ? "sale" : "sales"}`;
  return { subject, html };
}

// ── Running it ──────────────────────────────────────────────────────────────

/**
 * Gather, write and send one report. `force` sends even outside a slot (the
 * admin "send it now" button), covering the time since the last slot.
 */
export async function runSnapshotReport(deps: {
  exec: Exec;
  send: (to: string, subject: string, html: string) => Promise<void>;
  now?: Date;
  force?: boolean;
  recipients?: string[];
  appUrl?: string;
}): Promise<{ status: "success" | "skipped" | "failed"; items: number; detail: string }> {
  const now = deps.now ?? new Date();
  const cron = process.env.SNAPSHOT_CRON || DEFAULT_SNAPSHOT_CRON;
  let w = snapshotWindow(now, cron);
  if (!w && deps.force) {
    const last = previousOccurrence(parseCron(cron), now);
    if (last) w = { due: now, from: last, to: now, prevFrom: new Date(last.getTime() - (now.getTime() - last.getTime())) };
  }
  if (!w) return { status: "skipped", items: 0, detail: "slot missed by more than 6 hours; the next report goes at the next slot" };
  const to = deps.recipients ?? snapshotRecipients();
  if (!to.length) return { status: "skipped", items: 0, detail: "no recipients" };
  const { subject, html } = renderSnapshotEmail(await gatherSnapshot(deps.exec, w), deps.appUrl);
  const failed: string[] = [];
  for (const r of to) {
    try { await deps.send(r, subject, html); } catch (e) { failed.push(`${r}: ${(e as Error)?.message ?? e}`); }
  }
  if (failed.length) return { status: "failed", items: to.length - failed.length, detail: failed.join("; ") };
  return { status: "success", items: to.length, detail: subject };
}
