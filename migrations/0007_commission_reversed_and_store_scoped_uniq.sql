-- migrate:no-transaction
-- 0007  PR #23 billing-integrity  (commit 0f75e89)
--
-- Runs OUTSIDE a wrapping transaction because `ALTER TYPE ... ADD VALUE` cannot execute
-- inside a transaction block that also runs other DDL on PostgreSQL. The runner detects the
-- `-- migrate:no-transaction` marker on the first line and executes each statement below in
-- autocommit, in order. Every statement is individually idempotent, so a partial failure can
-- be re-run safely.
--
-- What this migration does:
--   1. Adds the 'reversed' value to the commission_status enum (for refund reversals).
--   2. Adds store_connection_id to commission_transactions (FK -> store_connections). Store
--      order ids are only unique WITHIN a store, so dedup must be scoped by store.
--   3. Rebuilds the dedup unique index as a 3-column index that includes store_connection_id,
--      replacing the 2-column index from 0006. DROP INDEX (of a redundant index) is
--      non-destructive to row data. Statement order matters twice: the new index references
--      store_connection_id, so the column (statement 2) must exist first; and — because this
--      file runs in autocommit — the new index is CREATEd BEFORE the old one is DROPped, so a
--      failure between the two leaves *a* unique index protecting the money table rather than none.

-- 1. Enum value. `IF NOT EXISTS` is REQUIRED — a bare ADD VALUE errors if the value exists.
ALTER TYPE commission_status ADD VALUE IF NOT EXISTS 'reversed';

-- 2. Store scope column. Inline REFERENCES rides on ADD COLUMN IF NOT EXISTS (no-ops on re-run).
ALTER TABLE commission_transactions
  ADD COLUMN IF NOT EXISTS store_connection_id varchar REFERENCES store_connections(id);

-- 3. Replace the 2-col index (0006) with the store-scoped 3-col index. CREATE the new index
--    FIRST, then DROP the old one: in autocommit these are separate transactions, so if the
--    CREATE fails the old 2-col unique index still guards the money table (never a window with
--    no dedup index). Both statements are idempotent, so a re-run after a partial failure converges.
CREATE UNIQUE INDEX IF NOT EXISTS commission_tx_ext_order_affiliate_store_uniq
  ON commission_transactions (external_order_id, affiliate_id, store_connection_id)
  WHERE external_order_id IS NOT NULL;

DROP INDEX IF EXISTS commission_tx_ext_order_affiliate_uniq;
