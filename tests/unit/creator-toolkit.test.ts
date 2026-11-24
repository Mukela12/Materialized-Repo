import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  challengeStatus, judgingWindow, toolkitSchema, toolIsLive, DEFAULT_TOOLKIT, filmAwardRegistrationSchema,
  announcementIsLive, HOVER_MAX, ANNOUNCEMENT_MAX,
} from '../../shared/creatorToolkit';

describe('Creator Challenge calendar', () => {
  it('entries are open from the 1st to the end of the 15th', () => {
    expect(challengeStatus(new Date('2026-12-01T00:00:00Z')).open).toBe(true);
    expect(challengeStatus(new Date('2026-12-15T23:59:59Z')).open).toBe(true);
    expect(challengeStatus(new Date('2026-12-16T00:00:00Z')).open).toBe(false);
    const s = challengeStatus(new Date('2026-11-18T12:00:00Z'));
    expect(s.month).toBe('2026-11');
    expect(s.closesAt).toBe('2026-11-16T00:00:00.000Z');
    expect(s.announceAt).toBe('2026-12-15T00:00:00.000Z');
  });

  it('a month is judged from its 1st to the 15th of the next, across a year end', () => {
    const w = judgingWindow('2026-12')!;
    expect(w.from.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2027-01-15T00:00:00.000Z');
    expect(judgingWindow('2026-13')).toBeNull();
    expect(judgingWindow('nope')).toBeNull();
  });
});

describe('toolkit content', () => {
  it('the defaults are valid and show no tool until one is filled in', () => {
    expect(toolkitSchema.safeParse(DEFAULT_TOOLKIT).success).toBe(true);
    expect(DEFAULT_TOOLKIT.tools.some(toolIsLive)).toBe(false);
  });

  it('links must be https, so a card can never point at javascript: or plain http', () => {
    const bad = structuredClone(DEFAULT_TOOLKIT);
    bad.tools[0] = { ...bad.tools[0], enabled: true, name: 'X', linkUrl: 'javascript:alert(1)' };
    expect(toolkitSchema.safeParse(bad).success).toBe(false);
    bad.tools[0].linkUrl = 'http://x.com';
    expect(toolkitSchema.safeParse(bad).success).toBe(false);
    bad.tools[0].linkUrl = 'https://x.com/?ref=mtrlzd';
    expect(toolkitSchema.safeParse(bad).success).toBe(true);
    expect(toolIsLive(bad.tools[0])).toBe(true);
  });

  it('the awards registration needs a real email and a plain handle', () => {
    expect(filmAwardRegistrationSchema.safeParse({ email: 'A@B.co', handle: '@frida.films' }).success).toBe(true);
    expect(filmAwardRegistrationSchema.safeParse({ email: 'nope', handle: 'x' }).success).toBe(false);
    expect(filmAwardRegistrationSchema.safeParse({ email: 'a@b.co', handle: '<script>' }).success).toBe(false);
  });
});

describe('wiring', () => {
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  it('challenge_month stays out of the Drizzle schema, so the video PATCH cannot set it', () => {
    expect(read('shared/schema.ts')).not.toMatch(/challenge_month/);
  });
  it('the click redirect only goes to a saved, live card', () => {
    const src = read('server/creatorToolkit.ts');
    expect(src).toMatch(/if \(!tool \|\| !toolIsLive\(tool\)\) return null;/);
  });
  it('the homepage shows the toolkit and the upload offers the challenge', () => {
    const page = read('client/src/pages/dashboard.tsx');
    expect(page).toMatch(/<CreatorToolkit /);
    expect(page).toMatch(/offerChallenge/);
  });
});

describe('toolkit images, hover text and announcement bar (24 Nov 2026)', () => {
  // Content as it was saved before these fields existed. It must still read,
  // or getToolkit would fall back to the defaults and drop admin's edits.
  const savedBefore = {
    tools: [
      { enabled: true, name: 'Clipur', tagline: 'Shorts in a click', videoUrl: '', posterUrl: 'https://res.cloudinary.com/x/c.jpg', ctaLabel: 'Sign up', linkUrl: 'https://clipur.com/?ref=mtrlzd', voucherCode: 'CLIPUR26' },
      { enabled: false, name: '', tagline: '', videoUrl: '', posterUrl: '', ctaLabel: 'Sign up', linkUrl: '', voucherCode: '' },
    ],
    challenge: { enabled: true, title: 'Creator Challenge', prize: '$2,000', body: 'Upload and share.' },
    awards: { enabled: true, title: 'Creator Film Awards', place: 'Cannes', dates: 'May 2027', highlights: ['Red carpet'], videoUrl: '', posterUrl: '' },
  };

  it('content saved before the new fields still parses, with them filled in empty', () => {
    const r = toolkitSchema.safeParse(savedBefore);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.tools[0].name).toBe('Clipur');
    expect(r.data.tools[0].hoverText).toBe('');
    expect(r.data.challenge.imageUrl).toBe('');
    expect(r.data.announcement).toEqual({ enabled: false, text: '', linkUrl: '', scroll: true });
    expect(announcementIsLive(r.data.announcement)).toBe(false);
  });

  it('card images must be https links, like every other link here', () => {
    const t = structuredClone(DEFAULT_TOOLKIT);
    t.challenge.imageUrl = 'javascript:alert(1)';
    expect(toolkitSchema.safeParse(t).success).toBe(false);
    t.challenge.imageUrl = 'https://res.cloudinary.com/x/image/upload/v1/materialized/images/a.jpg';
    expect(toolkitSchema.safeParse(t).success).toBe(true);
    t.announcement = { enabled: true, text: 'New', linkUrl: 'http://x.com', scroll: true };
    expect(toolkitSchema.safeParse(t).success).toBe(false);
  });

  it('hover text and the announcement are held to one short line', () => {
    const t = structuredClone(DEFAULT_TOOLKIT);
    t.tools[0].hoverText = 'x'.repeat(HOVER_MAX);
    expect(toolkitSchema.safeParse(t).success).toBe(true);
    t.tools[0].hoverText = 'x'.repeat(HOVER_MAX + 1);
    expect(toolkitSchema.safeParse(t).success).toBe(false);
    const u = structuredClone(DEFAULT_TOOLKIT);
    u.announcement = { enabled: true, text: 'x'.repeat(ANNOUNCEMENT_MAX + 1), linkUrl: '', scroll: true };
    expect(toolkitSchema.safeParse(u).success).toBe(false);
  });

  it('the bar shows only when switched on and it has text', () => {
    expect(announcementIsLive({ enabled: true, text: 'New in the Toolkit', linkUrl: '', scroll: true })).toBe(true);
    expect(announcementIsLive({ enabled: true, text: '   ', linkUrl: '', scroll: true })).toBe(false);
    expect(announcementIsLive({ enabled: false, text: 'New', linkUrl: '', scroll: false })).toBe(false);
  });
});
