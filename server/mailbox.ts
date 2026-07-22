/**
 * Mailbox / Activity center — pure helpers.
 *
 * The mailbox is a read-only, role-aware activity feed. It synthesizes a common
 * notification shape on the fly from three real platform sources:
 *   - affiliate  -> publisher_notifications (the ONLY source with a persistable
 *                   read flag, via `is_read`)
 *   - creator    -> brand outreach requests (read derived from status)
 *   - brand      -> creator invitations      (read derived from status)
 *
 * Keeping the aggregation and id-parsing here (pure, DB-free) lets the routes
 * stay thin and lets us unit-test the logic without a database — matching the
 * codebase idiom (server/authz.ts, server/feeConfig.ts).
 */

export type MailboxNotificationType =
  | "success"
  | "warning"
  | "payment"
  | "campaign"
  | "info"
  | "system";

export interface MailboxNotification {
  id: string;
  type: MailboxNotificationType;
  title: string;
  body: string;
  time: string; // ISO 8601
  read: boolean;
}

// Minimal shapes we depend on — kept loose so callers can pass DB rows directly.
interface PubNotifLike {
  id: number;
  type?: string | null;
  message?: string | null;
  campaignName?: string | null;
  createdAt?: Date | string | null;
  isRead?: boolean | null;
}

interface OutreachLike {
  id: number | string;
  brandName?: string | null;
  videoTitle?: string | null;
  status?: string | null;
  createdAt?: Date | string | null;
}

interface InviteLike {
  id: number | string;
  creatorName?: string | null;
  status?: string | null;
  createdAt?: Date | string | null;
}

function toIso(value: Date | string | null | undefined): string {
  if (!value) return new Date().toISOString();
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

/** Map a publisher_notifications row to the common mailbox shape. */
export function fromPublisherNotification(pn: PubNotifLike): MailboxNotification {
  const isDeactivation = pn.type === "deactivation";
  return {
    id: `pub-${pn.id}`,
    type: isDeactivation ? "warning" : "campaign",
    title: isDeactivation ? "Publisher deactivated" : "Campaign update",
    body: pn.message || `Campaign: ${pn.campaignName || "Unknown"}`,
    time: toIso(pn.createdAt),
    read: pn.isRead ?? false,
  };
}

/** Map a brand outreach request to the common mailbox shape (read is computed). */
export function fromOutreach(o: OutreachLike): MailboxNotification {
  const status = o.status || "pending";
  return {
    id: `outreach-${o.id}`,
    type: status === "authorized" ? "success" : status === "pending" ? "info" : "campaign",
    title: `Brand outreach: ${o.brandName || "Brand"}`,
    body: `Status: ${status}${o.videoTitle ? ` — Video: ${o.videoTitle}` : ""}`,
    time: toIso(o.createdAt),
    read: status !== "pending",
  };
}

/** Map a creator invitation to the common mailbox shape (read is computed). */
export function fromInvitation(inv: InviteLike): MailboxNotification {
  const status = inv.status || "pending";
  return {
    id: `invite-${inv.id}`,
    type: status === "accepted" ? "success" : status === "declined" ? "warning" : "info",
    title: `Creator invitation: ${inv.creatorName || "Creator"}`,
    body: `Status: ${status}`,
    time: toIso(inv.createdAt),
    read: status !== "pending",
  };
}

export interface MailboxSources {
  pubNotifs?: PubNotifLike[];
  outreaches?: OutreachLike[];
  invites?: InviteLike[];
}

/**
 * Build the role-aware, time-sorted (newest first) notification list from the
 * raw source rows a caller has already fetched for the given role.
 */
export function buildNotifications(
  role: string | null | undefined,
  sources: MailboxSources,
): MailboxNotification[] {
  const out: MailboxNotification[] = [];

  if (role === "affiliate") {
    for (const pn of sources.pubNotifs ?? []) out.push(fromPublisherNotification(pn));
  }
  if (role === "creator") {
    for (const o of (sources.outreaches ?? []).slice(0, 10)) out.push(fromOutreach(o));
  }
  if (role === "brand") {
    for (const inv of (sources.invites ?? []).slice(0, 10)) out.push(fromInvitation(inv));
  }

  out.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return out;
}

/** Count unread items in an already-built notification list. */
export function countUnread(notifications: MailboxNotification[]): number {
  return notifications.reduce((n, item) => (item.read ? n : n + 1), 0);
}

export type MailboxIdSource = "pub" | "outreach" | "invite";

export interface ParsedMailboxId {
  source: MailboxIdSource;
  /** Numeric id for `pub-` (a real publisher_notifications row). Raw string otherwise. */
  numericId?: number;
  rawId: string;
}

/**
 * Parse a composite mailbox id (`pub-42`, `outreach-7`, `invite-3`) into its
 * source and id. Returns null for anything that doesn't match a known prefix.
 * Only `pub-<n>` maps to a row with a persistable read flag.
 */
export function parseMailboxId(id: string): ParsedMailboxId | null {
  if (typeof id !== "string") return null;
  const dash = id.indexOf("-");
  if (dash <= 0) return null;
  const prefix = id.slice(0, dash);
  const rest = id.slice(dash + 1);
  if (rest.length === 0) return null;

  if (prefix === "pub") {
    const n = Number(rest);
    if (!Number.isInteger(n) || n <= 0) return null;
    return { source: "pub", numericId: n, rawId: rest };
  }
  if (prefix === "outreach" || prefix === "invite") {
    return { source: prefix, rawId: rest };
  }
  return null;
}
