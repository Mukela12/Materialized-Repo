-- 0005  PR #21 admin-money-ops  (commit b723ef8)
-- Stripe invoice id + cached hosted invoice URL on brand billing records.
-- Idempotent: safe to re-run against prod where this DDL is already applied.

ALTER TABLE brand_billing_records
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text;

ALTER TABLE brand_billing_records
  ADD COLUMN IF NOT EXISTS hosted_invoice_url text;
