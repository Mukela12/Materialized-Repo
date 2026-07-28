/**
 * THE MINT LOOP.
 *
 * POST /api/wallet/subsidise-subscription had two defects that compounded into
 * unbounded token minting:
 *
 *   (a) the compensating refund was appended with NO spend ref. The unique index
 *       token_ledger_spend_ref_uniq is PARTIAL — `WHERE spend_ref_id IS NOT NULL` —
 *       so a refund without one was constrained by nothing.
 *   (b) an existing unsettled debit for the idempotency key was reused without
 *       checking whether it had already been refunded, so a repeat request skipped
 *       the debit entirely.
 *
 * Exploit: balance 1. POST {tokens:1, key:"K"} → debit commits, Stripe throws,
 * refund +1, balance 1. Repeat with the SAME key → debit skipped (the row exists),
 * Stripe throws again, ANOTHER refund +1, balance 2. Each request appended a credit
 * with no matching debit. Reachable by an honest user through a Stripe blip, and
 * FARMABLE on demand by anyone with a stale stripe_customer_id: Stripe replays a
 * cached error for a repeated idempotency key, so the failure is stable.
 *
 * `applyTokenSubsidy` is the extracted route body (server/subscriptionSubsidy.ts).
 * Extracting it is what makes this testable at all: the branch only runs when
 * Stripe throws, so inline in an Express handler it was reachable only from a live
 * Stripe outage — which is why the whole branch shipped untested.
 *
 * The fake store below mirrors the partial unique indexes in
 * migrations/0010_token_ledger.sql, so the DB half of the fix is genuinely
 * exercised rather than assumed.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  applyTokenSubsidy,
  SUBSIDY_SPEND_REF_TYPE,
  type SubsidyStore,
  type ApplyCustomerCredit,
} from '../../server/subscriptionSubsidy';
import {
  creditTokens,
  SPEND_REFUND_REF_TYPE,
  TOKEN_USD_CENTS,
  type WalletTx,
  type NewLedgerEntry,
} from '../../server/wallet';
import type { TokenLedgerEntry } from '../../shared/schema';

// ─────────────────────────────────────────────────────────────────────────────
// Fake store — the four wallet primitives plus the ledger readers, with the
// partial unique indexes enforced exactly as Postgres enforces them.
// ─────────────────────────────────────────────────────────────────────────────

interface FakeStore extends SubsidyStore {
  rows: TokenLedgerEntry[];
  balanceOf(userId: string): number;
}

function makeStore(): FakeStore {
  let rows: TokenLedgerEntry[] = [];
  let seq = 0;

  function assertUnique(row: TokenLedgerEntry): void {
    const clash = rows.find((r) => {
      if (row.reason === 'brand_conversion' && r.reason === 'brand_conversion') {
        if (row.sourceBrandId && r.sourceBrandId === row.sourceBrandId) return true;
        if (row.sourceSubscriptionUserId && r.sourceSubscriptionUserId === row.sourceSubscriptionUserId) return true;
      }
      // token_ledger_spend_ref_uniq — PARTIAL: rows with a NULL spend_ref_id are
      // not covered, which is precisely why a ref-less refund was unlimited.
      if (row.spendRefId && r.spendRefId === row.spendRefId && r.spendRefType === row.spendRefType) return true;
      if (row.stripeBalanceTxnId && r.stripeBalanceTxnId === row.stripeBalanceTxnId) return true;
      return false;
    });
    if (clash) throw Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' });
  }

  const store: FakeStore = {
    get rows() { return rows; },
    balanceOf: (userId) => rows.filter((r) => r.userId === userId).reduce((s, r) => s + r.deltaTokens, 0),

    async runWalletTransaction<T>(fn: (tx: WalletTx) => Promise<T>): Promise<T> {
      const staged: string[] = [];
      const tx: WalletTx = {
        lockUser: async () => { await Promise.resolve(); },
        sumBalance: async (userId) => rows.filter((r) => r.userId === userId).reduce((s, r) => s + r.deltaTokens, 0),
        listRows: async (userId) => rows
          .filter((r) => r.userId === userId)
          .map((r) => ({ deltaTokens: r.deltaTokens, usdValueCents: r.usdValueCents })),
        insertEntry: async (entry: NewLedgerEntry) => {
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
    },

    async getTokenLedger(userId) {
      return rows.filter((r) => r.userId === userId);
    },
    async getTokenBalance(userId) {
      return rows.filter((r) => r.userId === userId).reduce((s, r) => s + r.deltaTokens, 0);
    },
    async getTokenLedgerEntryBySpendRef(spendRefType, spendRefId) {
      return rows.find((r) => r.spendRefType === spendRefType && r.spendRefId === spendRefId);
    },
    async attachStripeBalanceTxn(entryId, stripeBalanceTxnId) {
      const idx = rows.findIndex((r) => r.id === entryId && r.stripeBalanceTxnId === null);
      if (idx === -1) return undefined;
      rows[idx] = { ...rows[idx], stripeBalanceTxnId };
      return rows[idx];
    },
  };
  return store;
}

async function seed(store: FakeStore, userId: string, n: number, usdValueCents?: number) {
  for (let i = 0; i < n; i++) {
    const r = await creditTokens(store, {
      userId, tokens: 1, reason: 'admin_grant', adminNote: 'test seed', usdValueCents,
    });
    expect(r.ok).toBe(true);
  }
}

/** Stripe that always throws — the stale-customer-id case, stable and repeatable. */
const alwaysFails: ApplyCustomerCredit = async () => {
  throw new Error('No such customer: cus_stale');
};

const ARGS = { userId: 'u1', stripeCustomerId: 'cus_stale', tokens: 1, idempotencyKey: 'K-aaaaaaaa' };

// ─────────────────────────────────────────────────────────────────────────────

describe('subsidy refund — the unbounded mint is closed', () => {
  it('THE EXPLOIT: replaying one idempotency key through a failing Stripe never grows the balance', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1);
    expect(store.balanceOf('u1')).toBe(1);

    // Attempt 1: debit commits, Stripe throws, ONE compensating refund. Whole again.
    const first = await applyTokenSubsidy({ store, applyCustomerCredit: alwaysFails }, ARGS);
    expect(first).toMatchObject({ outcome: 'stripe_failed', tokensRefunded: 1 });
    expect(store.balanceOf('u1')).toBe(1);

    // Attempts 2..21 with the SAME key. Under the old code each one skipped the
    // debit, failed at Stripe and appended another +1 — twenty free tokens, $980.
    for (let i = 0; i < 20; i++) {
      const again = await applyTokenSubsidy({ store, applyCustomerCredit: alwaysFails }, ARGS);
      expect(again.outcome).toBe('already_refunded');
      expect(store.balanceOf('u1')).toBe(1);
    }

    // Exactly one debit and exactly one refund exist, forever.
    expect(store.rows.filter((r) => r.reason === 'spend_subscription_credit')).toHaveLength(1);
    expect(store.rows.filter((r) => r.reason === 'spend_refund')).toHaveLength(1);
    expect(store.balanceOf('u1')).toBe(1);
  });

  it('never lets total credits exceed total debits + the original grant (the money invariant)', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1);
    for (let i = 0; i < 10; i++) {
      await applyTokenSubsidy({ store, applyCustomerCredit: alwaysFails }, ARGS);
    }
    const credited = store.rows.filter((r) => r.deltaTokens > 0).reduce((s, r) => s + r.deltaTokens, 0);
    const debited = store.rows.filter((r) => r.deltaTokens < 0).reduce((s, r) => s - r.deltaTokens, 0);
    // 1 grant + 1 refund credited, 1 debit. Under the exploit `credited` grew without bound.
    expect(credited).toBe(2);
    expect(debited).toBe(1);
    // Value never exceeds the one $49 token that was actually earned.
    expect(store.balanceOf('u1') * TOKEN_USD_CENTS).toBe(4900);
  });

  it('the refund carries its own (spend_ref_type, spend_ref_id) — the DB, not the code, is the guarantee', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1);
    await applyTokenSubsidy({ store, applyCustomerCredit: alwaysFails }, ARGS);

    const debit = store.rows.find((r) => r.reason === 'spend_subscription_credit')!;
    const refund = store.rows.find((r) => r.reason === 'spend_refund')!;
    expect(refund.spendRefType).toBe(SPEND_REFUND_REF_TYPE);
    expect(refund.spendRefId).toBe(debit.id);
    // A NULL ref is the bug: token_ledger_spend_ref_uniq is partial, so it would
    // not constrain the row at all.
    expect(refund.spendRefId).not.toBeNull();
  });

  it('a SECOND refund for the same debit is rejected by the unique index even if the guard is bypassed', async () => {
    // Belt-and-braces: call creditTokens directly, as the compensation branch does,
    // skipping the already_refunded check entirely.
    const store = makeStore();
    await seed(store, 'u1', 1);
    await applyTokenSubsidy({ store, applyCustomerCredit: alwaysFails }, ARGS);
    const debit = store.rows.find((r) => r.reason === 'spend_subscription_credit')!;

    const second = await creditTokens(store, {
      userId: 'u1', tokens: 1, reason: 'spend_refund',
      spendRefType: SPEND_REFUND_REF_TYPE, spendRefId: debit.id,
    });
    expect(second).toEqual({ ok: false, error: 'duplicate_credit' });
    expect(store.balanceOf('u1')).toBe(1);
  });

  it('refuses a spend_refund with no spend ref — the shape that made minting possible', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1);
    const r = await creditTokens(store, { userId: 'u1', tokens: 1, reason: 'spend_refund' });
    expect(r).toMatchObject({ ok: false, error: 'invalid_request' });
    expect(store.balanceOf('u1')).toBe(1); // nothing minted
  });

  it('scales the guarantee: 50 tokens ($2,450) a call, replayed, still mints nothing', async () => {
    const store = makeStore();
    await seed(store, 'u1', 50);
    const big = { ...ARGS, tokens: 50 };
    for (let i = 0; i < 5; i++) {
      await applyTokenSubsidy({ store, applyCustomerCredit: alwaysFails }, big);
      expect(store.balanceOf('u1')).toBe(50);
    }
    expect(store.rows.filter((r) => r.reason === 'spend_refund')).toHaveLength(1);
  });
});

describe('subsidy — Stripe succeeded but bookkeeping failed (must NOT refund)', () => {
  // Regression for a leak found in adversarial review: attachStripeBalanceTxn used
  // to sit INSIDE the try whose catch appends the compensating refund. So if Stripe
  // credited the customer and only the follow-up DB write failed, the catch fired
  // and gave the token back — the user kept the $49 credit AND the token, and the
  // loop was repeatable with rotating keys.
  it('keeps the spend final when recording the Stripe txn id fails', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1);
    const applyCustomerCredit = vi.fn(async () => ({ id: 'cbtxn_real' }));
    // Stripe SUCCEEDS; only the bookkeeping write blows up.
    store.attachStripeBalanceTxn = async () => {
      throw new Error('db write failed after Stripe already moved value');
    };

    const r = await applyTokenSubsidy({ store, applyCustomerCredit }, ARGS);

    expect(r.outcome).toBe('applied');
    expect(applyCustomerCredit).toHaveBeenCalledTimes(1);
    // The token stays spent. A refund here would be free money.
    expect(store.balanceOf('u1')).toBe(0);
    expect(store.rows.filter((row) => row.reason === 'spend_refund')).toHaveLength(0);
  });

  it('cannot be farmed by repeating the failure with rotating keys', async () => {
    const store = makeStore();
    await seed(store, 'u1', 3);
    const applyCustomerCredit = vi.fn(async () => ({ id: 'cbtxn_real' }));
    store.attachStripeBalanceTxn = async () => {
      throw new Error('db write failed');
    };

    for (let i = 0; i < 3; i++) {
      await applyTokenSubsidy({ store, applyCustomerCredit }, { ...ARGS, idempotencyKey: `k${i}` });
    }
    // 3 tokens in, 3 spent, nothing handed back.
    expect(store.balanceOf('u1')).toBe(0);
    expect(store.rows.filter((row) => row.reason === 'spend_refund')).toHaveLength(0);
  });
});

describe('subsidy — a spendRef belonging to another user is refused', () => {
  it('never funds one user\'s credit from another user\'s debit', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1);
    const applyCustomerCredit = vi.fn(async () => ({ id: 'cbtxn_1' }));
    // u1 spends, leaving a debit row keyed on u1's namespaced spendRef.
    await applyTokenSubsidy({ store, applyCustomerCredit }, ARGS);
    const victimDebit = store.rows.find((row) => row.deltaTokens < 0)!;

    // Attacker crafts a key that resolves to the SAME spendRefId.
    const attacker = { ...ARGS, userId: 'u2', idempotencyKey: 'crafted', stripeCustomerId: 'cus_ATTACKER' };
    store.getTokenLedgerEntryBySpendRef = async () => victimDebit; // force the collision

    const r = await applyTokenSubsidy({ store, applyCustomerCredit }, attacker);

    expect(r.outcome).toBe('key_conflict');
    // The attacker's Stripe customer must never be credited off someone else's debit.
    expect(applyCustomerCredit).toHaveBeenCalledTimes(1);
    expect(applyCustomerCredit.mock.calls[0][0]).not.toBe('cus_ATTACKER');
  });
});

describe('subsidy — the paths that must keep working', () => {
  it('applies the credit and settles the row when Stripe succeeds', async () => {
    const store = makeStore();
    await seed(store, 'u1', 2);
    const applyCustomerCredit = vi.fn(async () => ({ id: 'cbtxn_1' }));

    const r = await applyTokenSubsidy({ store, applyCustomerCredit }, { ...ARGS, tokens: 2 });
    expect(r).toMatchObject({ outcome: 'applied', tokensSpent: 2, creditCents: 9800, stripeBalanceTxnId: 'cbtxn_1' });
    expect(store.balanceOf('u1')).toBe(0);
    // The Stripe call is keyed on the ledger row, so a network retry cannot double-credit.
    expect(applyCustomerCredit.mock.calls[0][3]).toMatch(/^wallet_credit_/);
  });

  it('replays a SETTLED key as an idempotent success without spending again', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1);
    const applyCustomerCredit = vi.fn(async () => ({ id: 'cbtxn_1' }));

    await applyTokenSubsidy({ store, applyCustomerCredit }, ARGS);
    const replay = await applyTokenSubsidy({ store, applyCustomerCredit }, ARGS);

    expect(replay).toMatchObject({ outcome: 'already_applied', tokensSpent: 1, creditCents: 4900 });
    expect(applyCustomerCredit).toHaveBeenCalledTimes(1);
    expect(store.rows.filter((r) => r.deltaTokens < 0)).toHaveLength(1);
    expect(store.balanceOf('u1')).toBe(0);
  });

  it('resumes a genuine mid-flight retry: a debit with no refund and no Stripe txn is reused, not re-debited', async () => {
    // Models the process dying between the wallet COMMIT and the Stripe call.
    const store = makeStore();
    await seed(store, 'u1', 1);
    let calls = 0;
    const flaky: ApplyCustomerCredit = async () => {
      // First call: pretend the process died AFTER the debit but before Stripe by
      // throwing a value the caller treats as a Stripe failure... except we want
      // NO refund to exist, so we simulate the crash by writing the debit directly.
      calls++;
      return { id: 'cbtxn_late' };
    };
    // Hand-place an unsettled, unrefunded debit for this key.
    await store.runWalletTransaction(async (tx) => {
      await tx.lockUser('u1');
      return tx.insertEntry({
        userId: 'u1', deltaTokens: -1, reason: 'spend_subscription_credit',
        usdValueCents: TOKEN_USD_CENTS,
        spendRefType: SUBSIDY_SPEND_REF_TYPE, spendRefId: `u1:${ARGS.idempotencyKey}`,
      });
    });
    expect(store.balanceOf('u1')).toBe(0);

    const r = await applyTokenSubsidy({ store, applyCustomerCredit: flaky }, ARGS);
    expect(r).toMatchObject({ outcome: 'applied', tokensSpent: 1, creditCents: 4900 });
    expect(calls).toBe(1);
    // Still exactly ONE debit — the retry did not charge the user twice.
    expect(store.rows.filter((r) => r.deltaTokens < 0)).toHaveLength(1);
    expect(store.balanceOf('u1')).toBe(0);
  });

  it('rejects a key reused for a different token count instead of silently charging the old amount', async () => {
    const store = makeStore();
    await seed(store, 'u1', 5);
    await store.runWalletTransaction(async (tx) => {
      await tx.lockUser('u1');
      return tx.insertEntry({
        userId: 'u1', deltaTokens: -1, reason: 'spend_subscription_credit',
        usdValueCents: TOKEN_USD_CENTS,
        spendRefType: SUBSIDY_SPEND_REF_TYPE, spendRefId: `u1:${ARGS.idempotencyKey}`,
      });
    });
    const r = await applyTokenSubsidy(
      { store, applyCustomerCredit: async () => ({ id: 'x' }) },
      { ...ARGS, tokens: 3 },
    );
    expect(r).toEqual({ outcome: 'key_conflict', tokensOnRecord: 1 });
  });

  it('refuses to spend a balance the user does not have, and writes nothing', async () => {
    const store = makeStore();
    const applyCustomerCredit = vi.fn(async () => ({ id: 'x' }));
    const r = await applyTokenSubsidy({ store, applyCustomerCredit }, ARGS);
    expect(r).toMatchObject({ outcome: 'insufficient_tokens', balance: 0, required: 1 });
    expect(applyCustomerCredit).not.toHaveBeenCalled();
    expect(store.rows).toHaveLength(0);
  });

  it('never touches another user’s wallet', async () => {
    const store = makeStore();
    await seed(store, 'rich', 5);
    const r = await applyTokenSubsidy(
      { store, applyCustomerCredit: async () => ({ id: 'x' }) },
      { ...ARGS, userId: 'poor' },
    );
    expect(r).toMatchObject({ outcome: 'insufficient_tokens' });
    expect(store.balanceOf('rich')).toBe(5);
  });

  it('namespaces the idempotency key by user, so two users may use the same key', async () => {
    const store = makeStore();
    await seed(store, 'a', 1);
    await seed(store, 'b', 1);
    const applyCustomerCredit = vi.fn(async () => ({ id: `cbtxn_${Math.random()}` }));

    const ra = await applyTokenSubsidy({ store, applyCustomerCredit }, { ...ARGS, userId: 'a' });
    const rb = await applyTokenSubsidy({ store, applyCustomerCredit }, { ...ARGS, userId: 'b' });
    expect(ra.outcome).toBe('applied');
    expect(rb.outcome).toBe('applied');
    expect(store.balanceOf('a')).toBe(0);
    expect(store.balanceOf('b')).toBe(0);
  });
});

describe('subsidy — redeem at GRANT value, not today’s rate', () => {
  it('a reprice does not change the payout for an already-minted token', async () => {
    // One token granted at $49. TOKEN_USD_CENTS is later raised to $60 — modelled
    // by granting the NEXT token at the new price, since every row carries its own.
    const store = makeStore();
    await seed(store, 'u1', 1, 4900);
    await seed(store, 'u1', 1, 6000);

    const applyCustomerCredit = vi.fn(async () => ({ id: 'cbtxn_1' }));
    const r = await applyTokenSubsidy({ store, applyCustomerCredit }, ARGS);

    // FIFO: the OLDEST lot is consumed, so Stripe is credited $49 — the value the
    // wallet balance showed — not $60. Valuing at today's rate would hand the user
    // $11 of free credit per token every time the price went up.
    expect(r).toMatchObject({ outcome: 'applied', creditCents: 4900 });
    expect(applyCustomerCredit.mock.calls[0][1]).toBe(4900);
  });

  it('credits the exact grant value across a reprice boundary when a spend straddles two lots', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1, 4900);
    await seed(store, 'u1', 1, 6000);

    const applyCustomerCredit = vi.fn(async () => ({ id: 'cbtxn_1' }));
    const r = await applyTokenSubsidy({ store, applyCustomerCredit }, { ...ARGS, tokens: 2 });

    // 4900 + 6000 — not 2 × today's price, and not 2 × the older price either.
    expect(r).toMatchObject({ outcome: 'applied', creditCents: 10900 });
    expect(applyCustomerCredit.mock.calls[0][1]).toBe(10900);
  });

  it('refunds the value that was taken, so a reprice cannot be farmed through the failure path', async () => {
    const store = makeStore();
    await seed(store, 'u1', 1, 4900);
    await applyTokenSubsidy({ store, applyCustomerCredit: alwaysFails }, ARGS);

    const refund = store.rows.find((r) => r.reason === 'spend_refund')!;
    // Not TOKEN_USD_CENTS-of-the-day: the user gets back exactly the $49 lot.
    expect(refund.usdValueCents).toBe(4900);
    expect(refund.deltaTokens).toBe(1);
  });
});
