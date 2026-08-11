-- ============================================================================
-- 0024 — The creator's 5% share of a subscription they brought in
--
-- THE CLIENT: "Can we determine the 5% Bonus for Creators when their tagged
-- brands subscribe? This payout will need to be issued from MTRLZD Stripe of
-- course, separate to the Brand's independent affiliate program and payouts
-- agenda."
--
-- NOT THE SAME AS THE EXISTING REWARD
--   server/wallet.ts already mints ONE $49 wallet token when a tagged brand
--   first pays. That is a token, it is not withdrawable, and it fires once per
--   brand. This is cash, it recurs on every paid invoice, and it is transferred
--   over Connect by the same engine that pays sale commissions. Whether both
--   should exist is a commercial question, raised with the client rather than
--   decided here.
--
-- WHY NOT commission_transactions
--   That table is sale-shaped: video_id is NOT NULL and it hangs off a product,
--   an analytics event and a store order. A subscription payment has none of
--   those, so a row would need a fabricated video_id — and every sales report
--   that counts commission rows would start counting subscriptions as sales.
--
-- THE UNIQUE INDEX IS THE IDEMPOTENCY
--   Stripe delivers invoice.payment_succeeded more than once: on retry after a
--   timeout, and again whenever someone replays the event from the dashboard.
--   A code-level "have I already recorded this?" loses the race when two
--   deliveries arrive together — both read nothing, both insert, the creator is
--   paid twice. (stripe_invoice_id, creator_id) makes the second insert fail,
--   which the caller treats as "already recorded". Under-paying is recoverable;
--   double-paying is not.
--
-- STATUS DEFAULTS TO 'approved'
--   A sale commission waits for approval because a physical order can be
--   cancelled before it ships. A Stripe invoice that reports amount_paid has
--   already cleared, so there is nothing to wait for. Refunds and chargebacks
--   move the row to 'reversed' instead, which is what the clawback path does.
-- ============================================================================

CREATE TABLE IF NOT EXISTS creator_bonuses (
  id                     VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id             VARCHAR NOT NULL REFERENCES users(id),
  brand_id               VARCHAR NOT NULL REFERENCES brands(id),
  subscriber_user_id     VARCHAR NOT NULL REFERENCES users(id),
  stripe_invoice_id      TEXT NOT NULL,
  stripe_subscription_id TEXT,
  basis_cents            INTEGER NOT NULL,
  rate_pct               NUMERIC(5,2) NOT NULL,
  amount_cents           INTEGER NOT NULL,
  status                 commission_status DEFAULT 'approved',
  payout_id              VARCHAR REFERENCES affiliate_payouts(id),
  attributed_video_id    VARCHAR REFERENCES videos(id),
  attribution_method     TEXT,
  created_at             TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- The idempotency guarantee. See the note above.
CREATE UNIQUE INDEX IF NOT EXISTS creator_bonus_invoice_creator_uniq
  ON creator_bonuses (stripe_invoice_id, creator_id);

-- The payout engine reads by creator and status on every run.
CREATE INDEX IF NOT EXISTS creator_bonus_creator_status_idx
  ON creator_bonuses (creator_id, status);
