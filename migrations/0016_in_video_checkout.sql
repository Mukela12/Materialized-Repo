-- ============================================================================
-- 0016 — Checkout inside the video
--
-- WHY THIS EXISTS
--   The 15% marketplace fee could not be *retained* from a sale, only invoiced
--   afterwards, because MTRLZD was not in the payment path: the brand's own
--   checkout took the shopper's money and we heard about it later via webhook.
--
--   Stripe can split a payment automatically — an application fee on a
--   destination charge — but only for a charge the PLATFORM creates. So the
--   shopper has to pay through us. This migration is the storage behind doing
--   that from the video overlay itself.
--
-- THE PRICE HAD TO BECOME A NUMBER
--   video_product_overlays.price is free TEXT ("$49", "49.00", "from £20"). It
--   is fine as a label and unusable as an amount — you cannot charge a card from
--   a string somebody typed. price_cents is the authoritative figure and is the
--   ONLY thing the checkout endpoint reads. The client never supplies a price:
--   a shopper who can name their own amount is a shopper who pays 1 cent.
--
-- WHY A SEPARATE ORDERS TABLE
--   commission_transactions records what people EARN from a sale. It has no
--   place to put the shopper's payment itself — the charge, the fee we kept, the
--   Stripe session. video_orders is that record, and it is what a refund or a
--   dispute is reconciled against.
--
-- CHARGES ENABLED IS NOT THE SAME AS ONBOARDED
--   Connect accounts here were created for PAYOUTS and request only the
--   `transfers` capability. An account that can receive a transfer cannot
--   necessarily accept a card payment. Selling through a brand's account needs
--   `card_payments`, which is a separate capability with separate verification —
--   hence its own column rather than reusing stripe_connect_onboarded, which
--   would have let a brand appear ready to sell when Stripe would reject the
--   charge.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE video_order_status AS ENUM ('pending', 'paid', 'failed', 'refunded');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── The product must carry a real amount ────────────────────────────────────
ALTER TABLE video_product_overlays
  ADD COLUMN IF NOT EXISTS price_cents INTEGER,
  ADD COLUMN IF NOT EXISTS currency TEXT;

-- ── A brand's ability to ACCEPT payments, distinct from receiving payouts ────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_connect_charges_enabled BOOLEAN NOT NULL DEFAULT FALSE;

-- ── The shopper's order ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS video_orders (
  id                        VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),

  video_id                  VARCHAR NOT NULL REFERENCES videos(id),
  overlay_id                INTEGER REFERENCES video_product_overlays(id),
  -- Who is being paid, and who gets attributed. Denormalised so an order stays
  -- readable after a video or overlay is edited.
  brand_user_id             VARCHAR NOT NULL REFERENCES users(id),
  creator_id                VARCHAR REFERENCES users(id),
  affiliate_id              VARCHAR REFERENCES users(id),
  /** The utm/ref carried from the embed click, kept for reconciliation. */
  attribution_ref           TEXT,

  stripe_checkout_session_id TEXT NOT NULL,
  stripe_payment_intent_id  TEXT,

  currency                  TEXT NOT NULL,
  amount_cents              INTEGER NOT NULL,
  /** What Stripe withheld for us at the moment of the charge. */
  application_fee_cents     INTEGER NOT NULL DEFAULT 0,

  status                    video_order_status NOT NULL DEFAULT 'pending',
  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at                   TIMESTAMP,
  refunded_at               TIMESTAMP
);

-- Idempotency. Stripe retries webhooks, and a checkout.session.completed
-- delivered twice must not produce two orders or two sets of commissions.
CREATE UNIQUE INDEX IF NOT EXISTS video_order_session_uniq
  ON video_orders (stripe_checkout_session_id);

CREATE INDEX IF NOT EXISTS video_order_brand_idx ON video_orders (brand_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS video_order_video_idx ON video_orders (video_id, created_at DESC);
