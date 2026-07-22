-- 0002  PR #5 payout-execution  (commit d93e97b)
-- Stripe transfer id on payouts + the payout_id FK linking a commission row to its payout.
-- The inline REFERENCES rides on ADD COLUMN IF NOT EXISTS, so a re-run no-ops the whole
-- clause (constraint included) once the column already exists. Idempotent.

ALTER TABLE affiliate_payouts
  ADD COLUMN IF NOT EXISTS stripe_transfer_id text;

ALTER TABLE commission_transactions
  ADD COLUMN IF NOT EXISTS payout_id varchar REFERENCES affiliate_payouts(id);
