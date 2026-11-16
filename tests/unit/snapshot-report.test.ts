import { describe, it, expect, vi } from 'vitest';
import {
  snapshotWindow, snapshotRecipients, formatMoney, change, renderSnapshotEmail, runSnapshotReport,
  type Snapshot, type Totals,
} from '../../server/snapshotReport';

const zero: Totals = { active: 0, newAccounts: 0, videos: 0, productsTagged: 0, sales: 0, revenue: [] };

describe('snapshotWindow', () => {
  it('Thursday covers Monday 07:00 to Thursday 07:00, compared with the 3 days before', () => {
    const w = snapshotWindow(new Date('2026-11-19T07:05:00Z'))!;
    expect(w.from.toISOString()).toBe('2026-11-16T07:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-19T07:00:00.000Z');
    expect(w.prevFrom.toISOString()).toBe('2026-11-13T07:00:00.000Z');
  });

  it('Monday covers Thursday to Monday', () => {
    const w = snapshotWindow(new Date('2026-11-23T07:00:30Z'))!;
    expect(w.from.toISOString()).toBe('2026-11-19T07:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-11-23T07:00:00.000Z');
  });

  it('skips a slot missed by more than 6 hours, so a deploy never sends a stale report', () => {
    expect(snapshotWindow(new Date('2026-11-16T16:30:00Z'))).toBeNull();
    expect(snapshotWindow(new Date('2026-11-16T12:59:00Z'))).not.toBeNull();
  });
});

describe('snapshotRecipients', () => {
  it('defaults to the admin and ops addresses', () => {
    expect(snapshotRecipients({ ADMIN_EMAIL: 'Beth@Example.com', OPS_ALERT_EMAIL: 'ops@example.com' } as any))
      .toEqual(['beth@example.com', 'ops@example.com']);
  });

  it('takes an override list, dropping blanks, duplicates and junk', () => {
    expect(snapshotRecipients({ SNAPSHOT_REPORT_TO: 'a@x.com, A@x.com, ,nope' } as any)).toEqual(['a@x.com']);
  });
});

describe('formatting', () => {
  it('money per currency', () => {
    expect(formatMoney([])).toBe('$0');
    expect(formatMoney([{ currency: 'usd', cents: 4900 }, { currency: 'eur', cents: 1250 }])).toBe('$49 + €12.50');
  });

  it('change against the period before', () => {
    expect(change(3, 1)).toBe('up 2');
    expect(change(0, 1)).toBe('down 1');
    expect(change(2, 2)).toBe('same as before');
  });
});

const snap: Snapshot = {
  from: new Date('2026-11-16T07:00:00Z'), to: new Date('2026-11-19T07:00:00Z'),
  current: { ...zero, active: 4, newAccounts: 2, sales: 1, revenue: [{ currency: 'usd', cents: 4900 }] },
  previous: { ...zero, active: 1 },
  totalAccounts: 26,
  partners: [{ name: 'Linka <script>', passes: 1, signedUp: 1, newSignUps: 1, signedIn: 1, uploaded: 0, tagged: 0, sales: 0, revenue: [] }],
  otherPasses: { name: 'Event and GTM passes', passes: 400, signedUp: 3, newSignUps: 0, signedIn: 1, uploaded: 0, tagged: 0, sales: 0, revenue: [] },
  mostActive: [{ name: 'Sheila', role: 'affiliate', source: 'Linka', pages: 12 }],
};

describe('renderSnapshotEmail', () => {
  const { subject, html } = renderSnapshotEmail(snap);

  it('leads with the headline numbers', () => {
    expect(subject).toBe('MTRLZD snapshot, Thu 19 Nov: 4 active, 2 new, 1 sale');
    expect(html).toContain('Active accounts');
    expect(html).toContain('up 3');
    expect(html).toContain('$49');
  });

  it('lists partners with new sign-ups marked, and the event passes as one row', () => {
    expect(html).toContain('(+1)');
    expect(html).toContain('Event and GTM passes');
    expect(html).toContain('publisher');
  });

  it('shows ten partners in full and names the quiet rest in one line', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ ...snap.partners[0], name: `P${i}`, signedUp: i === 12 ? 2 : 0, newSignUps: 0 }));
    const out = renderSnapshotEmail({ ...snap, partners: many }).html;
    expect(out).toContain('>P12</td>');
    expect(out).toContain('Also 3 more partners nobody has joined with yet: P9, P10, P11.');
  });

  it('escapes names and carries no em dashes or emoji', () => {
    expect(html).not.toContain('<script>');
    expect(html).toContain('Linka &lt;script&gt;');
    expect(html + subject).not.toMatch(/—/);
    expect(html + subject).not.toMatch(/\p{Extended_Pictographic}/u);
  });
});

describe('runSnapshotReport', () => {
  const exec = vi.fn(async () => ({ rows: [{}] }));

  it('does nothing outside a slot unless forced', async () => {
    const send = vi.fn(async () => {});
    const r = await runSnapshotReport({ exec, send, now: new Date('2026-11-17T12:00:00Z'), recipients: ['a@x.com'] });
    expect(r.status).toBe('skipped');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends to each recipient in a slot', async () => {
    const send = vi.fn(async () => {});
    const r = await runSnapshotReport({ exec, send, now: new Date('2026-11-19T07:01:00Z'), recipients: ['a@x.com', 'b@x.com'] });
    expect(r.status).toBe('success');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('forced, covers the time since the last slot', async () => {
    const send = vi.fn(async (_to: string, subject: string) => { expect(subject).toContain('Tue 17 Nov'); });
    const r = await runSnapshotReport({ exec, send, now: new Date('2026-11-17T12:00:00Z'), force: true, recipients: ['a@x.com'] });
    expect(r.status).toBe('success');
  });

  it('reports a failed send instead of passing quietly', async () => {
    const send = vi.fn(async () => { throw new Error('rate limited'); });
    const r = await runSnapshotReport({ exec, send, now: new Date('2026-11-19T07:01:00Z'), recipients: ['a@x.com'] });
    expect(r.status).toBe('failed');
  });
});
