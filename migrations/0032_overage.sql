-- Metered overage: allowances per plan, and the charges computed from them.
--
-- The old overage sliders were removed because they let the client set their
-- own bill (see the note above /api/creator/subscription/portal). This is the
-- server-side replacement that note promised: usage is measured from recorded
-- events, priced from rates held HERE, and attached to the subscription's own
-- invoice — nothing the browser sends can influence an amount.

-- What each plan includes, and what extras cost. One row per plan key.
-- A NULL allowance means that meter is unlimited; billing_enabled false means
-- overage is RECORDED but never billed — the dry-run the first month runs in,
-- so the client reviews real numbers before any card is touched.
CREATE TABLE IF NOT EXISTS plan_allowances (
  plan text PRIMARY KEY,
  included_videos integer,
  included_views integer,
  overage_per_video_cents integer,
  overage_per_1000_views_cents integer,
  billing_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per subscriber per billing month. The unique pair is the idempotency
-- claim: a re-run of the job cannot double-bill a month, same mechanism as
-- fee_invoices.
CREATE TABLE IF NOT EXISTS overage_charges (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  plan text NOT NULL,
  period_start timestamp NOT NULL,
  period_end timestamp NOT NULL,
  videos_used integer NOT NULL,
  views_used integer NOT NULL,
  included_videos integer,
  included_views integer,
  video_overage_cents integer NOT NULL DEFAULT 0,
  view_overage_cents integer NOT NULL DEFAULT 0,
  total_cents integer NOT NULL,
  currency text NOT NULL,
  -- recorded: computed, visible in admin, no money moved (billing off or dry run)
  -- billed:   a Stripe invoice item exists; it rides the next subscription invoice
  -- failed:   Stripe refused; error carries why; a human resolves
  status text NOT NULL DEFAULT 'recorded',
  stripe_invoice_item_id text,
  error text,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT overage_once_per_period UNIQUE (user_id, period_start)
);
