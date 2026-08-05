-- ============================================================================
-- 0017 — An in-video sale has no store connection
--
-- THE BUG
--   platform_fee_accruals.store_connection_id was NOT NULL REFERENCES
--   store_connections(id), written when the only sales we knew about arrived
--   through a brand's Shopify/Woo webhook. In-video checkout (0016) has no such
--   connection — the sale happens in our own player — and the handler passed the
--   VIDEO id into that column to satisfy NOT NULL.
--
--   A video id is not a store_connections id, so every in-video sale raised a
--   foreign-key violation (23503). recordFeeAccrual only swallows 23505, so it
--   re-threw; dispatchStripeEvent catches and logs, returning 200 to Stripe, so
--   nothing retried. The platform's revenue row was silently never written.
--
--   Worse, recordSaleCommissions runs FIRST, so the creator and publisher
--   commissions WERE written and will be paid out — against income the platform
--   had no record of. The money itself was never at risk: Stripe withholds the
--   application fee at the charge regardless of what we record.
--
--   It survived review because the unit test calls the pure builder with a fake
--   store, and MemStorage has no foreign keys. Only DatabaseStorage does.
--
-- THE FIX
--   Make the column nullable, because NULL is the truth: an in-video sale has no
--   store connection. The FK stays, so a non-null value must still be real.
--
-- DEDUP
--   The existing unique index is (store_connection_id, external_order_id), and
--   Postgres treats NULLs as distinct — so it stops deduping once the column is
--   NULL. The in-video path is already one-shot via markVideoOrderPaid, which
--   only flips a row that is still 'pending', so a Stripe retry returns before
--   reaching the accrual. The partial index below is belt and braces: it makes
--   the database enforce one accrual per checkout session for the in-video path
--   too, rather than relying on ordering alone.
-- ============================================================================

ALTER TABLE platform_fee_accruals
  ALTER COLUMN store_connection_id DROP NOT NULL;

-- One accrual per external order on the in-video path, where there is no store
-- connection to scope by.
CREATE UNIQUE INDEX IF NOT EXISTS platform_fee_accrual_no_store_order_uniq
  ON platform_fee_accruals (external_order_id)
  WHERE store_connection_id IS NULL;
