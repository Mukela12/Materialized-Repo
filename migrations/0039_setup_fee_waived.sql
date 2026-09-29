-- A waive_setup_fee voucher now waives the setup fee (server/setupFee.ts).
--
-- Registration read the voucher's grant into voucherGrants.waiveSetupFee and
-- then never used it: nothing set any flag, so every holder of a "waive setup
-- fee" code (the Brooklyn brand codes, the organizer seat, Yuul Yie) still
-- owed the $29 when their trial ended. Kept apart from setup_fee_paid so
-- "paid" still means money was received.
ALTER TABLE users ADD COLUMN IF NOT EXISTS setup_fee_waived boolean NOT NULL DEFAULT false;

-- Everyone who already redeemed such a code gets what it promised.
UPDATE users u
   SET setup_fee_waived = true
  FROM voucher_redemptions r
  JOIN vouchers v ON v.id = r.voucher_id
 WHERE r.user_id = u.id
   AND v.grant_type = 'waive_setup_fee'
   AND u.setup_fee_waived = false;
