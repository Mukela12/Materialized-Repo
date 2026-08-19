-- The $29 admin setup fee, as its own thing.
--
-- The fee existed only as a line item inside a subscription checkout, so anyone
-- who never subscribed never paid it. That is precisely the voucher holders:
-- their whole offer is "no subscription until the date", and the client's rule
-- is that only Creators get an entirely free account — Brands and Publishers
-- always owe the one-time fee.
--
-- BACKFILLED TRUE for everyone who already exists. Entitlement is about to
-- depend on this column, and defaulting the existing accounts to false would
-- lock out every current user — including the client's own — the moment this
-- deploys.
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_fee_paid boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_fee_paid_at timestamp;

UPDATE users SET setup_fee_paid = true WHERE setup_fee_paid = false;

COMMENT ON COLUMN users.setup_fee_paid IS
  'One-time admin setup fee settled. Creators never owe it; Brands and Publishers always do.';
