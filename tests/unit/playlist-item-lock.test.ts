/**
 * PLAYLIST CONTENTS FREEZE ONCE PAID.
 *
 * The defect: POST /api/playlists/:id/items had no guard on playlist.status. Pay
 * for a 1-video playlist with 1 token (or by card), then POST 99 more listingIds →
 * 200 OK, zero extra charge. Re-running checkout is blocked on a published
 * playlist, so it stays 100 videos for the price of 1 — $4,851 of licences given
 * away per playlist, repeatable.
 *
 * The rule lives in @shared/playlists so the server guard and the client's disabled
 * state read the SAME predicate. This file pins the rule; the route wiring is
 * asserted below against the exact handler shape.
 */
import { describe, it, expect } from 'vitest';
import {
  isPlaylistLocked,
  playlistLockedMessage,
  PLAYLIST_LOCKED_STATUSES,
} from '../../shared/playlists';
import { readFileSync } from 'fs';
import path from 'path';

describe('isPlaylistLocked', () => {
  it('locks a PUBLISHED playlist — the exploit case', () => {
    expect(isPlaylistLocked('published')).toBe(true);
  });

  it('locks a PENDING_PAYMENT playlist — its PaymentIntent is already sized', () => {
    expect(isPlaylistLocked('pending_payment')).toBe(true);
  });

  it('leaves a DRAFT editable — a draft is re-checked-out at the new price', () => {
    expect(isPlaylistLocked('draft')).toBe(false);
  });

  it('treats a missing status as editable, not as locked', () => {
    // playlists.status is nullable (DEFAULT 'draft'), so null must behave as draft.
    // Failing closed here would silently brick every legacy row instead.
    expect(isPlaylistLocked(null)).toBe(false);
    expect(isPlaylistLocked(undefined)).toBe(false);
    expect(isPlaylistLocked('')).toBe(false);
  });

  it('covers exactly the two paid states — a new status must be classified deliberately', () => {
    expect([...PLAYLIST_LOCKED_STATUSES].sort()).toEqual(['pending_payment', 'published']);
  });

  it('explains itself differently for the two states', () => {
    expect(playlistLockedMessage('published')).toMatch(/already published/i);
    expect(playlistLockedMessage('pending_payment')).toMatch(/payment in progress/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Route wiring. A source-level assertion in the style of
// wallet-cash-isolation.test.ts: routes.ts cannot be imported without standing up
// the whole server graph, and a guard that exists but is never CALLED is worth
// nothing. This fails the moment either handler loses its guard.
// ─────────────────────────────────────────────────────────────────────────────

const routesSource = readFileSync(
  path.join(path.resolve(__dirname, '../..'), 'server/routes.ts'),
  'utf8',
);

/** The body of one `app.<method>("<path>", ...)` handler. */
function handlerBody(method: string, routePath: string): string {
  const needle = `app.${method}("${routePath}"`;
  const start = routesSource.indexOf(needle);
  expect(start, `${method.toUpperCase()} ${routePath} not found in server/routes.ts`).toBeGreaterThan(-1);
  // Up to the next route registration — enough to contain one handler.
  const rest = routesSource.slice(start + needle.length);
  const next = rest.search(/\n\s{2}app\.(get|post|put|patch|delete)\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the guard is actually wired into the routes', () => {
  it('POST /api/playlists/:id/items refuses to add to a locked playlist', () => {
    const body = handlerBody('post', '/api/playlists/:id/items');
    expect(body).toContain('isPlaylistLocked');
    expect(body).toContain('409');
  });

  it('DELETE /api/playlists/:id/items/:itemId refuses to remove from a locked playlist', () => {
    const body = handlerBody('delete', '/api/playlists/:id/items/:itemId');
    expect(body).toContain('isPlaylistLocked');
    expect(body).toContain('409');
  });

  it('the add guard runs BEFORE any item is written', () => {
    const body = handlerBody('post', '/api/playlists/:id/items');
    expect(body.indexOf('isPlaylistLocked')).toBeLessThan(body.indexOf('addPlaylistItems'));
  });

  it('confirm-payment still verifies a SUCCEEDED PaymentIntent (no free publish)', () => {
    // The card path used to publish unconditionally. Disabling the client button
    // must not be mistaken for permission to drop this check.
    const body = handlerBody('post', '/api/playlists/:id/confirm-payment');
    expect(body).toContain('retrievePaymentIntent');
    expect(body).toContain('succeeded');
    expect(body).toContain('402');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The card buttons that can only 402.
//
// /confirm-payment now requires a real succeeded PaymentIntent, but nothing in
// client/src consumes the `clientSecret` /checkout returns — there is no card
// form, so no PaymentIntent can ever succeed. The buttons are disabled and say so.
// The FIX IS IN THE CLIENT: re-enabling by loosening the server would restore the
// free-publish hole, which is why the assertion above is in the same file.
// ─────────────────────────────────────────────────────────────────────────────

const repoRoot = path.resolve(__dirname, '../..');
const cardSurfaces = [
  'client/src/pages/playlists.tsx',
  'client/src/components/AddToPlaylistModal.tsx',
];

describe('card publish is disabled in the UI, honestly', () => {
  for (const file of cardSurfaces) {
    const src = readFileSync(path.join(repoRoot, file), 'utf8');

    it(`${file} declares card publishing OFF`, () => {
      expect(src).toMatch(/const CARD_PUBLISH_ENABLED = false;/);
    });

    it(`${file} gates every card button on that flag`, () => {
      // A "card button" is one whose onClick FIRES the card flow. (Merely naming a
      // card mutation in `disabled` does not count — Save Draft does that to avoid
      // concurrent submits and must stay enabled.)
      const buttons = src.split('<Button').slice(1);
      const cardButtons = buttons.filter((b) =>
        /onClick=\{[^}]*(?:checkoutMutation|confirmPaymentMutation)\.mutate/.test(b),
      );
      expect(cardButtons.length).toBeGreaterThan(0);
      for (const b of cardButtons) {
        const disabled = b.match(/disabled=\{([^}]*)\}/)?.[1] ?? '';
        expect(disabled, `card button not gated:\n${b.slice(0, 300)}`).toContain('CARD_PUBLISH_ENABLED');
      }
    });

    it(`${file} tells the user why, rather than failing silently`, () => {
      expect(src).toMatch(/CARD_PUBLISH_NOTE/);
      expect(src).toMatch(/isn't available yet|still being wired up/i);
    });
  }
});
