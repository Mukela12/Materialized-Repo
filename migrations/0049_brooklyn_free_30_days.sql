-- Brooklyn codes: 100% free for 30 days from sign-up (client, 26 Oct 2026).
--
-- "Brooklyn should have all been 100% free brand/publishers/creators" and
-- "30 days from the day they signup using their voucher codes". 100 of them
-- only waived the setup fee, so a brand or creator who signed up met a fee,
-- and all of them were free only until a fixed date. Now every one gives free
-- access for 30 days from its own sign-up; 28 Nov stays the last day a code
-- can be used. Codes already used are left exactly as they were (none had
-- been, when this was written). The brand codes keep their 10 creator passes.
UPDATE vouchers
SET grant_type = 'free_access', free_days = 30
WHERE label IN ('GTM — Brooklyn FW', 'GTM — Brooklyn Seats', 'GTM — Brooklyn Seats Media')
  AND revoked_at IS NULL
  AND NOT EXISTS (SELECT 1 FROM voucher_redemptions r WHERE r.voucher_id = vouchers.id);
