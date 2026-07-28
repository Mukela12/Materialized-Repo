/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SUBSCRIPTION SUBSIDY — spend tokens as a credit on the user's own invoice.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * This is the third and only externally-visible token sink: a NEGATIVE Stripe
 * customer balance transaction, which Stripe drains at the next invoice
 * finalization. It is the one place where a ledger row turns into an instruction
 * to a payment processor, so it is the one place where a control-flow mistake
 * becomes money.
 *
 * It lives in its own module, behind injected dependencies, for exactly one
 * reason: THE COMPENSATION BRANCH HAS TO BE UNIT-TESTABLE. It only runs when
 * Stripe throws, which is the case that never happens in manual testing and the
 * case that was farmable — see the mint-loop note below. Buried inline in an
 * Express handler it could only be exercised against a live Stripe failure.
 *
 * ── ORDERING, which is the part that costs money if you get it wrong ─────────
 * The wallet is debited and COMMITTED first, then Stripe is called. If Stripe
 * fails we append a compensating `spend_refund` credit. The reverse order
 * (Stripe first) would leave an un-debited credit sitting on the customer
 * whenever the DB write failed.
 *
 * ── THE MINT LOOP THIS MODULE EXISTS TO CLOSE ───────────────────────────────
 * Two defects used to compound into unbounded minting:
 *
 *   (a) the compensating refund was appended with NO spend ref. The unique index
 *       token_ledger_spend_ref_uniq is PARTIAL (`WHERE spend_ref_id IS NOT NULL`),
 *       so a refund without one is constrained by nothing — refunds were unlimited.
 *   (b) an existing unsettled debit for the idempotency key was REUSED without
 *       checking whether it had already been refunded, so a repeat request skipped
 *       the debit entirely.
 *
 * Together: balance 1, POST {tokens:1, key:"K"} → debit commits, Stripe throws,
 * refund +1, balance back to 1. Repeat with the SAME key → the debit is skipped
 * (the row exists), Stripe throws again, ANOTHER refund +1, balance 2. Every
 * subsequent call appended a credit with no matching debit. A stale
 * stripe_customer_id makes the Stripe error stable and repeatable (Stripe replays
 * a cached error for a repeated idempotency key), so it was farmable on demand at
 * up to 50 tokens — $2,450 — per request.
 *
 * Both halves are closed here, and in that order of authority:
 *   1. the refund carries (SPEND_REFUND_REF_TYPE, debit row id), so the DATABASE
 *      makes a second refund for one debit impossible;
 *   2. the reuse branch REFUSES a debit that already has a refund, failing closed
 *      with `already_refunded` instead of silently skipping the debit.
 *
 * Guard 2 alone would be a race; guard 1 alone would leave a confusing 500. The
 * index is the guarantee, the check is the legible error.
 */
import {
  spendTokens,
  creditTokens,
  spendValueOfEntry,
  SPEND_REFUND_REF_TYPE,
  type WalletTxRunner,
} from "./wallet";
import type { TokenLedgerEntry } from "@shared/schema";

/** The storage primitives this flow needs. `storage` satisfies it structurally. */
export interface SubsidyStore extends WalletTxRunner {
  getTokenLedgerEntryBySpendRef(
    spendRefType: string,
    spendRefId: string,
  ): Promise<TokenLedgerEntry | undefined>;
  /** Full history, OLDEST FIRST — the FIFO grant valuation depends on the order. */
  getTokenLedger(userId: string): Promise<TokenLedgerEntry[]>;
  getTokenBalance(userId: string): Promise<number>;
  attachStripeBalanceTxn(
    entryId: string,
    stripeBalanceTxnId: string,
  ): Promise<TokenLedgerEntry | undefined>;
}

/**
 * stripeService.applyCustomerCreditCents, injected.
 *
 * Injected rather than imported so a test can make it throw: the failure path is
 * the one that mints, and it must be reachable without a live Stripe outage.
 */
export type ApplyCustomerCredit = (
  customerId: string,
  creditCents: number,
  description: string,
  idempotencyKey: string,
  metadata?: Record<string, string>,
) => Promise<{ id: string }>;

export interface SubsidyDeps {
  store: SubsidyStore;
  applyCustomerCredit: ApplyCustomerCredit;
}

export interface SubsidyArgs {
  /** MUST be the session user. Never a client-supplied id. */
  userId: string;
  stripeCustomerId: string;
  tokens: number;
  /** Client-chosen; namespaced by userId below so keys cannot collide across accounts. */
  idempotencyKey: string;
}

export type SubsidyOutcome =
  | {
      outcome: "applied";
      tokensSpent: number;
      creditCents: number;
      balanceAfter: number;
      stripeBalanceTxnId: string;
    }
  | {
      outcome: "already_applied";
      tokensSpent: number;
      creditCents: number;
      stripeBalanceTxnId: string;
    }
  /** This key's debit was already given back. The caller must use a NEW key. */
  | { outcome: "already_refunded"; walletEntryId: string; tokensRefunded: number }
  /** Same key, different token count — returning the original would charge the wrong amount. */
  | { outcome: "key_conflict"; tokensOnRecord: number }
  | { outcome: "insufficient_tokens"; balance: number; required: number }
  | { outcome: "spend_failed"; reason: string }
  /** Stripe rejected the credit. `tokensRefunded > 0` means the wallet is whole. */
  | { outcome: "stripe_failed"; walletEntryId: string; tokensRefunded: number };

export const SUBSIDY_SPEND_REF_TYPE = "stripe_customer_balance";

export async function applyTokenSubsidy(
  deps: SubsidyDeps,
  args: SubsidyArgs,
): Promise<SubsidyOutcome> {
  const { store } = deps;
  const { userId, tokens, stripeCustomerId } = args;
  const spendRefId = `${userId}:${args.idempotencyKey}`;

  const found = await store.getTokenLedgerEntryBySpendRef(SUBSIDY_SPEND_REF_TYPE, spendRefId);

  // The key is namespaced `${userId}:${idempotencyKey}`, which is only collision-free
  // because user ids happen to contain no colons. Do not lean on that: assert the row
  // we found actually belongs to the caller. Without this, a crafted key could reuse
  // ANOTHER user's debit to fund this caller's Stripe credit.
  if (found && found.userId !== userId) {
    console.error(
      `[Wallet] spendRef ${spendRefId} resolved to a row owned by ${found.userId}, not ${userId} — refusing`,
    );
    return { outcome: "key_conflict", tokensOnRecord: Math.abs(found.deltaTokens) };
  }
  const existing = found;

  if (existing?.stripeBalanceTxnId) {
    // Fully settled on a previous attempt. Idempotent success. The credit is
    // re-derived FIFO from the ledger so a replay reports the exact grant-time
    // money that was issued, never today's price.
    return {
      outcome: "already_applied",
      tokensSpent: Math.abs(existing.deltaTokens),
      creditCents: await grantValueOf(store, userId, existing),
      stripeBalanceTxnId: existing.stripeBalanceTxnId,
    };
  }

  if (existing) {
    // ── HALF 2 OF THE MINT FIX. Fail CLOSED on an already-refunded debit. ──
    const priorRefund = await store.getTokenLedgerEntryBySpendRef(
      SPEND_REFUND_REF_TYPE,
      existing.id,
    );
    if (priorRefund) {
      return {
        outcome: "already_refunded",
        walletEntryId: existing.id,
        tokensRefunded: Math.abs(priorRefund.deltaTokens),
      };
    }
    if (Math.abs(existing.deltaTokens) !== tokens) {
      return { outcome: "key_conflict", tokensOnRecord: Math.abs(existing.deltaTokens) };
    }
  }

  // Step 1 — debit, committed, before any external call. Reuse is now only
  // reachable for a debit that is neither settled NOR refunded: a genuine
  // mid-flight retry, e.g. the process died between the commit and the Stripe call.
  const spend = existing
    ? ({
        ok: true as const,
        entry: existing,
        balanceAfter: await store.getTokenBalance(userId),
        consumedUsdCents: await grantValueOf(store, userId, existing),
      })
    : await spendTokens(store, {
        userId,
        tokens,
        reason: "spend_subscription_credit",
        spendRefType: SUBSIDY_SPEND_REF_TYPE,
        spendRefId,
        description: "Applied to subscription fee as Stripe customer credit",
      });

  if (!spend.ok) {
    if (spend.error === "insufficient_tokens") {
      return { outcome: "insufficient_tokens", balance: spend.balance, required: spend.required };
    }
    return { outcome: "spend_failed", reason: spend.error };
  }

  const tokensSpent = Math.abs(spend.entry.deltaTokens);
  // Invariant 5: the credit is the GRANT-time value of the tokens actually
  // consumed (FIFO) — exactly the balance the wallet UI showed. Never today's
  // TOKEN_USD_CENTS: a reprice must not restate what an existing holding pays out.
  const creditCents = spend.consumedUsdCents;

  // Step 2 — the external call, keyed on the ledger row so a retry after a
  // timeout returns Stripe's original transaction instead of double-crediting.
  // ⚠ ONLY the Stripe call belongs in this try. The catch below REFUNDS the
  // token, so anything inside it that runs AFTER Stripe has already moved value
  // would hand the user the credit AND their token back. `attachStripeBalanceTxn`
  // is therefore deliberately outside it: once `applyCustomerCredit` returns, the
  // customer has been credited and this spend is final.
  let txn: { id: string };
  try {
    txn = await deps.applyCustomerCredit(
      stripeCustomerId,
      creditCents,
      `Materialized token redemption (${tokensSpent} token${tokensSpent === 1 ? "" : "s"})`,
      `wallet_credit_${spend.entry.id}`,
      { userId, walletEntryId: spend.entry.id },
    );
  } catch (stripeErr) {
    // Step 3 — compensate. Append a refund rather than editing history.
    console.error(`[Wallet] Stripe credit failed for entry ${spend.entry.id}:`, stripeErr);
    const refund = await creditTokens(store, {
      userId,
      tokens: tokensSpent,
      reason: "spend_refund",
      // ── HALF 1 OF THE MINT FIX, and the authoritative half. ──
      // (spend_ref_type, spend_ref_id) is UNIQUE where spend_ref_id IS NOT NULL,
      // so Postgres now permits AT MOST ONE refund per debit row. Removing either
      // field re-opens unbounded minting.
      spendRefType: SPEND_REFUND_REF_TYPE,
      spendRefId: spend.entry.id,
      // Give back exactly the grant value that was taken, not today's price.
      usdValueCents: spend.entry.usdValueCents,
      description: `Refund — Stripe customer credit failed for wallet entry ${spend.entry.id}`,
    });

    // `duplicate_credit` = the index already holds a refund for this debit. The
    // user is whole; this is a replay, not a failure to compensate.
    const alreadyRefunded = !refund.ok && refund.error === "duplicate_credit";
    if (!refund.ok && !alreadyRefunded) {
      // Nothing else to try automatically. Log loudly: the debit row is
      // discoverable by (reason = spend_subscription_credit AND
      // stripe_balance_txn_id IS NULL) and is admin-grantable.
      console.error(
        `[Wallet] REFUND ALSO FAILED for entry ${spend.entry.id} — manual grant required`,
      );
    }
    return {
      outcome: "stripe_failed",
      walletEntryId: spend.entry.id,
      tokensRefunded: refund.ok || alreadyRefunded ? tokensSpent : 0,
    };
  }

  // Stripe has credited the customer — the spend is final and MUST NOT be
  // refunded from here. Recording the transaction id is bookkeeping only, so a
  // failure is logged for reconciliation rather than compensated. (Losing the id
  // costs us the `stripe_balance_txn_id` idempotency marker; the debit itself is
  // still keyed by spendRefId, so a replay cannot double-spend.)
  try {
    await store.attachStripeBalanceTxn(spend.entry.id, txn.id);
  } catch (attachErr) {
    console.error(
      `[Wallet] Stripe credit ${txn.id} SUCCEEDED for entry ${spend.entry.id} but recording it failed ` +
        `— customer is credited, do NOT refund; reconcile manually:`,
      attachErr,
    );
  }

  return {
    outcome: "applied",
    tokensSpent,
    creditCents,
    balanceAfter: spend.balanceAfter,
    stripeBalanceTxnId: txn.id,
  };
}

/** FIFO grant value consumed by `entry`, with the row's own value as a fallback. */
async function grantValueOf(
  store: SubsidyStore,
  userId: string,
  entry: TokenLedgerEntry,
): Promise<number> {
  const ledger = await store.getTokenLedger(userId);
  return spendValueOfEntry(ledger, entry.id) ?? Math.abs(entry.deltaTokens) * entry.usdValueCents;
}
