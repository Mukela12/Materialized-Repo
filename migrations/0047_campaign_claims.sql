-- Campaign landing pages that hand out Creator Passes (27 Oct 2026). The first
-- is Paris Creator Week: a creator claims two passes, one for themselves and
-- one for a friend, both real single-use vouchers. One claim per email per
-- campaign; the request id lets a double-tapped submit return the same claim.
CREATE TABLE IF NOT EXISTS campaign_claims (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign text NOT NULL,
  first_name text NOT NULL,
  email text NOT NULL,
  platform text NOT NULL CHECK (platform IN ('instagram', 'tiktok')),
  creator_handle text NOT NULL,
  friend_handle text NOT NULL,
  request_id text,
  creator_voucher_id varchar NOT NULL REFERENCES vouchers(id),
  friend_voucher_id varchar NOT NULL REFERENCES vouchers(id),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign, email),
  CHECK (creator_voucher_id <> friend_voucher_id)
);
