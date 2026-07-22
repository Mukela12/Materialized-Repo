-- 0006  PR #22 store-go-live  (commit b51f10e)
-- 2-column partial unique index guarding against duplicate commissions for the same
-- store order. This is SUPERSEDED by the 3-column index in 0007 (which drops this one
-- and rebuilds it scoped by store_connection_id). Kept as its own ordered file so a DB
-- that only ever received the 2-col index converges correctly through 0007.
--
-- Plain (non-CONCURRENTLY) CREATE so it runs inside this file's transaction; on a live
-- prod re-run the index already exists and IF NOT EXISTS no-ops. Idempotent.

CREATE UNIQUE INDEX IF NOT EXISTS commission_tx_ext_order_affiliate_uniq
  ON commission_transactions (external_order_id, affiliate_id)
  WHERE external_order_id IS NOT NULL;
