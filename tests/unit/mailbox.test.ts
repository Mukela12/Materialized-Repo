import { describe, it, expect } from 'vitest';
import {
  buildNotifications,
  countUnread,
  parseMailboxId,
  fromPublisherNotification,
  fromOutreach,
  fromInvitation,
} from '../../server/mailbox';

const t0 = new Date('2026-01-01T00:00:00.000Z');
const t1 = new Date('2026-01-02T00:00:00.000Z');
const t2 = new Date('2026-01-03T00:00:00.000Z');

describe('fromPublisherNotification', () => {
  it('maps a performance warning to a campaign notification, id prefixed pub-', () => {
    const n = fromPublisherNotification({ id: 42, type: 'performance_warning', message: 'slow', campaignName: 'C', createdAt: t0, isRead: false });
    expect(n.id).toBe('pub-42');
    expect(n.type).toBe('campaign');
    expect(n.title).toBe('Campaign update');
    expect(n.body).toBe('slow');
    expect(n.read).toBe(false);
    expect(n.time).toBe(t0.toISOString());
  });

  it('maps a deactivation to a warning and honors the persisted read flag', () => {
    const n = fromPublisherNotification({ id: 7, type: 'deactivation', message: null, campaignName: 'C', createdAt: t0, isRead: true });
    expect(n.type).toBe('warning');
    expect(n.title).toBe('Publisher deactivated');
    expect(n.body).toBe('Campaign: C');
    expect(n.read).toBe(true);
  });

  it('defaults read to false when isRead is null/undefined', () => {
    expect(fromPublisherNotification({ id: 1, isRead: null }).read).toBe(false);
    expect(fromPublisherNotification({ id: 2 }).read).toBe(false);
  });
});

describe('fromOutreach', () => {
  it('is unread only while pending', () => {
    expect(fromOutreach({ id: 1, brandName: 'B', status: 'pending', createdAt: t0 }).read).toBe(false);
    expect(fromOutreach({ id: 2, brandName: 'B', status: 'authorized', createdAt: t0 }).read).toBe(true);
    expect(fromOutreach({ id: 3, brandName: 'B', status: 'declined', createdAt: t0 }).read).toBe(true);
  });

  it('marks authorized as success and pending as info, and includes video title', () => {
    const ok = fromOutreach({ id: 1, brandName: 'B', status: 'authorized', videoTitle: 'V', createdAt: t0 });
    expect(ok.type).toBe('success');
    expect(ok.body).toBe('Status: authorized — Video: V');
    expect(fromOutreach({ id: 2, brandName: 'B', status: 'pending', createdAt: t0 }).type).toBe('info');
  });
});

describe('fromInvitation', () => {
  it('is unread only while pending; accepted=success, declined=warning', () => {
    expect(fromInvitation({ id: 1, creatorName: 'C', status: 'pending', createdAt: t0 }).read).toBe(false);
    expect(fromInvitation({ id: 2, creatorName: 'C', status: 'accepted', createdAt: t0 }).read).toBe(true);
    expect(fromInvitation({ id: 1, creatorName: 'C', status: 'accepted' }).type).toBe('success');
    expect(fromInvitation({ id: 2, creatorName: 'C', status: 'declined' }).type).toBe('warning');
  });
});

describe('buildNotifications', () => {
  it('affiliate role uses only publisher notifications', () => {
    const out = buildNotifications('affiliate', {
      pubNotifs: [{ id: 1, createdAt: t1, isRead: false }, { id: 2, createdAt: t2, isRead: true }],
      outreaches: [{ id: 9, createdAt: t0, status: 'pending' }], // ignored for this role
    });
    expect(out.map(n => n.id)).toEqual(['pub-2', 'pub-1']); // newest first
  });

  it('creator role uses only outreaches, capped at 10', () => {
    const outreaches = Array.from({ length: 15 }, (_, i) => ({ id: i, createdAt: t0, status: 'pending' }));
    const out = buildNotifications('creator', { outreaches, pubNotifs: [{ id: 1, isRead: false }] });
    expect(out).toHaveLength(10);
    expect(out.every(n => n.id.startsWith('outreach-'))).toBe(true);
  });

  it('brand role uses only invitations, capped at 10', () => {
    const invites = Array.from({ length: 12 }, (_, i) => ({ id: i, creatorName: 'C', createdAt: t0, status: 'pending' }));
    const out = buildNotifications('brand', { invites });
    expect(out).toHaveLength(10);
    expect(out.every(n => n.id.startsWith('invite-'))).toBe(true);
  });

  it('unknown/absent role yields an empty feed', () => {
    expect(buildNotifications('admin', { pubNotifs: [{ id: 1 }] })).toEqual([]);
    expect(buildNotifications(null, {})).toEqual([]);
  });

  it('sorts strictly by time descending', () => {
    const out = buildNotifications('affiliate', {
      pubNotifs: [
        { id: 1, createdAt: t0, isRead: false },
        { id: 2, createdAt: t2, isRead: false },
        { id: 3, createdAt: t1, isRead: false },
      ],
    });
    expect(out.map(n => n.id)).toEqual(['pub-2', 'pub-3', 'pub-1']);
  });
});

describe('countUnread', () => {
  it('counts only unread items', () => {
    const out = buildNotifications('affiliate', {
      pubNotifs: [{ id: 1, isRead: false }, { id: 2, isRead: true }, { id: 3, isRead: false }],
    });
    expect(countUnread(out)).toBe(2);
  });

  it('returns 0 for an empty feed', () => {
    expect(countUnread([])).toBe(0);
  });
});

describe('parseMailboxId', () => {
  it('parses a real publisher notification id to a positive integer', () => {
    expect(parseMailboxId('pub-42')).toEqual({ source: 'pub', numericId: 42, rawId: '42' });
  });

  it('parses computed sources without a numeric id', () => {
    expect(parseMailboxId('outreach-7')).toEqual({ source: 'outreach', rawId: '7' });
    expect(parseMailboxId('invite-abc')).toEqual({ source: 'invite', rawId: 'abc' });
  });

  it('rejects unknown prefixes, empty ids, and non-positive pub ids', () => {
    expect(parseMailboxId('bogus-1')).toBeNull();
    expect(parseMailboxId('pub-')).toBeNull();
    expect(parseMailboxId('pub-0')).toBeNull();
    expect(parseMailboxId('pub--1')).toBeNull();
    expect(parseMailboxId('pub-1.5')).toBeNull();
    expect(parseMailboxId('pub-abc')).toBeNull();
    expect(parseMailboxId('nodash')).toBeNull();
    expect(parseMailboxId('')).toBeNull();
    // @ts-expect-error — defensive: non-string input
    expect(parseMailboxId(null)).toBeNull();
  });
});
