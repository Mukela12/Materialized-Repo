-- 0003  PR #6 store-order-webhook  (commit 57aa0e2)
-- External store order id on commission rows + per-store webhook signing secret.
-- Idempotent: safe to re-run against prod where this DDL is already applied.

ALTER TABLE commission_transactions
  ADD COLUMN IF NOT EXISTS external_order_id text;

ALTER TABLE store_connections
  ADD COLUMN IF NOT EXISTS webhook_secret text;
