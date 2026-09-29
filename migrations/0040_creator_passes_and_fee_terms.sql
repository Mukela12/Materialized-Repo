-- Two requests from the client, 29 Sep 2026.
--
-- 1. "10 creator passes per brand from Brooklyn, with X creator passes
--    remaining." Each brand invitation mints a free creator pass, capped per
--    brand. The cap was one platform-wide number (INVITE_VOUCHER_CAP, 100). A
--    brand code can now carry its own number of passes, and a brand that signs
--    up with it gets that limit.
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS creator_passes integer;
ALTER TABLE brands ADD COLUMN IF NOT EXISTS invite_pass_limit integer;

-- Brooklyn's brand codes carry 10, as the client confirmed. Admins can change
-- any batch from the voucher admin (bulk action "Creator passes").
UPDATE vouchers
   SET creator_passes = 10
 WHERE role_restriction = 'brand'
   AND (label ILIKE '%brooklyn%' OR assigned_to ILIKE '%brooklyn%')
   AND creator_passes IS NULL;

-- Brands already signed up with such a code get the same limit.
UPDATE brands b
   SET invite_pass_limit = v.creator_passes
  FROM voucher_redemptions r
  JOIN vouchers v ON v.id = r.voucher_id
 WHERE r.user_id = b.owner_id
   AND v.creator_passes IS NOT NULL
   AND b.invite_pass_limit IS NULL;

-- 2. "The prompt to agree to 15% marketplace fee." When a brand agreed, and
--    to what rate.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS fee_terms_accepted_at timestamp,
  ADD COLUMN IF NOT EXISTS fee_terms_pct numeric(5,2);
