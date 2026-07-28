/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOKEN WALLET — TOKENS ARE NEVER CASHABLE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A token is a PREPAID PLATFORM CREDIT worth exactly $49 (4900 cents) against
 * Materialized's OWN fees. It is not money, it is not withdrawable, and it must
 * never become either.
 *
 * There is deliberately NO code path from this module — or from `token_ledger` —
 * to any of the following, and a reviewer should check all of them:
 *
 *     commission_transactions  (server/commissions.ts, the earnings ledger)
 *     affiliate_payouts        (shared/schema.ts)
 *     planPayouts / executePayouts / deps.transfer   (server/payouts.ts)
 *     stripe.transfers.create  (stripeService.createTransfer/createTransferCents)
 *     stripe.payouts.*
 *
 * That is the cash path — approved commissions → payout batch → Stripe transfer →
 * the affiliate's bank. `token_ledger` is read by NONE of it, and this file
 * imports NONE of those modules. The unit test `wallet-cash-isolation.test.ts`
 * asserts that at the source level, so wiring a cash path in later fails CI
 * rather than quietly shipping.
 *
 * A token has exactly THREE sinks, all of which consume it INSIDE Materialized:
 *
 *   1. spend_library_listing     — list one video in the Global Video Library
 *   2. spend_playlist            — publish a curated playlist, ONE TOKEN PER VIDEO
 *   3. spend_subscription_credit — a NEGATIVE Stripe customer balance transaction,
 *                                  i.e. a discount on the user's own next invoice
 *
 * ── The one honest caveat ────────────────────────────────────────────────────
 * Sink 3 parks $49 on the Stripe CUSTOMER CREDIT BALANCE. A Stripe administrator
 * can, from the Stripe dashboard, refund a customer credit balance to cash. That
 * is an operational control on a human, not a code path in this repo — but it is
 * the single place where "never cashable" stops being enforced by code, so it is
 * named here rather than glossed over. Also note Stripe drains customer credit
 * against ANY finalized invoice, including a surplus/overage invoice
 * (stripeService.createSurplusInvoice) — same dollar value to the user, different
 * line item than the monthly fee the client described.
 *
 * ── Invariants this module exists to hold ────────────────────────────────────
 * 1. NEVER CASHABLE                — stated above; enforced by isolation + a test.
 * 2. APPEND-ONLY                   — one row per event, balance = SUM(delta_tokens).
 *                                    No mutable balance column anywhere. The single
 *                                    permitted UPDATE is attaching a Stripe balance
 *                                    transaction id to a row that has none, which
 *                                    cannot change any balance.
 * 3. ONE TOKEN PER BRAND CONVERSION— enforced by the partial UNIQUE indexes
 *                                    token_ledger_brand_conversion_uniq and
 *                                    token_ledger_subscriber_conversion_uniq, NOT
 *                                    by the application logic below. The logic is
 *                                    the fast path; the index is the guarantee.
 * 4. NO DOUBLE-SPEND               — balance check and debit happen in ONE
 *                                    transaction behind a per-user lock, and the
 *                                    resulting balance is RE-READ after the insert
 *                                    and must be >= 0 or the transaction aborts.
 * 5. VALUE CAPTURED AT GRANT TIME  — every row stores usd_value_cents; repricing
 *                                    tokens never rewrites history. A SPEND is
 *                                    valued at the GRANT price of the specific
 *                                    tokens it consumes (FIFO), not at today's
 *                                    price — so raising TOKEN_USD_CENTS can never
 *                                    retroactively change what an already-minted
 *                                    token pays out, and the payout always equals
 *                                    the balance the user was shown.
 *
 * Everything here is written against injected interfaces (the house style of
 * server/commissions.ts and server/payouts.ts) so the money logic unit-tests
 * without a database.
 */
import { TOKEN_USD_CENTS } from "@shared/pricing";
import { PLAN_CONFIG, TOKEN_QUALIFYING_PLANS, isPlanKey, type PlanKey } from "@shared/plans";
import type { TokenLedgerEntry, TokenLedgerReason } from "@shared/schema";

export { TOKEN_USD, TOKEN_USD_CENTS, tokensForFee } from "@shared/pricing";

// ─────────────────────────────────────────────────────────────────────────────
// Reason taxonomy
// ─────────────────────────────────────────────────────────────────────────────

/** Reasons that ADD tokens (delta_tokens > 0). */
export const CREDIT_REASONS = [
  "brand_conversion",
  "admin_grant",
  "spend_refund",
] as const satisfies readonly TokenLedgerReason[];

/** Reasons that REMOVE tokens (delta_tokens < 0). */
export const DEBIT_REASONS = [
  "spend_library_listing",
  "spend_playlist",
  "spend_subscription_credit",
  "admin_revoke",
] as const satisfies readonly TokenLedgerReason[];

/** The three user-facing spend sinks. `admin_revoke` is a correction, not a spend. */
export const SPEND_REASONS = [
  "spend_library_listing",
  "spend_playlist",
  "spend_subscription_credit",
] as const satisfies readonly TokenLedgerReason[];

export type CreditReason = (typeof CREDIT_REASONS)[number];
export type DebitReason = (typeof DEBIT_REASONS)[number];
export type SpendReason = (typeof SPEND_REASONS)[number];

export function isCreditReason(r: TokenLedgerReason): r is CreditReason {
  return (CREDIT_REASONS as readonly string[]).includes(r);
}
export function isDebitReason(r: TokenLedgerReason): r is DebitReason {
  return (DEBIT_REASONS as readonly string[]).includes(r);
}
export function isSpendReason(r: unknown): r is SpendReason {
  return typeof r === "string" && (SPEND_REASONS as readonly string[]).includes(r);
}

/** What a spend row points at. Half of the (type, id) spend-idempotency key. */
export type SpendRefType = "global_video_listing" | "playlist" | "stripe_customer_balance";

/**
 * spend_ref_type for a COMPENSATING REFUND, paired with spend_ref_id = the id of
 * the debit row being refunded.
 *
 * This is not decoration, it is the mint guard. A refund without a spend ref is
 * unconstrained by token_ledger_spend_ref_uniq (the index is partial —
 * `WHERE spend_ref_id IS NOT NULL`), so the same failed spend could be "refunded"
 * again and again, each time appending a credit with no matching debit. With this
 * ref the index makes a second refund for the same debit row physically impossible.
 */
export const SPEND_REFUND_REF_TYPE = "spend_refund";

// ─────────────────────────────────────────────────────────────────────────────
// Transaction surface
//
// The DB layer supplies these four primitives; ALL of the money logic lives in
// this file, above them. That split is what makes invariant 4 unit-testable:
// a fake runner can interleave two callers between sumBalance() and insertEntry()
// and the post-insert re-read still has to catch it.
// ─────────────────────────────────────────────────────────────────────────────

/** A ledger row as written. `id`/`createdAt` are DB-generated. */
export interface NewLedgerEntry {
  userId: string;
  /** SIGNED. Positive credits, negative debits. Never zero (DB CHECK enforces). */
  deltaTokens: number;
  reason: TokenLedgerReason;
  /** USD value of ONE token, captured now. Invariant 5. */
  usdValueCents: number;
  sourceBrandId?: string | null;
  sourceSubscriptionUserId?: string | null;
  stripeSubscriptionId?: string | null;
  attributionMethod?: string | null;
  attributedVideoId?: string | null;
  brandReferralId?: string | null;
  spendRefType?: string | null;
  spendRefId?: string | null;
  stripeBalanceTxnId?: string | null;
  description?: string | null;
  adminNote?: string | null;
}

export interface WalletTx {
  /**
   * Serialize all wallet writes for one user for the remainder of the
   * transaction. In Postgres this is a transaction-scoped ADVISORY lock, not a
   * row lock: `SELECT ... FOR UPDATE` cannot be combined with an aggregate, and
   * locking the user's existing rows would not cover rows a concurrent
   * transaction INSERTS, which is precisely the double-spend case.
   */
  lockUser(userId: string): Promise<void>;
  /** COALESCE(SUM(delta_tokens), 0) for the user, inside this transaction. */
  sumBalance(userId: string): Promise<number>;
  /**
   * The user's FULL history, OLDEST FIRST, inside this transaction.
   *
   * Needed because a spend is priced at the GRANT value of the tokens it consumes
   * (invariant 5), which is a FIFO walk over the history — and that walk has to
   * happen under the same lock as the debit, or two concurrent spends could both
   * price themselves against the same cheap lot.
   */
  listRows(userId: string): Promise<BalanceRow[]>;
  /** INSERT one row. Throws a Postgres 23505 if it trips a unique index. */
  insertEntry(entry: NewLedgerEntry): Promise<TokenLedgerEntry>;
}

export interface WalletTxRunner {
  /** BEGIN … COMMIT, rolling back if `fn` throws. */
  runWalletTransaction<T>(fn: (tx: WalletTx) => Promise<T>): Promise<T>;
}

/**
 * True for a Postgres unique-violation (SQLSTATE 23505).
 *
 * Mirrors server/commissions.ts — duplicated rather than imported ON PURPOSE:
 * this module must not import the commission/earnings modules at all, so that
 * the cash-isolation test can be a blunt source-level grep. Four lines of
 * duplication buys an enforceable invariant. The `?? cause?.code` fallback
 * matters: drizzle wraps the pg error.
 */
export function isUniqueViolation(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.cause?.code;
  return code === "23505";
}

/** Thrown when the post-insert balance re-read comes back negative. Forces ROLLBACK. */
export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerInvariantError";
  }
}

/** Internal sentinel used to abort a transaction and report a typed failure. */
class SpendAbort extends Error {
  constructor(readonly result: SpendFailure) {
    super(result.error);
    this.name = "SpendAbort";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure balance derivation
// ─────────────────────────────────────────────────────────────────────────────

/** A ledger row, reduced to what the balance math needs. */
export interface BalanceRow {
  deltaTokens: number;
  usdValueCents: number;
}

/** Balance = SUM(delta_tokens). The only definition of a balance in this system. */
export function deriveBalance(rows: readonly BalanceRow[]): number {
  return rows.reduce((sum, r) => sum + r.deltaTokens, 0);
}

// ── FIFO lots: the one valuation rule, used by BOTH the balance and the payout ──
//
// A wallet is not a pile of interchangeable tokens once the price can change: it
// is an ordered queue of LOTS, each stamped with what a token was worth when it
// was granted. `summarizeLedger` values the surviving balance this way, and
// `spendTokens` charges a spend this way, so the number the UI shows and the
// number Stripe is credited are computed by the same code over the same rows.
//
// Getting this wrong is not a rounding bug: if a spend were valued at today's
// price, raising TOKEN_USD_CENTS from 4900 to 6000 would pay out $60 for a token
// whose balance line still read $49 — a reprice silently rewriting what already
// minted tokens are worth.

/** One surviving grant: `tokens` still unspent, each worth `usdValueCents`. */
export interface TokenLot {
  tokens: number;
  usdValueCents: number;
}

/**
 * Retire `tokens` from the FRONT of `lots` (MUTATES `lots`) and return the
 * grant-time value consumed, in cents.
 *
 * `fallbackUnitCents` prices any shortfall — reachable only if the ledger is
 * inconsistent (invariant 4 says a balance is never negative), and priced rather
 * than thrown so a corrupted history cannot make a read endpoint 500.
 */
export function consumeLots(lots: TokenLot[], tokens: number, fallbackUnitCents: number): number {
  let remaining = tokens;
  let usdCents = 0;
  while (remaining > 0 && lots.length > 0) {
    const lot = lots[0];
    const take = Math.min(lot.tokens, remaining);
    usdCents += take * lot.usdValueCents;
    lot.tokens -= take;
    remaining -= take;
    if (lot.tokens === 0) lots.shift();
  }
  if (remaining > 0) usdCents += remaining * fallbackUnitCents;
  return usdCents;
}

/**
 * Rebuild the surviving FIFO lots from a complete history, OLDEST FIRST.
 * The order of `rows` is load-bearing — see IStorage.getTokenLedger.
 */
export function fifoLots(rows: readonly BalanceRow[]): TokenLot[] {
  const lots: TokenLot[] = [];
  for (const row of rows) {
    if (row.deltaTokens > 0) {
      lots.push({ tokens: row.deltaTokens, usdValueCents: row.usdValueCents });
    } else if (row.deltaTokens < 0) {
      consumeLots(lots, -row.deltaTokens, row.usdValueCents);
    }
  }
  return lots;
}

/** A ledger row with its id, for replaying what one specific debit consumed. */
export interface IdentifiedBalanceRow extends BalanceRow {
  id: string;
}

/**
 * Replay the ledger ONCE and return, per row id, the exact grant-time value in
 * cents that row moved: the lots a debit retired, or `tokens × unit` for a credit.
 *
 * Deterministic — the same history always yields the same answer — which is what
 * lets an idempotent replay of a settled subsidy report the same money it
 * originally issued, and lets the ledger UI show a per-row figure that adds up to
 * the balance exactly rather than to a rounded unit price.
 */
export function ledgerRowValues(rows: readonly IdentifiedBalanceRow[]): Map<string, number> {
  const values = new Map<string, number>();
  const lots: TokenLot[] = [];
  for (const row of rows) {
    if (row.deltaTokens > 0) {
      lots.push({ tokens: row.deltaTokens, usdValueCents: row.usdValueCents });
      values.set(row.id, row.deltaTokens * row.usdValueCents);
    } else if (row.deltaTokens < 0) {
      values.set(row.id, consumeLots(lots, -row.deltaTokens, row.usdValueCents));
    }
  }
  return values;
}

/**
 * The grant-time value (cents) that the debit row `entryId` consumed.
 * Returns null if `entryId` is not a debit in `rows`.
 */
export function spendValueOfEntry(
  rows: readonly IdentifiedBalanceRow[],
  entryId: string,
): number | null {
  const lots: TokenLot[] = [];
  for (const row of rows) {
    if (row.deltaTokens > 0) {
      lots.push({ tokens: row.deltaTokens, usdValueCents: row.usdValueCents });
    } else if (row.deltaTokens < 0) {
      const consumed = consumeLots(lots, -row.deltaTokens, row.usdValueCents);
      if (row.id === entryId) return consumed;
    }
  }
  return null;
}

/**
 * The per-token unit value stamped onto a debit row, given the exact FIFO total.
 *
 * `usd_value_cents` is a UNIT price and the schema's CHECK requires it positive,
 * so a spend that straddles a reprice boundary (e.g. one $49 token and one $60
 * token in a single 2-token spend) has no exact integer unit. The row carries the
 * rounded unit for display; the EXACT total is what is returned from spendTokens
 * and what is actually paid out, and `summarizeLedger` re-derives spend value from
 * the lots rather than from this field, so nothing downstream inherits the rounding.
 */
export function unitValueForSpend(totalUsdCents: number, tokens: number): number {
  return Math.max(1, Math.round(totalUsdCents / tokens));
}

export interface WalletSummary {
  /** Spendable now. Never negative — see invariant 4. */
  balance: number;
  /** Tokens ever credited (mints, grants, refunds). */
  lifetimeEarned: number;
  /** Tokens ever debited, as a POSITIVE number. */
  lifetimeSpent: number;
  /**
   * USD value of the current balance, valued at each row's OWN grant-time price
   * rather than today's — so a repricing does not silently restate what a user
   * already holds. Computed FIFO: the oldest surviving credits are the ones the
   * balance is made of.
   */
  balanceUsdCents: number;
  /** Grant-time value of everything ever earned. */
  lifetimeEarnedUsdCents: number;
  /**
   * Value of everything ever spent, at the GRANT price of the lots each spend
   * retired. Derived from the same FIFO walk as `balanceUsdCents`, so
   * `balanceUsdCents + lifetimeSpentUsdCents === lifetimeEarnedUsdCents` exactly,
   * always — even across a reprice, and even if a debit row's rounded unit price
   * cannot express its total.
   */
  lifetimeSpentUsdCents: number;
  /** Today's price per token, for display of what a NEW token is worth. */
  currentTokenUsdCents: number;
}

/**
 * Summarize a user's full ledger.
 *
 * `rows` must be the user's COMPLETE history, oldest first — the FIFO valuation
 * of the surviving balance depends on the order.
 */
export function summarizeLedger(rows: readonly BalanceRow[]): WalletSummary {
  let lifetimeEarned = 0;
  let lifetimeSpent = 0;
  let lifetimeEarnedUsdCents = 0;
  let lifetimeSpentUsdCents = 0;

  // FIFO lots of surviving credits: [tokens, unit value at grant].
  const lots: Array<{ tokens: number; usdValueCents: number }> = [];

  for (const row of rows) {
    if (row.deltaTokens > 0) {
      lifetimeEarned += row.deltaTokens;
      lifetimeEarnedUsdCents += row.deltaTokens * row.usdValueCents;
      lots.push({ tokens: row.deltaTokens, usdValueCents: row.usdValueCents });
    } else if (row.deltaTokens < 0) {
      const spent = -row.deltaTokens;
      lifetimeSpent += spent;
      // Retire the oldest lots first and take the value from THEM, not from this
      // row's stamped unit price — that is what makes the arithmetic close exactly.
      lifetimeSpentUsdCents += consumeLots(lots, spent, row.usdValueCents);
    }
  }

  return {
    balance: lifetimeEarned - lifetimeSpent,
    lifetimeEarned,
    lifetimeSpent,
    balanceUsdCents: lots.reduce((s, l) => s + l.tokens * l.usdValueCents, 0),
    lifetimeEarnedUsdCents,
    lifetimeSpentUsdCents,
    currentTokenUsdCents: TOKEN_USD_CENTS,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SPEND — invariant 4
// ─────────────────────────────────────────────────────────────────────────────

export interface SpendTokensArgs {
  /** Whose wallet. Callers MUST pass the session user, never a client-supplied id. */
  userId: string;
  /** How many tokens to debit. Positive integer. */
  tokens: number;
  reason: SpendReason;
  spendRefType: SpendRefType;
  /**
   * Idempotency key for this purchase. (spendRefType, spendRefId) is UNIQUE, so a
   * retried request returns `duplicate_spend` instead of debiting a second time.
   */
  spendRefId: string;
  description?: string | null;
}

export type SpendFailure =
  | { ok: false; error: "insufficient_tokens"; balance: number; required: number }
  | { ok: false; error: "duplicate_spend" }
  | { ok: false; error: "invalid_request"; detail: string };

export type SpendResult =
  | {
      ok: true;
      entry: TokenLedgerEntry;
      balanceAfter: number;
      /**
       * EXACT grant-time value of the tokens this spend consumed, in cents.
       *
       * THIS is the number any external payout must use — never
       * `tokens * TOKEN_USD_CENTS`, which is today's price, and never
       * `tokens * entry.usdValueCents`, which is a rounded unit.
       */
      consumedUsdCents: number;
    }
  | SpendFailure;

/**
 * Debit `tokens` from a user's wallet, atomically.
 *
 * Two concurrent calls against a 1-token balance CANNOT both succeed:
 *
 *   BEGIN
 *     lockUser()                     -- serializes this user's wallet writes
 *     balanceBefore = SUM(delta)     -- read inside the lock
 *     reject if balanceBefore < tokens
 *     price the spend FIFO over listRows()  -- grant value, still inside the lock
 *     INSERT (delta = -tokens)
 *     balanceAfter = SUM(delta)      -- RE-READ after the insert
 *     if balanceAfter < 0 -> throw   -- forces ROLLBACK
 *   COMMIT
 *
 * The re-read is belt-and-braces, not decoration: it is the layer that still
 * holds if the lock is ever wrong, misconfigured, or replaced. A CHECK constraint
 * cannot express it — the condition is inherently cross-row.
 */
export async function spendTokens(
  runner: WalletTxRunner,
  args: SpendTokensArgs,
): Promise<SpendResult> {
  const { userId, tokens, reason, spendRefType, spendRefId } = args;

  if (!userId) return { ok: false, error: "invalid_request", detail: "userId is required" };
  if (!Number.isInteger(tokens) || tokens <= 0) {
    return { ok: false, error: "invalid_request", detail: "tokens must be a positive integer" };
  }
  if (!isSpendReason(reason)) {
    return { ok: false, error: "invalid_request", detail: `not a spend reason: ${reason}` };
  }
  if (!spendRefId) {
    return { ok: false, error: "invalid_request", detail: "spendRefId is required for idempotency" };
  }

  try {
    return await runner.runWalletTransaction(async (tx) => {
      await tx.lockUser(userId);

      const balanceBefore = await tx.sumBalance(userId);
      if (balanceBefore < tokens) {
        throw new SpendAbort({
          ok: false,
          error: "insufficient_tokens",
          balance: balanceBefore,
          required: tokens,
        });
      }

      // Invariant 5: this spend is priced at the GRANT value of the specific
      // tokens it retires, read under the same lock as the debit. Today's
      // TOKEN_USD_CENTS is used only to price a shortfall that cannot occur.
      const consumedUsdCents = consumeLots(
        fifoLots(await tx.listRows(userId)),
        tokens,
        TOKEN_USD_CENTS,
      );

      const entry = await tx.insertEntry({
        userId,
        deltaTokens: -tokens,
        reason,
        usdValueCents: unitValueForSpend(consumedUsdCents, tokens),
        spendRefType,
        spendRefId,
        description: args.description ?? null,
      });

      const balanceAfter = await tx.sumBalance(userId);
      if (balanceAfter < 0) {
        // Someone else debited between our read and our insert. Aborting rolls the
        // debit back, so the losing caller consumes nothing.
        throw new LedgerInvariantError(
          `token_ledger balance for user ${userId} would go negative (${balanceAfter}) — spend rolled back`,
        );
      }

      return { ok: true as const, entry, balanceAfter, consumedUsdCents };
    });
  } catch (err) {
    if (err instanceof SpendAbort) return err.result;
    // The (spend_ref_type, spend_ref_id) unique index fired: this exact purchase
    // was already paid for. Idempotent no-op, not an error.
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate_spend" };
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CREDIT — grants, refunds, admin corrections
// ─────────────────────────────────────────────────────────────────────────────

export interface CreditTokensArgs {
  userId: string;
  tokens: number;
  reason: CreditReason;
  description?: string | null;
  adminNote?: string | null;
  /**
   * Idempotency identity for this credit. For a compensating refund this MUST be
   * SPEND_REFUND_REF_TYPE + the id of the debit being refunded: the partial unique
   * index token_ledger_spend_ref_uniq only constrains rows where spend_ref_id IS
   * NOT NULL, so a refund written without one is a credit that can be appended an
   * unlimited number of times. That is a mint, not a refund.
   */
  spendRefType?: string | null;
  spendRefId?: string | null;
  /**
   * Unit value to stamp on the row. Defaults to today's TOKEN_USD_CENTS, which is
   * right for a NEW grant. A REFUND must pass the value the debit actually
   * consumed, or a reprice between debit and refund hands the user free value.
   */
  usdValueCents?: number;
}

export type CreditResult =
  | { ok: true; entry: TokenLedgerEntry; balanceAfter: number }
  | { ok: false; error: "duplicate_credit" }
  | { ok: false; error: "invalid_request"; detail: string };

/** Add tokens to a wallet. Used by admin grants and by spend compensation. */
export async function creditTokens(
  runner: WalletTxRunner,
  args: CreditTokensArgs,
): Promise<CreditResult> {
  if (!args.userId) return { ok: false, error: "invalid_request", detail: "userId is required" };
  if (!Number.isInteger(args.tokens) || args.tokens <= 0) {
    return { ok: false, error: "invalid_request", detail: "tokens must be a positive integer" };
  }
  if (!isCreditReason(args.reason)) {
    return { ok: false, error: "invalid_request", detail: `not a credit reason: ${args.reason}` };
  }
  if (args.usdValueCents !== undefined
      && (!Number.isInteger(args.usdValueCents) || args.usdValueCents <= 0)) {
    // CHECK token_ledger_value_positive. Fail here rather than as a 500 from the DB.
    return { ok: false, error: "invalid_request", detail: "usdValueCents must be a positive integer" };
  }
  // A refund must be able to prove WHICH debit it compensates, or the unique index
  // cannot stop a second one. Grants and admin credits legitimately have no ref.
  if (args.reason === "spend_refund" && !args.spendRefId) {
    return {
      ok: false,
      error: "invalid_request",
      detail: "a spend_refund requires spendRefType/spendRefId identifying the debit it refunds",
    };
  }

  try {
    return await runner.runWalletTransaction(async (tx) => {
      await tx.lockUser(args.userId);
      const entry = await tx.insertEntry({
        userId: args.userId,
        deltaTokens: args.tokens,
        reason: args.reason,
        usdValueCents: args.usdValueCents ?? TOKEN_USD_CENTS,
        description: args.description ?? null,
        adminNote: args.adminNote ?? null,
        spendRefType: args.spendRefType ?? null,
        spendRefId: args.spendRefId ?? null,
      });
      const balanceAfter = await tx.sumBalance(args.userId);
      return { ok: true as const, entry, balanceAfter };
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate_credit" };
    throw err;
  }
}

export interface RevokeTokensArgs {
  userId: string;
  tokens: number;
  adminNote: string;
  description?: string | null;
}

/**
 * Admin clawback (the negative leg of an attribution correction).
 *
 * Goes through the same locked, re-verified path as a spend, so a revoke can
 * never drive a balance negative. If the wrongly-credited user has ALREADY spent
 * the token, this returns `insufficient_tokens` rather than creating a negative
 * balance — the non-negative invariant is absolute, and an already-consumed token
 * is a business problem (recover the value elsewhere), not a ledger problem.
 */
export async function revokeTokens(
  runner: WalletTxRunner,
  args: RevokeTokensArgs,
): Promise<SpendResult> {
  const { userId, tokens } = args;
  if (!userId) return { ok: false, error: "invalid_request", detail: "userId is required" };
  if (!Number.isInteger(tokens) || tokens <= 0) {
    return { ok: false, error: "invalid_request", detail: "tokens must be a positive integer" };
  }

  try {
    return await runner.runWalletTransaction(async (tx) => {
      await tx.lockUser(userId);
      const balanceBefore = await tx.sumBalance(userId);
      if (balanceBefore < tokens) {
        throw new SpendAbort({
          ok: false,
          error: "insufficient_tokens",
          balance: balanceBefore,
          required: tokens,
        });
      }
      // Same FIFO valuation as a spend: a clawback removes the value that was
      // actually granted, not whatever a token happens to be worth today.
      const consumedUsdCents = consumeLots(
        fifoLots(await tx.listRows(userId)),
        tokens,
        TOKEN_USD_CENTS,
      );
      const entry = await tx.insertEntry({
        userId,
        deltaTokens: -tokens,
        reason: "admin_revoke",
        usdValueCents: unitValueForSpend(consumedUsdCents, tokens),
        description: args.description ?? null,
        adminNote: args.adminNote,
      });
      const balanceAfter = await tx.sumBalance(userId);
      if (balanceAfter < 0) {
        throw new LedgerInvariantError(
          `token_ledger balance for user ${userId} would go negative (${balanceAfter}) — revoke rolled back`,
        );
      }
      return { ok: true as const, entry, balanceAfter, consumedUsdCents };
    });
  } catch (err) {
    if (err instanceof SpendAbort) return err.result;
    if (isUniqueViolation(err)) return { ok: false, error: "duplicate_spend" };
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EARN — attribution + mint (invariant 3)
// ─────────────────────────────────────────────────────────────────────────────

/** True iff a paid subscription on this plan mints a token. See TOKEN_QUALIFYING_PLANS. */
export function planQualifiesForTokenMint(plan: unknown): plan is PlanKey {
  return isPlanKey(plan) && TOKEN_QUALIFYING_PLANS.includes(plan);
}

export type AttributionMethod = "brand_referral" | "first_touch_tag" | "admin_override";

/** One (brand → earliest tagging creator) pairing for a brand the subscriber owns. */
export interface BrandTagCandidate {
  brandId: string;
  /** The creator who tagged this brand earliest. */
  creatorId: string;
  /** The video that did the tagging — the evidence for the attribution. */
  videoId: string;
  /** videos.created_at. NULLABLE in the schema; nulls sort LAST. */
  taggedAt: Date | null;
  /**
   * Reserved for the referral branch. Always null today — see the
   * `brand_referral` note on resolveBrandConversionAttribution().
   */
  brandReferralId?: string | null;
}

export interface Attribution {
  brandId: string;
  creatorId: string;
  videoId: string;
  method: AttributionMethod;
  brandReferralId: string | null;
}

/**
 * Decide WHO gets the single token for a brand conversion, and for WHICH brand.
 *
 * ── OUR RULE, and why ────────────────────────────────────────────────────────
 * The client's words are "reward Creators for tagging a Brand". But tagging is
 * MANY-TO-MANY (video_brands: videoId -> brandId). If five creators tagged the
 * same brand and it subscribes at $249, paying all five would mint 5 x $49 = $245
 * of credit against a single $249 subscription. So:
 *
 *   AT MOST ONE TOKEN PER BRAND, for that brand's FIRST qualifying subscription.
 *
 * Priority order:
 *   1. brand_referral — the referring creator, if a brand_referrals link exists.
 *      NOT IMPLEMENTED, and honestly so: brand_referrals has NO brandId column,
 *      and its signup_token is written into the invite URL but never consumed at
 *      registration, so there is no deterministic referral -> brand link to read.
 *      Two things must land before this branch can be filled in:
 *        (a) a brand_referrals.brand_id FK, and
 *        (b) `?ref=` actually consumed by the registration handler.
 *      Fuzzy-matching the free-text brand_name would be a silent $49 misattribution
 *      on a money path, so this branch resolves nothing rather than guessing.
 *   2. first_touch_tag — the EARLIEST creator to tag the brand, by videos.created_at.
 *   3. otherwise NOTHING is minted. We do not guess.
 *
 * FIRST-TOUCH IS *OUR* RULE, NOT THE CLIENT'S. It is a business call, made because
 * referral attribution is not resolvable today, and it is ADMIN-OVERRIDABLE: an
 * admin corrects a wrong attribution by appending an `admin_revoke` on the wrong
 * creator and an `admin_grant` (attribution_method = 'admin_override') on the right
 * one. The original row is never edited — this ledger is append-only.
 *
 * Ordering is a TOTAL order — (taggedAt ASC NULLS LAST, videoId ASC, brandId ASC) —
 * so the outcome is deterministic and reproducible. An exact-timestamp tie between
 * two candidates resolves by video id rather than minting nothing; a coincidence of
 * timestamps should not cost a legitimate creator their reward, and the one-token
 * cap holds either way.
 */
export function resolveBrandConversionAttribution(args: {
  subscriberUserId: string;
  candidates: readonly BrandTagCandidate[];
}): Attribution | null {
  const { subscriberUserId, candidates } = args;

  // SELF-MINT GUARD. A user can create a brand (brands.ownerId = their own id),
  // tag it in their own video, and subscribe — minting themselves $49. Drop any
  // candidate whose tagging creator is the subscriber.
  const eligible = candidates.filter((c) => c.creatorId !== subscriberUserId);
  if (eligible.length === 0) return null;

  // Referral branch, first in priority and empty in practice (see doc above).
  const referred = eligible.filter((c) => !!c.brandReferralId);
  const pool = referred.length > 0 ? referred : eligible;
  const method: AttributionMethod = referred.length > 0 ? "brand_referral" : "first_touch_tag";

  const winner = [...pool].sort(compareCandidates)[0];

  return {
    brandId: winner.brandId,
    creatorId: winner.creatorId,
    videoId: winner.videoId,
    method,
    brandReferralId: winner.brandReferralId ?? null,
  };
}

/** (taggedAt ASC NULLS LAST, videoId ASC, brandId ASC) — a total order. */
function compareCandidates(a: BrandTagCandidate, b: BrandTagCandidate): number {
  const at = a.taggedAt ? a.taggedAt.getTime() : Number.POSITIVE_INFINITY;
  const bt = b.taggedAt ? b.taggedAt.getTime() : Number.POSITIVE_INFINITY;
  if (at !== bt) return at - bt;
  if (a.videoId !== b.videoId) return a.videoId < b.videoId ? -1 : 1;
  if (a.brandId !== b.brandId) return a.brandId < b.brandId ? -1 : 1;
  return 0;
}

/** Storage surface the mint needs. `storage` satisfies this structurally. */
export interface MintStore extends WalletTxRunner {
  /** Brands owned by the subscriber. MUST NOT filter on isActive. */
  getBrandsByOwnerId(ownerId: string): Promise<Array<{ id: string; ownerId: string | null }>>;
  /** The earliest creator to tag `brandId`, by videos.created_at. One indexed query. */
  getEarliestTaggingCreatorForBrand(
    brandId: string,
  ): Promise<{ creatorId: string; videoId: string; taggedAt: Date | null } | undefined>;
}

export interface MintArgs {
  /** The account that just paid. brand_subscriptions.userId. */
  subscriberUserId: string;
  plan: unknown;
  /**
   * invoice.amount_paid, in cents. Must cover the plan's FULL list price — see
   * the `underpaid` guard in mintBrandConversionToken.
   */
  amountPaidCents: number;
  stripeSubscriptionId?: string | null;
}

export type MintSkipReason =
  | "plan_not_qualifying"
  | "no_payment"
  | "underpaid"
  | "no_owned_brand"
  | "no_attribution"
  | "already_minted";

export type MintResult =
  | { minted: true; entry: TokenLedgerEntry; attribution: Attribution }
  | { minted: false; reason: MintSkipReason };

/**
 * Mint the ONE token a qualifying brand conversion earns, if it is earnable.
 *
 * Every guard below can be wrong without costing money, because the two partial
 * UNIQUE indexes are the actual guarantee — the guards just avoid pointless work
 * and produce a legible skip reason. That inversion is why this is safe to call
 * from `invoice.payment_succeeded`, which fires again on EVERY monthly renewal:
 * renewal #2 through #N hit the index and no-op.
 *
 * Qualification requires ALL of:
 *   - plan ∈ TOKEN_QUALIFYING_PLANS  (the $249 Brand tier)
 *   - amountPaidCents > 0            (real money moved; not a trial)
 *   - amountPaidCents >= the plan's FULL list price (see below)
 *   - the subscriber OWNS at least one brand
 *   - an attributable creator who is NOT the subscriber
 *
 * ── WHY THE FULL PRICE, NOT JUST "> 0" ──────────────────────────────────────
 * A token is $49 of platform credit funded out of a $249 subscription. Gating on
 * "any money at all" funds it out of ANY invoice on a qualifying plan, and two
 * ordinary Stripe behaviours make that cheap:
 *
 *   1. PRORATION. A mid-cycle plan change emits a real, paid invoice for a few
 *      dollars. Under `> 0` a $2 proration on a 'starter' subscription mints a
 *      full $49 token.
 *   2. AN UNRESOLVED PLAN. planFromSubscription() (server/webhookHandlers.ts)
 *      falls back to DEFAULT_PLAN = 'starter' when a price carries no
 *      `metadata.plan` and no matching amount — and 'starter' is the ONLY
 *      token-qualifying plan. So a subscription created straight in the Stripe
 *      dashboard on a custom $10/mo price resolves to 'starter' and, under `> 0`,
 *      mints $49 on its first $10 invoice.
 *
 * Requiring the plan's own list price closes both without depending on the
 * fallback being fixed: the amount is Stripe's own `invoice.amount_paid`, so a
 * $10 invoice cannot pass a $249 gate no matter what tier it is labelled.
 *
 * Ownership is checked rather than users.role, because role is self-selected at
 * registration and is not a trustworthy signal; brands.ownerId is both trustworthy
 * and already the anchor of the attribution walk.
 */
export async function mintBrandConversionToken(
  store: MintStore,
  args: MintArgs,
): Promise<MintResult> {
  const { subscriberUserId, plan, amountPaidCents } = args;

  if (!planQualifiesForTokenMint(plan)) return { minted: false, reason: "plan_not_qualifying" };
  if (!(amountPaidCents > 0)) return { minted: false, reason: "no_payment" };
  // The plan's OWN list price — 24900 for 'starter' today. Derived from
  // PLAN_CONFIG rather than inlined so a repriced tier moves the gate with it.
  const requiredCents = PLAN_CONFIG[plan].amount;
  if (amountPaidCents < requiredCents) return { minted: false, reason: "underpaid" };

  const ownedBrands = await store.getBrandsByOwnerId(subscriberUserId);
  if (ownedBrands.length === 0) return { minted: false, reason: "no_owned_brand" };

  // Build one candidate per owned brand that anyone has tagged. Resolving to a
  // SINGLE candidate here is what stops a subscriber who owns three brands from
  // minting 3 x $49 against one $249 subscription.
  const candidates: BrandTagCandidate[] = [];
  for (const brand of ownedBrands) {
    const tag = await store.getEarliestTaggingCreatorForBrand(brand.id);
    if (!tag) continue;
    candidates.push({
      brandId: brand.id,
      creatorId: tag.creatorId,
      videoId: tag.videoId,
      taggedAt: tag.taggedAt,
      brandReferralId: null,
    });
  }

  const attribution = resolveBrandConversionAttribution({ subscriberUserId, candidates });
  if (!attribution) return { minted: false, reason: "no_attribution" };

  try {
    const entry = await store.runWalletTransaction(async (tx) => {
      await tx.lockUser(attribution.creatorId);
      return tx.insertEntry({
        userId: attribution.creatorId,
        deltaTokens: 1,
        reason: "brand_conversion",
        // Invariant 5 — $49 as of this mint, frozen onto the row.
        usdValueCents: TOKEN_USD_CENTS,
        sourceBrandId: attribution.brandId,
        sourceSubscriptionUserId: subscriberUserId,
        stripeSubscriptionId: args.stripeSubscriptionId ?? null,
        attributionMethod: attribution.method,
        attributedVideoId: attribution.videoId,
        brandReferralId: attribution.brandReferralId,
        description: "Brand conversion reward — tagged brand completed a paid subscription",
      });
    });
    return { minted: true, entry, attribution };
  } catch (err) {
    // INVARIANT 3, enforced. Either this brand or this subscriber already minted.
    if (isUniqueViolation(err)) return { minted: false, reason: "already_minted" };
    throw err;
  }
}
