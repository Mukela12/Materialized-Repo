/**
 * Token wallet — the money logic.
 *
 * These tests cover the five invariants that make the wallet safe to ship:
 *   1. never cashable          — tests/unit/wallet-cash-isolation.test.ts
 *   2. append-only balance     — deriveBalance / summarizeLedger
 *   3. one token per brand     — mint idempotency + the many-to-many cases
 *   4. no double-spend         — the concurrency block below
 *   5. value at grant time     — summarizeLedger with a repriced token
 *
 * The fake runner below models the DB contract, INCLUDING the partial unique
 * indexes, so the idempotency paths are genuinely exercised. What it cannot prove
 * is that Postgres behaves the same way under real concurrency — Node is
 * single-threaded, so an in-memory read-check-insert is trivially atomic. That is
 * why the "no lock at all" test exists: it removes the serialization entirely and
 * shows the post-insert re-read STILL holds the balance at >= 0. The advisory-lock
 * half of the guarantee has to be verified on staging against a real database.
 */
import { describe, it, expect } from 'vitest';
import {
  spendTokens,
  creditTokens,
  revokeTokens,
  deriveBalance,
  summarizeLedger,
  resolveBrandConversionAttribution,
  planQualifiesForTokenMint,
  mintBrandConversionToken,
  isSpendReason,
  fifoLots,
  spendValueOfEntry,
  ledgerRowValues,
  TOKEN_USD_CENTS,
  type WalletTx,
  type WalletTxRunner,
  type NewLedgerEntry,
  type MintStore,
  type BrandTagCandidate,
} from '../../server/wallet';
import type { TokenLedgerEntry } from '../../shared/schema';
import { PLAN_CONFIG, TOKEN_QUALIFYING_PLANS } from '../../shared/plans';

// ─────────────────────────────────────────────────────────────────────────────
// Fake DB
// ─────────────────────────────────────────────────────────────────────────────

function uniqueViolation(): Error {
  return Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
}

interface FakeWallet {
  runner: WalletTxRunner;
  rows: TokenLedgerEntry[];
  balanceOf(userId: string): number;
}

/**
 * @param serialize when false, transactions run with NO mutual exclusion — a
 *        deliberate model of "the advisory lock is missing or wrong", used to
 *        prove the post-insert re-read is an independent safety net.
 */
function makeFakeWallet(serialize = true): FakeWallet {
  let rows: TokenLedgerEntry[] = [];
  let seq = 0;
  let chain: Promise<unknown> = Promise.resolve();

  // Mirror of the four partial unique indexes in migrations/0010_token_ledger.sql.
  function assertUnique(row: TokenLedgerEntry): void {
    const clash = rows.find((r) => {
      if (row.reason === 'brand_conversion' && r.reason === 'brand_conversion') {
        if (row.sourceBrandId && r.sourceBrandId === row.sourceBrandId) return true;
        if (row.sourceSubscriptionUserId && r.sourceSubscriptionUserId === row.sourceSubscriptionUserId) return true;
      }
      if (row.spendRefId && r.spendRefId === row.spendRefId && r.spendRefType === row.spendRefType) return true;
      if (row.stripeBalanceTxnId && r.stripeBalanceTxnId === row.stripeBalanceTxnId) return true;
      return false;
    });
    if (clash) throw uniqueViolation();
  }

  const runner: WalletTxRunner = {
    async runWalletTransaction<T>(fn: (tx: WalletTx) => Promise<T>): Promise<T> {
      const exec = async (): Promise<T> => {
        const staged: string[] = [];
        const tx: WalletTx = {
          // Yield at every step so two in-flight transactions genuinely interleave.
          lockUser: async () => { await Promise.resolve(); },
          sumBalance: async (userId) => {
            await Promise.resolve();
            return rows.filter((r) => r.userId === userId).reduce((s, r) => s + r.deltaTokens, 0);
          },
          // Oldest first — insertion order here IS created_at order.
          listRows: async (userId) => {
            await Promise.resolve();
            return rows
              .filter((r) => r.userId === userId)
              .map((r) => ({ deltaTokens: r.deltaTokens, usdValueCents: r.usdValueCents }));
          },
          insertEntry: async (entry: NewLedgerEntry) => {
            await Promise.resolve();
            const row = {
              id: `e${++seq}`,
              userId: entry.userId,
              deltaTokens: entry.deltaTokens,
              reason: entry.reason,
              usdValueCents: entry.usdValueCents,
              sourceBrandId: entry.sourceBrandId ?? null,
              sourceSubscriptionUserId: entry.sourceSubscriptionUserId ?? null,
              stripeSubscriptionId: entry.stripeSubscriptionId ?? null,
              attributionMethod: entry.attributionMethod ?? null,
              attributedVideoId: entry.attributedVideoId ?? null,
              brandReferralId: entry.brandReferralId ?? null,
              spendRefType: entry.spendRefType ?? null,
              spendRefId: entry.spendRefId ?? null,
              stripeBalanceTxnId: entry.stripeBalanceTxnId ?? null,
              description: entry.description ?? null,
              adminNote: entry.adminNote ?? null,
              createdAt: new Date(1_700_000_000_000 + seq),
            } as TokenLedgerEntry;
            if (row.deltaTokens === 0) throw new Error('CHECK token_ledger_delta_nonzero');
            assertUnique(row);
            rows.push(row);
            staged.push(row.id);
            return row;
          },
        };
        try {
          return await fn(tx);
        } catch (err) {
          rows = rows.filter((r) => !staged.includes(r.id)); // ROLLBACK
          throw err;
        }
      };

      if (!serialize) return exec();
      const p = chain.then(exec);
      chain = p.catch(() => undefined);
      return p;
    },
  };

  return {
    runner,
    get rows() { return rows; },
    balanceOf: (userId: string) => rows.filter((r) => r.userId === userId).reduce((s, r) => s + r.deltaTokens, 0),
  };
}

/** @param usdValueCents grant price per token; omit for today's TOKEN_USD_CENTS. */
async function seedTokens(w: FakeWallet, userId: string, n: number, usdValueCents?: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const r = await creditTokens(w.runner, {
      userId, tokens: 1, reason: 'admin_grant', adminNote: 'test seed', usdValueCents,
    });
    expect(r.ok).toBe(true);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 2 — balance is derived, never stored
// ─────────────────────────────────────────────────────────────────────────────

describe('balance derivation', () => {
  it('is the SUM of signed deltas, not a counter', () => {
    expect(deriveBalance([])).toBe(0);
    expect(deriveBalance([
      { deltaTokens: 1, usdValueCents: 4900 },
      { deltaTokens: 1, usdValueCents: 4900 },
      { deltaTokens: -1, usdValueCents: 4900 },
    ])).toBe(1);
  });

  it('separates lifetime earned from lifetime spent', () => {
    const s = summarizeLedger([
      { deltaTokens: 3, usdValueCents: 4900 },
      { deltaTokens: -2, usdValueCents: 4900 },
    ]);
    expect(s.balance).toBe(1);
    expect(s.lifetimeEarned).toBe(3);
    expect(s.lifetimeSpent).toBe(2);
    expect(s.balanceUsdCents).toBe(4900);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 5 — value captured at grant time
// ─────────────────────────────────────────────────────────────────────────────

describe('value captured at grant time', () => {
  it('stamps the CURRENT token price onto every new row', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 1);
    expect(w.rows[0].usdValueCents).toBe(TOKEN_USD_CENTS);
    expect(TOKEN_USD_CENTS).toBe(4900);
  });

  it('values a historical row at ITS OWN price after a reprice, not at the new one', () => {
    // Two tokens granted at $49, one later granted at a hypothetical $59.
    const s = summarizeLedger([
      { deltaTokens: 1, usdValueCents: 4900 },
      { deltaTokens: 1, usdValueCents: 4900 },
      { deltaTokens: 1, usdValueCents: 5900 },
    ]);
    expect(s.balance).toBe(3);
    // NOT 3 * 5900 — history is not rewritten by a price change.
    expect(s.lifetimeEarnedUsdCents).toBe(4900 + 4900 + 5900);
    expect(s.balanceUsdCents).toBe(4900 + 4900 + 5900);
  });

  it('retires the OLDEST lots first when valuing what is left', () => {
    const s = summarizeLedger([
      { deltaTokens: 1, usdValueCents: 4900 }, // old, cheap
      { deltaTokens: 1, usdValueCents: 5900 }, // new, dearer
      { deltaTokens: -1, usdValueCents: 4900 }, // spends the old one
    ]);
    expect(s.balance).toBe(1);
    expect(s.balanceUsdCents).toBe(5900);
  });

  it('the arithmetic CLOSES: balance value + spent value === earned value, across a reprice', () => {
    // If these three ever disagree, the UI is showing a number the money does not
    // match — which is the whole failure this valuation rule exists to prevent.
    const s = summarizeLedger([
      { deltaTokens: 2, usdValueCents: 4900 },
      { deltaTokens: 1, usdValueCents: 6000 },
      { deltaTokens: -2, usdValueCents: 4900 },
    ]);
    expect(s.lifetimeEarnedUsdCents).toBe(2 * 4900 + 6000);
    expect(s.lifetimeSpentUsdCents).toBe(2 * 4900);
    expect(s.balanceUsdCents).toBe(6000);
    expect(s.balanceUsdCents + s.lifetimeSpentUsdCents).toBe(s.lifetimeEarnedUsdCents);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DECISION: redeem at GRANT value, never at today's rate
//
// The debit row used to be stamped with today's TOKEN_USD_CENTS, and the Stripe
// credit was computed from it. So raising the token price to $60 left GET /api/wallet
// reporting a 4900 balance (FIFO, grant-time) while the subsidy issued $60 of real
// credit — the UI and the money disagreed, and a reprice retroactively changed what
// already-minted tokens paid out.
// ─────────────────────────────────────────────────────────────────────────────

describe('spend value is the GRANT value of the tokens consumed', () => {
  it('a reprice does not change the payout for an already-minted token', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 1, 4900);   // minted before the reprice
    await seedTokens(w, 'u1', 1, 6000);   // minted after it

    const r = await spendTokens(w.runner, {
      userId: 'u1', tokens: 1, reason: 'spend_subscription_credit',
      spendRefType: 'stripe_customer_balance', spendRefId: 'k1',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    // FIFO: the old $49 lot goes first. NOT 6000, which would be $11 of free credit.
    expect(r.consumedUsdCents).toBe(4900);
    expect(r.entry.usdValueCents).toBe(4900);
  });

  it('prices a spend that straddles a reprice boundary at the sum of BOTH lots', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 1, 4900);
    await seedTokens(w, 'u1', 1, 6000);

    const r = await spendTokens(w.runner, {
      userId: 'u1', tokens: 2, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'p1',
    });

    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.consumedUsdCents).toBe(10900);   // exact, not 2 × either price
    expect(r.entry.usdValueCents).toBe(5450); // the rounded UNIT, for display only
  });

  it('the exact total survives a rounded unit price: summarizeLedger still closes', async () => {
    // 4900 + 4900 + 6000 = 15800 over 3 tokens = 5266.67 — no exact integer unit
    // exists, so the row rounds. The summary must still balance to the cent.
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 2, 4900);
    await seedTokens(w, 'u1', 1, 6000);

    const r = await spendTokens(w.runner, {
      userId: 'u1', tokens: 3, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'p3',
    });
    if (!r.ok) throw new Error('unreachable');
    expect(r.consumedUsdCents).toBe(15800);

    const s = summarizeLedger(w.rows.filter((x) => x.userId === 'u1'));
    expect(s.balance).toBe(0);
    expect(s.lifetimeSpentUsdCents).toBe(15800);
    expect(s.balanceUsdCents + s.lifetimeSpentUsdCents).toBe(s.lifetimeEarnedUsdCents);
  });

  it('spendValueOfEntry replays the same answer from history alone', async () => {
    // The idempotent-replay path re-derives the credit from the ledger rather than
    // re-reading a stored number, so it must agree with what was originally paid.
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 1, 4900);
    await seedTokens(w, 'u1', 1, 6000);

    const first = await spendTokens(w.runner, {
      userId: 'u1', tokens: 1, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'pa',
    });
    const second = await spendTokens(w.runner, {
      userId: 'u1', tokens: 1, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'pb',
    });
    if (!first.ok || !second.ok) throw new Error('unreachable');

    const rows = w.rows.filter((r) => r.userId === 'u1');
    expect(spendValueOfEntry(rows, first.entry.id)).toBe(4900);
    expect(spendValueOfEntry(rows, second.entry.id)).toBe(6000);
    expect(spendValueOfEntry(rows, 'not-a-row')).toBeNull();
  });

  it('a revoke claws back the GRANT value too, not today’s price', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 1, 4900);
    const r = await revokeTokens(w.runner, { userId: 'u1', tokens: 1, adminNote: 'wrong creator' });
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    expect(r.consumedUsdCents).toBe(4900);
  });

  it('ledgerRowValues makes the displayed rows sum to the balance, to the cent', () => {
    // GET /api/wallet renders one value per row. If those are computed from a
    // ROUNDED unit price they do not add up to balanceUsdCents, and the user sees
    // a ledger that does not reconcile. Derived from the same FIFO replay instead.
    const rows = [
      { id: 'a', deltaTokens: 2, usdValueCents: 4900 },
      { id: 'b', deltaTokens: 1, usdValueCents: 6000 },
      { id: 'c', deltaTokens: -3, usdValueCents: 5267 }, // rounded unit on the row
    ];
    const values = ledgerRowValues(rows);
    expect(values.get('a')).toBe(9800);
    expect(values.get('b')).toBe(6000);
    expect(values.get('c')).toBe(15800);                 // exact, not 3 × 5267
    expect(values.get('c')).not.toBe(3 * 5267);

    const s = summarizeLedger(rows);
    const credits = rows.filter((r) => r.deltaTokens > 0).reduce((t, r) => t + values.get(r.id)!, 0);
    const debits = rows.filter((r) => r.deltaTokens < 0).reduce((t, r) => t + values.get(r.id)!, 0);
    expect(credits - debits).toBe(s.balanceUsdCents);
  });

  it('fifoLots exposes the surviving lots the balance is actually made of', () => {
    const lots = fifoLots([
      { deltaTokens: 2, usdValueCents: 4900 },
      { deltaTokens: 1, usdValueCents: 6000 },
      { deltaTokens: -1, usdValueCents: 4900 },
    ]);
    expect(lots).toEqual([
      { tokens: 1, usdValueCents: 4900 },
      { tokens: 1, usdValueCents: 6000 },
    ]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 4 — no double-spend, no negative balance
// ─────────────────────────────────────────────────────────────────────────────

describe('spendTokens — the double-spend guarantee', () => {
  it('THE headline case: two concurrent redeems against a 1-token balance — only one wins', async () => {
    const w = makeFakeWallet(); // serialized, i.e. the advisory lock is working
    await seedTokens(w, 'u1', 1);

    const [a, b] = await Promise.all([
      spendTokens(w.runner, {
        userId: 'u1', tokens: 1, reason: 'spend_library_listing',
        spendRefType: 'global_video_listing', spendRefId: 'listing-A',
      }),
      spendTokens(w.runner, {
        userId: 'u1', tokens: 1, reason: 'spend_library_listing',
        spendRefType: 'global_video_listing', spendRefId: 'listing-B',
      }),
    ]);

    const wins = [a, b].filter((r) => r.ok);
    expect(wins).toHaveLength(1);
    const loser = [a, b].find((r) => !r.ok)!;
    expect(loser).toMatchObject({ ok: false, error: 'insufficient_tokens' });
    expect(w.balanceOf('u1')).toBe(0);
  });

  it('holds the balance at >= 0 even with NO lock at all (the post-insert re-read)', async () => {
    // Serialization removed on purpose: this models a broken/absent advisory lock,
    // and proves the re-verification is an independent layer rather than decoration.
    const w = makeFakeWallet(false);
    await seedTokens(w, 'u1', 1);

    const results = await Promise.all([
      spendTokens(w.runner, {
        userId: 'u1', tokens: 1, reason: 'spend_playlist',
        spendRefType: 'playlist', spendRefId: 'p1',
      }),
      spendTokens(w.runner, {
        userId: 'u1', tokens: 1, reason: 'spend_playlist',
        spendRefType: 'playlist', spendRefId: 'p2',
      }),
    ]).catch((err) => err);

    // Whatever the interleaving, the ledger must never go negative and at most
    // one of the two debits may survive.
    expect(w.balanceOf('u1')).toBeGreaterThanOrEqual(0);
    const debits = w.rows.filter((r) => r.deltaTokens < 0);
    expect(debits.length).toBeLessThanOrEqual(1);
    if (Array.isArray(results)) {
      expect(results.filter((r: any) => r.ok).length).toBeLessThanOrEqual(1);
    }
  });

  it('rejects a spend on a zero balance and writes nothing', async () => {
    const w = makeFakeWallet();
    const r = await spendTokens(w.runner, {
      userId: 'u1', tokens: 1, reason: 'spend_library_listing',
      spendRefType: 'global_video_listing', spendRefId: 'listing-1',
    });
    expect(r).toMatchObject({ ok: false, error: 'insufficient_tokens', balance: 0, required: 1 });
    expect(w.rows).toHaveLength(0);
  });

  it('rejects a partial spend (5 tokens wanted, 3 held) without debiting', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 3);
    const r = await spendTokens(w.runner, {
      userId: 'u1', tokens: 5, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'p9',
    });
    expect(r).toMatchObject({ ok: false, error: 'insufficient_tokens', balance: 3, required: 5 });
    expect(w.balanceOf('u1')).toBe(3);
  });

  it('is idempotent per purchase: the same spendRefId never debits twice', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 2);

    const first = await spendTokens(w.runner, {
      userId: 'u1', tokens: 1, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'playlist-7',
    });
    const retry = await spendTokens(w.runner, {
      userId: 'u1', tokens: 1, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'playlist-7',
    });

    expect(first.ok).toBe(true);
    expect(retry).toEqual({ ok: false, error: 'duplicate_spend' });
    expect(w.balanceOf('u1')).toBe(1);
  });

  it('charges one token PER VIDEO for a playlist', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 5);
    const r = await spendTokens(w.runner, {
      userId: 'u1', tokens: 5, reason: 'spend_playlist',
      spendRefType: 'playlist', spendRefId: 'playlist-5v',
    });
    expect(r).toMatchObject({ ok: true, balanceAfter: 0 });
    expect(w.rows.at(-1)!.deltaTokens).toBe(-5);
  });

  it('never spends from another user’s wallet', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'rich', 5);
    const r = await spendTokens(w.runner, {
      userId: 'poor', tokens: 1, reason: 'spend_library_listing',
      spendRefType: 'global_video_listing', spendRefId: 'x',
    });
    expect(r).toMatchObject({ ok: false, error: 'insufficient_tokens' });
    expect(w.balanceOf('rich')).toBe(5);
  });

  it('rejects malformed spends before touching the ledger', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 5);
    const base = { userId: 'u1', reason: 'spend_playlist' as const, spendRefType: 'playlist' as const, spendRefId: 'r' };
    expect(await spendTokens(w.runner, { ...base, tokens: 0 })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(await spendTokens(w.runner, { ...base, tokens: -1 })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(await spendTokens(w.runner, { ...base, tokens: 1.5 })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(await spendTokens(w.runner, { ...base, tokens: 1, spendRefId: '' })).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(w.balanceOf('u1')).toBe(5);
  });

  it('classifies reasons: only the three sinks are spendable', () => {
    expect(isSpendReason('spend_library_listing')).toBe(true);
    expect(isSpendReason('spend_playlist')).toBe(true);
    expect(isSpendReason('spend_subscription_credit')).toBe(true);
    expect(isSpendReason('admin_revoke')).toBe(false);   // a correction, not a spend
    expect(isSpendReason('brand_conversion')).toBe(false);
    expect(isSpendReason('payout')).toBe(false);         // not a reason at all
  });
});

describe('revokeTokens (admin override, negative leg)', () => {
  it('refuses to drive a balance negative when the token is already spent', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'u1', 1);
    await spendTokens(w.runner, {
      userId: 'u1', tokens: 1, reason: 'spend_library_listing',
      spendRefType: 'global_video_listing', spendRefId: 'l1',
    });
    const r = await revokeTokens(w.runner, { userId: 'u1', tokens: 1, adminNote: 'wrong creator' });
    expect(r).toMatchObject({ ok: false, error: 'insufficient_tokens' });
    expect(w.balanceOf('u1')).toBe(0);
  });

  it('appends a compensating row rather than editing the original mint', async () => {
    const w = makeFakeWallet();
    await seedTokens(w, 'wrong', 1);
    const before = w.rows.length;
    const r = await revokeTokens(w.runner, { userId: 'wrong', tokens: 1, adminNote: 'reattributed to u2' });
    expect(r.ok).toBe(true);
    expect(w.rows).toHaveLength(before + 1);   // appended, not mutated
    expect(w.rows[0].deltaTokens).toBe(1);     // the original is untouched
    expect(w.balanceOf('wrong')).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Attribution — the many-to-many hazard
// ─────────────────────────────────────────────────────────────────────────────

function candidate(over: Partial<BrandTagCandidate> = {}): BrandTagCandidate {
  return { brandId: 'b1', creatorId: 'c1', videoId: 'v1', taggedAt: new Date('2026-01-01'), ...over };
}

describe('resolveBrandConversionAttribution', () => {
  it('picks the EARLIEST tagger when five creators tagged the same brand', () => {
    const result = resolveBrandConversionAttribution({
      subscriberUserId: 'sub',
      candidates: [
        candidate({ creatorId: 'c3', videoId: 'v3', taggedAt: new Date('2026-03-01') }),
        candidate({ creatorId: 'c1', videoId: 'v1', taggedAt: new Date('2026-01-01') }),
        candidate({ creatorId: 'c5', videoId: 'v5', taggedAt: new Date('2026-05-01') }),
        candidate({ creatorId: 'c2', videoId: 'v2', taggedAt: new Date('2026-02-01') }),
        candidate({ creatorId: 'c4', videoId: 'v4', taggedAt: new Date('2026-04-01') }),
      ],
    });
    expect(result).toMatchObject({ creatorId: 'c1', videoId: 'v1', method: 'first_touch_tag' });
  });

  it('sorts NULL tag times LAST — an undated video never beats a dated one', () => {
    const result = resolveBrandConversionAttribution({
      subscriberUserId: 'sub',
      candidates: [
        candidate({ creatorId: 'cNull', videoId: 'v0', taggedAt: null }),
        candidate({ creatorId: 'cDated', videoId: 'v9', taggedAt: new Date('2030-01-01') }),
      ],
    });
    expect(result?.creatorId).toBe('cDated');
  });

  it('breaks an exact timestamp tie deterministically by video id', () => {
    const same = new Date('2026-01-01');
    const args = {
      subscriberUserId: 'sub',
      candidates: [
        candidate({ creatorId: 'cB', videoId: 'v-b', taggedAt: same }),
        candidate({ creatorId: 'cA', videoId: 'v-a', taggedAt: same }),
      ],
    };
    expect(resolveBrandConversionAttribution(args)?.creatorId).toBe('cA');
    // Same answer regardless of input order — the comparator is a total order.
    expect(resolveBrandConversionAttribution({
      ...args, candidates: [...args.candidates].reverse(),
    })?.creatorId).toBe('cA');
  });

  it('refuses to attribute when there is nothing to attribute to', () => {
    expect(resolveBrandConversionAttribution({ subscriberUserId: 'sub', candidates: [] })).toBeNull();
  });

  it('drops a self-mint: the subscriber cannot be their own tagging creator', () => {
    expect(resolveBrandConversionAttribution({
      subscriberUserId: 'sub',
      candidates: [candidate({ creatorId: 'sub' })],
    })).toBeNull();
  });

  it('still attributes to a third party when the subscriber also tagged the brand', () => {
    const r = resolveBrandConversionAttribution({
      subscriberUserId: 'sub',
      candidates: [
        // The subscriber tagged it first, but is ineligible.
        candidate({ creatorId: 'sub', videoId: 'v0', taggedAt: new Date('2020-01-01') }),
        candidate({ creatorId: 'c7', videoId: 'v7', taggedAt: new Date('2026-01-01') }),
      ],
    });
    expect(r?.creatorId).toBe('c7');
  });

  it('prefers a referral over first-touch when a referral link exists', () => {
    // Not reachable in production today (brand_referrals has no brandId and ?ref=
    // is never consumed at registration), but the branch is wired and tested so
    // filling it in later is a data change, not a logic change.
    const r = resolveBrandConversionAttribution({
      subscriberUserId: 'sub',
      candidates: [
        candidate({ creatorId: 'firstToucher', videoId: 'v1', taggedAt: new Date('2020-01-01') }),
        candidate({ creatorId: 'referrer', videoId: 'v2', taggedAt: new Date('2026-01-01'), brandReferralId: 'ref-1' }),
      ],
    });
    expect(r).toMatchObject({ creatorId: 'referrer', method: 'brand_referral', brandReferralId: 'ref-1' });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// INVARIANT 3 — exactly one token per brand conversion
// ─────────────────────────────────────────────────────────────────────────────

interface FakeMintWorld {
  brandsByOwner: Record<string, Array<{ id: string; ownerId: string | null }>>;
  tagsByBrand: Record<string, { creatorId: string; videoId: string; taggedAt: Date | null }>;
}

function makeMintStore(world: FakeMintWorld, w: FakeWallet): MintStore {
  return {
    runWalletTransaction: w.runner.runWalletTransaction.bind(w.runner),
    async getBrandsByOwnerId(ownerId) { return world.brandsByOwner[ownerId] ?? []; },
    async getEarliestTaggingCreatorForBrand(brandId) { return world.tagsByBrand[brandId]; },
  };
}

describe('mintBrandConversionToken', () => {
  const world: FakeMintWorld = {
    brandsByOwner: { sub: [{ id: 'brand-1', ownerId: 'sub' }] },
    tagsByBrand: { 'brand-1': { creatorId: 'creator-1', videoId: 'video-1', taggedAt: new Date('2026-01-01') } },
  };
  const qualifying = { subscriberUserId: 'sub', plan: 'starter', amountPaidCents: 24900, stripeSubscriptionId: 'sub_x' };

  it('mints exactly one token to the first-touch creator on a paid $249 subscription', async () => {
    const w = makeFakeWallet();
    const r = await mintBrandConversionToken(makeMintStore(world, w), qualifying);
    expect(r).toMatchObject({ minted: true });
    if (!r.minted) throw new Error('unreachable');
    expect(r.entry.userId).toBe('creator-1');
    expect(r.entry.deltaTokens).toBe(1);
    expect(r.entry.usdValueCents).toBe(4900);
    expect(r.entry.sourceBrandId).toBe('brand-1');
    expect(r.entry.attributionMethod).toBe('first_touch_tag');
    expect(w.balanceOf('creator-1')).toBe(1);
  });

  it('mints ONCE across a first invoice plus twelve monthly renewals', async () => {
    const w = makeFakeWallet();
    const store = makeMintStore(world, w);
    const outcomes = [];
    for (let month = 0; month < 13; month++) {
      outcomes.push(await mintBrandConversionToken(store, qualifying));
    }
    expect(outcomes.filter((o) => o.minted)).toHaveLength(1);
    expect(outcomes.slice(1).every((o) => !o.minted && o.reason === 'already_minted')).toBe(true);
    expect(w.balanceOf('creator-1')).toBe(1);
    expect(w.rows.filter((r) => r.reason === 'brand_conversion')).toHaveLength(1);
  });

  it('mints ONE token when five creators tagged the same brand — not five', async () => {
    // The resolver already collapses this to one candidate, and the unique index
    // would collapse it again even if the resolver were wrong. Assert the outcome.
    const w = makeFakeWallet();
    const multi: FakeMintWorld = {
      brandsByOwner: { sub: [{ id: 'brand-1', ownerId: 'sub' }] },
      tagsByBrand: { 'brand-1': { creatorId: 'creator-early', videoId: 'v-early', taggedAt: new Date('2026-01-01') } },
    };
    const store = makeMintStore(multi, w);
    await Promise.all([1, 2, 3, 4, 5].map(() => mintBrandConversionToken(store, qualifying)));
    expect(w.rows.filter((r) => r.reason === 'brand_conversion')).toHaveLength(1);
    // $49 of credit against a $249 subscription, not $245.
    const totalCents = w.rows.reduce((s, r) => s + r.deltaTokens * r.usdValueCents, 0);
    expect(totalCents).toBe(4900);
  });

  it('mints ONE token when the subscriber owns three tagged brands — not three', async () => {
    const w = makeFakeWallet();
    const multiBrand: FakeMintWorld = {
      brandsByOwner: {
        sub: [
          { id: 'brand-a', ownerId: 'sub' },
          { id: 'brand-b', ownerId: 'sub' },
          { id: 'brand-c', ownerId: 'sub' },
        ],
      },
      tagsByBrand: {
        'brand-a': { creatorId: 'cA', videoId: 'vA', taggedAt: new Date('2026-03-01') },
        'brand-b': { creatorId: 'cB', videoId: 'vB', taggedAt: new Date('2026-01-01') },
        'brand-c': { creatorId: 'cC', videoId: 'vC', taggedAt: new Date('2026-02-01') },
      },
    };
    const r = await mintBrandConversionToken(makeMintStore(multiBrand, w), qualifying);
    expect(r.minted).toBe(true);
    expect(w.rows.filter((x) => x.reason === 'brand_conversion')).toHaveLength(1);
    expect(w.rows[0].userId).toBe('cB');           // earliest tag across all owned brands
    expect(w.rows[0].sourceBrandId).toBe('brand-b');
  });

  it('mints nothing when nobody tagged the brand — it does not guess', async () => {
    const w = makeFakeWallet();
    const untagged: FakeMintWorld = { brandsByOwner: { sub: [{ id: 'brand-x', ownerId: 'sub' }] }, tagsByBrand: {} };
    const r = await mintBrandConversionToken(makeMintStore(untagged, w), qualifying);
    expect(r).toEqual({ minted: false, reason: 'no_attribution' });
    expect(w.rows).toHaveLength(0);
  });

  it('mints nothing when the subscriber owns no brand', async () => {
    const w = makeFakeWallet();
    const r = await mintBrandConversionToken(makeMintStore({ brandsByOwner: {}, tagsByBrand: {} }, w), qualifying);
    expect(r).toEqual({ minted: false, reason: 'no_owned_brand' });
  });

  it('mints nothing for a self-referral (subscriber tagged their own brand)', async () => {
    const w = makeFakeWallet();
    const selfWorld: FakeMintWorld = {
      brandsByOwner: { sub: [{ id: 'brand-self', ownerId: 'sub' }] },
      tagsByBrand: { 'brand-self': { creatorId: 'sub', videoId: 'v-self', taggedAt: new Date('2026-01-01') } },
    };
    const r = await mintBrandConversionToken(makeMintStore(selfWorld, w), qualifying);
    expect(r).toEqual({ minted: false, reason: 'no_attribution' });
    expect(w.rows).toHaveLength(0);
  });

  it('mints nothing on a $0 trial invoice, even on a qualifying plan', async () => {
    const w = makeFakeWallet();
    const r = await mintBrandConversionToken(makeMintStore(world, w), { ...qualifying, amountPaidCents: 0 });
    expect(r).toEqual({ minted: false, reason: 'no_payment' });
    expect(w.rows).toHaveLength(0);
  });

  // ── The amount gate. "> 0" was not enough. ────────────────────────────────
  it('mints nothing on a mid-cycle PRORATION invoice — $2 must not buy a $49 token', async () => {
    // A plan change emits a real, PAID invoice for a few dollars. Under a bare
    // `amountPaidCents > 0` gate this minted a full $49 token out of $2.
    const w = makeFakeWallet();
    const r = await mintBrandConversionToken(makeMintStore(world, w), { ...qualifying, amountPaidCents: 200 });
    expect(r).toEqual({ minted: false, reason: 'underpaid' });
    expect(w.rows).toHaveLength(0);
  });

  it('mints nothing when an UNRESOLVED plan defaults to "starter" on a custom cheap price', async () => {
    // planFromSubscription() falls back to DEFAULT_PLAN = 'starter' when a price
    // carries no metadata.plan and no matching amount — and 'starter' is the ONLY
    // token-qualifying plan. So a subscription created straight in the Stripe
    // dashboard on a custom $10/mo price arrives here labelled 'starter'. The
    // amount is Stripe's own invoice.amount_paid, so the gate holds anyway.
    const w = makeFakeWallet();
    const r = await mintBrandConversionToken(makeMintStore(world, w), { ...qualifying, amountPaidCents: 1000 });
    expect(r).toEqual({ minted: false, reason: 'underpaid' });
    expect(w.rows).toHaveLength(0);
  });

  it('mints nothing one cent short of the list price, and mints at exactly the list price', async () => {
    const short = makeFakeWallet();
    expect(await mintBrandConversionToken(makeMintStore(world, short), { ...qualifying, amountPaidCents: 24899 }))
      .toEqual({ minted: false, reason: 'underpaid' });
    expect(short.rows).toHaveLength(0);

    const exact = makeFakeWallet();
    expect((await mintBrandConversionToken(makeMintStore(world, exact), { ...qualifying, amountPaidCents: 24900 })).minted)
      .toBe(true);
  });

  it('the gate is the PLAN price, not a hardcoded number', () => {
    // Repricing the tier moves the gate with it — that is the point of reading
    // PLAN_CONFIG rather than inlining 24900.
    expect(PLAN_CONFIG.starter.amount).toBe(24900);
    expect(TOKEN_QUALIFYING_PLANS).toEqual(['starter']);
  });

  it('still mints when the invoice OVERSHOOTS (tax, an add-on line, a manual top-up)', async () => {
    const w = makeFakeWallet();
    const r = await mintBrandConversionToken(makeMintStore(world, w), { ...qualifying, amountPaidCents: 30000 });
    expect(r.minted).toBe(true);
  });

  it('mints only for the $249 Brand tier', async () => {
    for (const plan of ['creator', 'pro', 'nonsense', undefined, null]) {
      const w = makeFakeWallet();
      const r = await mintBrandConversionToken(makeMintStore(world, w), { ...qualifying, plan });
      expect(r).toEqual({ minted: false, reason: 'plan_not_qualifying' });
      expect(w.rows).toHaveLength(0);
    }
  });

  it('planQualifiesForTokenMint agrees: starter only', () => {
    expect(planQualifiesForTokenMint('starter')).toBe(true);
    expect(planQualifiesForTokenMint('creator')).toBe(false);
    expect(planQualifiesForTokenMint('pro')).toBe(false);
    expect(planQualifiesForTokenMint('')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// End-to-end: earn one, spend one
// ─────────────────────────────────────────────────────────────────────────────

describe('earn then spend', () => {
  it('a minted token pays for exactly one library listing and no more', async () => {
    const w = makeFakeWallet();
    const store = makeMintStore({
      brandsByOwner: { sub: [{ id: 'b', ownerId: 'sub' }] },
      tagsByBrand: { b: { creatorId: 'creator', videoId: 'v', taggedAt: new Date('2026-01-01') } },
    }, w);

    await mintBrandConversionToken(store, { subscriberUserId: 'sub', plan: 'starter', amountPaidCents: 24900 });
    expect(w.balanceOf('creator')).toBe(1);

    const first = await spendTokens(w.runner, {
      userId: 'creator', tokens: 1, reason: 'spend_library_listing',
      spendRefType: 'global_video_listing', spendRefId: 'listing-1',
    });
    const second = await spendTokens(w.runner, {
      userId: 'creator', tokens: 1, reason: 'spend_library_listing',
      spendRefType: 'global_video_listing', spendRefId: 'listing-2',
    });

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, error: 'insufficient_tokens' });
    expect(w.balanceOf('creator')).toBe(0);

    const summary = summarizeLedger(w.rows.filter((r) => r.userId === 'creator'));
    expect(summary).toMatchObject({ balance: 0, lifetimeEarned: 1, lifetimeSpent: 1 });
  });
});
