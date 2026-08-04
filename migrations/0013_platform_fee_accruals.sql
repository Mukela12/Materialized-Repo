-- ============================================================================
-- 0013 — Store the marketplace fee, so it can be invoiced
--
-- WHY THIS EXISTS
--   The platform's 15% marketplace fee was computed on every verified store
--   order and then thrown away. computeSaleSplit() returned marketplaceFeeCents
--   and platformCents, recordSaleCommissions() put them in its return value, and
--   the webhook route echoed them in the HTTP response — and that was the end of
--   them. Only the creator and publisher COMMISSIONS were persisted, i.e. only
--   the money going OUT. Nothing recorded the money coming in.
--
--   So the platform had no record of what any brand owed it. Not a reporting
--   inconvenience: there was no row anywhere to invoice from, and an audit of
--   all 38 tables found no fee or revenue table of any kind.
--
--   Worse, orders that could not be attributed returned early and wrote nothing
--   at all — no trace that the sale had even happened. A sale carrying a
--   Materialized ref that failed to resolve (deleted video, stale link) was
--   indistinguishable from a sale that never involved Materialized. That is
--   silent revenue leakage with nothing to reconcile against.
--
-- WHAT THIS DOES NOT DO
--   It does not move money. Stripe cannot automatically take a cut of a charge
--   made on the brand's own store and own Stripe account — the platform is not
--   in that payment path, so there is no application fee to collect. This table
--   is the honest alternative: a durable record of what is owed, which a human
--   or a later job can invoice. Read it as an accounts-receivable ledger.
--
-- ATTRIBUTION STATE, AND WHY UNATTRIBUTED ORDERS ARE STILL RECORDED
--   Every verified order gets a row. Only `attributed` rows carry a fee; the
--   rest carry zero. The point of storing the others is visibility: `ref_
--   unresolved` and `video_missing` mean a Materialized link DID drive the sale
--   but the trail broke, which is money that should have been earned. Those are
--   findable now instead of vanishing.
--
-- THE RATE IS CAPTURED PER ROW
--   marketplace_fee_pct is stored, not looked up at invoice time, for the same
--   reason commission_transactions stores its own rate: changing the platform
--   default must never silently rewrite what a brand already owes. See the note
--   in server/feeConfig.ts — "historical rows are unaffected".
--
-- SCALE
--   Checked against production before writing: 0 rows in commission_transactions
--   and no store connections, so this table starts empty and plain CREATE INDEX
--   is correct. server/migrate.ts wraps each migration in a transaction, so
--   CONCURRENTLY could not be used here anyway.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE fee_accrual_status AS ENUM ('accrued', 'invoiced', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE fee_attribution_state AS ENUM ('attributed', 'no_ref', 'ref_unresolved', 'video_missing');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS platform_fee_accruals (
  id                    VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Who owes it. brand_user_id is denormalised from the store connection on
  -- purpose: an invoice must survive the connection being deleted or re-pointed.
  store_connection_id   VARCHAR NOT NULL REFERENCES store_connections(id),
  brand_user_id         VARCHAR NOT NULL REFERENCES users(id),

  external_order_id     TEXT NOT NULL,
  video_id              VARCHAR REFERENCES videos(id),

  currency              TEXT NOT NULL,
  sale_cents            INTEGER NOT NULL,
  marketplace_fee_cents INTEGER NOT NULL DEFAULT 0,
  creator_cents         INTEGER NOT NULL DEFAULT 0,
  publisher_cents       INTEGER NOT NULL DEFAULT 0,
  -- What the platform actually keeps: the fee less the commissions paid out of
  -- it. This is the invoiceable margin.
  platform_cents        INTEGER NOT NULL DEFAULT 0,
  marketplace_fee_pct   DECIMAL(5,2) NOT NULL DEFAULT 0,

  attribution_state     fee_attribution_state NOT NULL,
  status                fee_accrual_status NOT NULL DEFAULT 'accrued',

  stripe_invoice_id     TEXT,
  invoiced_at           TIMESTAMP,
  -- Set when the order is refunded. A voided row must never be invoiced, and if
  -- it was already invoiced it needs crediting — hence a timestamp, not a delete.
  voided_at             TIMESTAMP,

  occurred_at           TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Idempotency. Stores retry webhooks, and the existing order-level guard checks
-- commission_transactions — which has no row at all for an unattributed order,
-- so it cannot protect this table. Scoped per connection because order ids
-- collide across stores (same reasoning as 0007).
CREATE UNIQUE INDEX IF NOT EXISTS platform_fee_accrual_order_uniq
  ON platform_fee_accruals (store_connection_id, external_order_id);

-- The invoicing query: one brand, one period, everything not yet invoiced.
CREATE INDEX IF NOT EXISTS platform_fee_accrual_brand_period_idx
  ON platform_fee_accruals (brand_user_id, status, occurred_at);

-- Finding the leaks: unattributed rows worth chasing.
CREATE INDEX IF NOT EXISTS platform_fee_accrual_attribution_idx
  ON platform_fee_accruals (attribution_state, occurred_at);
