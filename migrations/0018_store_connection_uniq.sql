-- ============================================================================
-- 0018 — One live connection per store, and a way to find unbilled accruals
--
-- RISK 1: RECONNECTING A STORE BILLED THE BRAND TWICE
--   POST /api/integrations/{shopify,woocommerce}/connect did a bare INSERT with
--   no upsert, and store_connections had no unique key. Reconnecting the same
--   store minted a SECOND connection id with a SECOND webhook receiver URL, and
--   the registration helpers POST a new subscription without removing the old
--   one — so the old subscription stayed live at the old address.
--
--   Both then fired on every order. Every dedup in the system is scoped per
--   connection: hasCommissionForExternalOrder(orderId, connection.id) and the
--   unique index on (store_connection_id, external_order_id). So one order wrote
--   TWO attributed accruals, each carrying the full 15%, both 'accrued', both
--   for the same brand. The monthly run swept up both and billed 30%.
--
--   Deactivating rather than deleting: a superseded connection still owns its
--   historic accruals and commissions, and those must stay readable.
--
-- RISK 3: SKIPPED ACCRUALS WERE NEVER LOOKED AT AGAIN
--   The monthly job bills only the previous whole calendar month. Anything it
--   skipped — a brand with no Stripe customer, a Stripe outage, a released
--   claim — was never retried, because the next run's window has already moved
--   past it. The index below makes "everything still accrued, oldest first"
--   cheap enough to sweep, which is what the look-back now does.
-- ============================================================================

ALTER TABLE store_connections
  ADD COLUMN IF NOT EXISTS deactivated_at TIMESTAMP;

-- At most ONE live connection per (user, platform, domain). Partial, so
-- superseded rows can pile up harmlessly and keep their history.
CREATE UNIQUE INDEX IF NOT EXISTS store_connection_live_uniq
  ON store_connections (user_id, platform, store_domain)
  WHERE deactivated_at IS NULL;

-- Find long-unbilled accruals regardless of which month they fall in.
CREATE INDEX IF NOT EXISTS platform_fee_accrual_unbilled_idx
  ON platform_fee_accruals (occurred_at)
  WHERE status = 'accrued' AND marketplace_fee_cents > 0;
