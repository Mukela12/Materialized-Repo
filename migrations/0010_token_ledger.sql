-- 0010  Token wallet — append-only ledger
--
-- Client spec (Rapunzel, confirmed in writing 27 Jul 2026):
--   "1 Token = $49"
--   "Tokens are not cash-currency but can be used in Wallet for in-app purchases
--    or subsidized for monthly subscription fee"
--   "The Wallet system can therefore generate Tokens to reward Creators for
--    tagging a Brand who completes a $249 monthly subscription"
--
-- TOKENS ARE NEVER CASHABLE. Nothing in this table is reachable from
-- affiliate_payouts, commission_transactions, or any Stripe transfer/payout.
-- See the module doc at the top of server/wallet.ts.
--
-- Runs INSIDE the runner's wrapping transaction (no `-- migrate:no-transaction`
-- marker): there is no `ALTER TYPE ... ADD VALUE` here, so every statement is
-- transaction-safe. Additive and idempotent throughout — re-running is a no-op.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Reason enum.
--    `CREATE TYPE` has no IF NOT EXISTS, so it is wrapped in the house
--    DO/EXCEPTION guard (same shape used for enum creation elsewhere).
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  CREATE TYPE token_ledger_reason AS ENUM (
    'brand_conversion',
    'admin_grant',
    'spend_refund',
    'spend_library_listing',
    'spend_playlist',
    'spend_subscription_credit',
    'admin_revoke'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The ledger.
--    ONE ROW PER EVENT. delta_tokens is SIGNED (+N earned / -N spent) and the
--    balance is always SUM(delta_tokens) — there is deliberately no mutable
--    balance column on `users`, because a read-modify-write counter loses
--    updates under concurrency.
--
--    usd_value_cents is the value of ONE token at the instant the row was
--    written (4900 today). A future change to the token price therefore never
--    rewrites history; a row's total USD value is ABS(delta_tokens) * this.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS token_ledger (
  id                          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                     varchar NOT NULL REFERENCES users(id),
  delta_tokens                integer NOT NULL,
  reason                      token_ledger_reason NOT NULL,
  usd_value_cents             integer NOT NULL,

  -- mint provenance (brand_conversion rows only)
  source_brand_id             varchar REFERENCES brands(id),
  source_subscription_user_id varchar REFERENCES users(id),
  stripe_subscription_id      text,
  attribution_method          text,
  attributed_video_id         varchar REFERENCES videos(id),
  brand_referral_id           varchar REFERENCES brand_referrals(id),

  -- spend provenance
  spend_ref_type              text,
  spend_ref_id                text,
  stripe_balance_txn_id       text,

  description                 text,
  admin_note                  text,
  created_at                  timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- A zero-delta row is a no-op event and would only ever be a bug.
  CONSTRAINT token_ledger_delta_nonzero CHECK (delta_tokens <> 0),
  -- Value is captured per row; a non-positive unit value is nonsense.
  CONSTRAINT token_ledger_value_positive CHECK (usd_value_cents > 0)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. THE constraint. Exactly one token per brand conversion, enforced by the
--    DATABASE, not by application logic — webhooks retry, and Stripe replays.
--
--    Keyed on source_brand_id ALONE, on purpose. video_brands is many-to-many, so
--    five creators can tag the same brand; keying on (source_brand_id, user_id)
--    would allow one row per creator and mint 5 x $49 = $245 of credit against a
--    single $249 subscription. Keying on the brand alone makes that impossible.
--
--    Deliberately NOT scoped by stripe_subscription_id: the spec rewards the
--    brand's FIRST qualifying subscription, so cancel-then-resubscribe must not
--    mint a second token.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS token_ledger_brand_conversion_uniq
  ON token_ledger (source_brand_id)
  WHERE reason = 'brand_conversion' AND source_brand_id IS NOT NULL;

-- Same guarantee from the other direction. brands.owner_id is NOT unique, so one
-- subscriber may own several brands; this caps the whole subscribing ACCOUNT at
-- one minted token, so even a resolver bug cannot mint twice for one subscription.
CREATE UNIQUE INDEX IF NOT EXISTS token_ledger_subscriber_conversion_uniq
  ON token_ledger (source_subscription_user_id)
  WHERE reason = 'brand_conversion' AND source_subscription_user_id IS NOT NULL;

-- Spend idempotency: one debit per thing bought. A retried client request for the
-- same listing / playlist / subsidy key trips this and is reported as a duplicate
-- instead of debiting the wallet twice.
CREATE UNIQUE INDEX IF NOT EXISTS token_ledger_spend_ref_uniq
  ON token_ledger (spend_ref_type, spend_ref_id)
  WHERE spend_ref_id IS NOT NULL;

-- A Stripe customer-balance transaction may back at most one ledger row.
CREATE UNIQUE INDEX IF NOT EXISTS token_ledger_stripe_balance_txn_uniq
  ON token_ledger (stripe_balance_txn_id)
  WHERE stripe_balance_txn_id IS NOT NULL;

-- Balance is SUM(delta_tokens) over a single user's rows; index the hot path.
CREATE INDEX IF NOT EXISTS token_ledger_user_idx
  ON token_ledger (user_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. First-touch attribution walks brand -> videos, which is the REVERSE of the
--    only direction video_brands is queried today. Without this index that walk
--    is a sequential scan on every qualifying subscription webhook.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS video_brands_brand_id_idx
  ON video_brands (brand_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- NOT DONE HERE, and deliberately so:
--
--   * No `users.token_balance` column. The balance is derived, always. See the
--    invariant note in shared/schema.ts.
--
--   * No `brand_referrals.brand_id`. Referral-based attribution cannot be
--     evaluated today — brand_referrals has no FK to brands, and its signup_token
--     is written into the invite URL but never consumed at registration, so there
--     is no deterministic referral -> brand link to key off. Adding the column
--     without also consuming `?ref=` at registration would create a column that is
--     NULL forever and read as though it meant something. server/wallet.ts leaves
--     'brand_referral' as an explicit unimplemented branch naming both prerequisites.
--
--   * No DROP of creator_rewards. It is superseded (and provably empty — nothing
--     ever wrote to it), but this runner is additive-only. Its last writers have
--     been removed from the application instead.
-- ─────────────────────────────────────────────────────────────────────────────
