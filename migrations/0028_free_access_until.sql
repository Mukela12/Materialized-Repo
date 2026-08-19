-- The free period has to END.
--
-- freeAccess was a permanent boolean: a voucher set it true and nothing ever
-- set it back. The expiry dates on the vouchers govern when a code may be
-- REDEEMED, not how long the access it grants lasts — so a Brooklyn code
-- redeemed on 30 October produced an account that was free forever.
--
-- The client's intent is a subscription-free period that ends on a fixed date,
-- after which the account converts to the monthly fee. This column carries that
-- date. NULL keeps the old meaning — free with no end — which is what a manual
-- grant from the admin Users tab still means.
--
-- Additive and nullable, so the running code that predates it is unaffected.
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_access_until timestamp;

COMMENT ON COLUMN users.free_access_until IS
  'When free access lapses. NULL = never (manual comp). Set from the voucher''s expiry at redemption.';
