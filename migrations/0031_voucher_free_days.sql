-- A free period measured from signup, not ending on a calendar date.
--
-- freeAccessUntil has so far been copied from the voucher's expiry, which fits
-- the festival batches: everyone converts on 31 October regardless of when they
-- redeemed. The influencer campaign is the other shape — "30 days subscription
-- free when they create the account" — a rolling window per person, while the
-- CODE stays redeemable until 31 October.
--
-- NULL means the old behaviour exactly: the free period ends when the voucher
-- expires. Every existing voucher keeps its meaning.
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS free_days integer;

COMMENT ON COLUMN vouchers.free_days IS
  'Free period length in days from redemption. NULL = free until the voucher''s own expiry (the festival behaviour).';
