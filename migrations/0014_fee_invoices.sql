-- ============================================================================
-- 0014 — Invoices raised against the marketplace-fee ledger
--
-- WHY A TABLE AND NOT JUST A STRIPE CALL
--   Invoicing is a two-system write: claim the accruals here, create the
--   invoice at Stripe. Whichever you do second, a crash in between leaves the
--   two disagreeing — and the two disagreements are not equally bad.
--
--     Stripe first, then claim  -> the invoice exists, the rows still look
--                                  unbilled, and the next run BILLS THE BRAND
--                                  AGAIN. Charging a customer twice.
--     Claim first, then Stripe  -> the rows look billed, no invoice exists.
--                                  Under-billing. Visible, and recoverable.
--
--   So the rows are claimed FIRST, into a row of this table, inside one
--   transaction holding an advisory lock on the brand. The claim is what makes
--   a second concurrent run find nothing to invoice.
--
--   This table is then the resume point. Its id is used as the Stripe
--   idempotency key, so retrying a half-finished run returns the SAME invoice
--   rather than making a second one. Beyond Stripe's 24h key retention the
--   retry falls back to searching Stripe by metadata for this id — see
--   server/feeInvoicing.ts.
--
-- STATUS
--   pending  — accruals claimed, Stripe not yet confirmed. Resumable.
--   created  — the Stripe invoice exists. stripe_invoice_id is set.
--   failed   — gave up; the accruals have been RELEASED back to 'accrued'.
--   void     — invoice cancelled; accruals released so they can be re-billed.
--
-- SCALE
--   Starts empty. Plain CREATE INDEX is correct, and server/migrate.ts wraps
--   each migration in a transaction so CONCURRENTLY could not be used anyway.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE fee_invoice_status AS ENUM ('pending', 'created', 'failed', 'void');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS fee_invoices (
  id                  VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_user_id       VARCHAR NOT NULL REFERENCES users(id),

  -- Grouped per currency: an invoice is denominated in one currency, and
  -- summing cents across currencies would be meaningless.
  currency            TEXT NOT NULL,
  period_start        TIMESTAMP NOT NULL,
  period_end          TIMESTAMP NOT NULL,

  -- What was claimed, captured at claim time. Kept even if rows are later
  -- released, so a failed run leaves evidence of what it tried to bill.
  subtotal_cents      INTEGER NOT NULL,
  line_count          INTEGER NOT NULL,

  status              fee_invoice_status NOT NULL DEFAULT 'pending',
  stripe_invoice_id   TEXT,
  hosted_invoice_url  TEXT,
  -- False while the invoice is a draft. A draft bills nobody until finalised,
  -- which is deliberately a separate, explicit step.
  finalized           BOOLEAN NOT NULL DEFAULT FALSE,
  error               TEXT,

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Which invoice a given accrual was claimed by. Nullable: an accrual that has
-- never been invoiced, or one released after a failure, has no invoice.
ALTER TABLE platform_fee_accruals
  ADD COLUMN IF NOT EXISTS fee_invoice_id VARCHAR REFERENCES fee_invoices(id);

CREATE INDEX IF NOT EXISTS platform_fee_accrual_invoice_idx
  ON platform_fee_accruals (fee_invoice_id);

CREATE INDEX IF NOT EXISTS fee_invoice_brand_idx
  ON fee_invoices (brand_user_id, created_at DESC);

-- Finding runs that died mid-flight and need resuming.
CREATE INDEX IF NOT EXISTS fee_invoice_pending_idx
  ON fee_invoices (status, created_at)
  WHERE status = 'pending';
