import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  challengeStatus, judgingWindow, toolkitSchema, toolIsLive, DEFAULT_TOOLKIT, filmAwardRegistrationSchema,
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
