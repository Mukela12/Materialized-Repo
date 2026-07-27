-- 0009  USD pricing migration
-- Client decision (27 Jul): Stripe settles in USD; all pricing is USD by default.
--   * Global Video Library listing fee 45.00 -> 49.00
--   * brand_billing_records.currency default EUR -> USD (rows were being stamped
--     EUR while Stripe actually charged USD, so the UI rendered "€" beside a USD
--     charge — see brand-settings-transactions.tsx / brand-settings-billing-history.tsx)
--
-- DEFAULTS ONLY. This file deliberately contains no UPDATE statements: the runner
-- is additive/forward-only and repricing or relabelling EXISTING rows is a business
-- decision, not a schema one. See the backfill note at the bottom.
--
-- Idempotent: SET DEFAULT is safe to re-run.

ALTER TABLE global_video_library
  ALTER COLUMN license_fee SET DEFAULT '49.00';

ALTER TABLE brand_billing_records
  ALTER COLUMN currency SET DEFAULT 'USD';

-- ─────────────────────────────────────────────────────────────────────────────
-- NOT RUN HERE — pending an explicit client call. Existing rows keep their old
-- values, which means an already-listed video still charges its stored 45.00 on
-- the individual-license path while playlist curation charges 49.00 per video.
-- Once the client confirms whether old listings are grandfathered, run ONE of:
--
--   -- (a) reprice every listing still on the old default
--   UPDATE global_video_library SET license_fee = '49.00' WHERE license_fee = '45.00';
--
--   -- (b) relabel historical billing rows that were stamped EUR but charged USD
--   UPDATE brand_billing_records SET currency = 'USD' WHERE currency = 'EUR';
--
-- as a reviewed one-off, or add them as migration 0010.
-- ─────────────────────────────────────────────────────────────────────────────
