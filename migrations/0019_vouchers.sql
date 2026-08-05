-- ============================================================================
-- 0019 — Vouchers
--
-- WHAT EXISTED BEFORE
--   One string in an environment variable, compared with `===` at registration.
--   The same code for everyone, unlimited redemptions, no expiry, no record of
--   who used it, and the only way to revoke it was to rotate the variable —
--   which invalidates it for everyone at once. A wrong code was also silently
--   ignored: the account was created as normal and nothing told the user their
--   voucher had not worked.
--
--   It cannot express the offer it is needed for: 20 free creator accounts,
--   tied to the brand who earned them by subscribing, for a promotional period.
--
-- WHAT A VOUCHER HAS TO DO
--   Be unique, be capped, belong to a brand, expire, and be revocable — and
--   every redemption has to be recorded, because "how many of my 20 are left"
--   is a question the brand will ask.
--
-- THE CAP IS ENFORCED BY THE DATABASE, NOT BY COUNTING
--   Twenty creators handed the same code will not redeem politely one at a
--   time. Counting redemptions and then inserting is a read-modify-write, and
--   under concurrency it hands out 21, 22, 25. So redemption takes an advisory
--   lock on the voucher and re-counts INSIDE the transaction, and
--   (voucher_id, user_id) is unique so one person cannot redeem twice however
--   many times they submit the form.
--
-- EXPIRY IS EVALUATED AT READ TIME
--   `expires_at > now()`, checked when the code is used. No scheduler is
--   involved, matching how the brand inventory grant already works — a voucher
--   that has expired simply stops validating, whether or not any job ran.
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE voucher_grant AS ENUM (
    -- Permanent free access: no subscription needed, no upload caps.
    'free_access',
    -- Waives the $29 setup fee; the subscription itself is still paid.
    'waive_setup_fee'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS vouchers (
  id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stored uppercase and compared uppercase, so the person typing it does not
  -- have to care. Unique because a code is an identity, not a label.
  code              TEXT NOT NULL,
  /** Human note: "GTM — Nike, 20 creator seats". Shown only to admins. */
  label             TEXT,

  grant_type        voucher_grant NOT NULL DEFAULT 'free_access',

  -- The brand this was issued to, for the promo where a $249 subscription earns
  -- 20 creator seats. Nullable: a general campaign code belongs to nobody.
  brand_user_id     VARCHAR REFERENCES users(id),

  -- 'creator' restricts redemption to creator signups. NULL means any role.
  role_restriction  TEXT,

  -- The cap. NULL means uncapped, which is what the old env-var code was.
  max_redemptions   INTEGER,

  expires_at        TIMESTAMP,
  -- Revocation is a timestamp, not a delete: the redemptions already made under
  -- it stay valid and stay explicable.
  revoked_at        TIMESTAMP,

  created_by        VARCHAR REFERENCES users(id),
  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Case-insensitive uniqueness. Without this, "GTM20" and "gtm20" would be two
-- different vouchers with two separate caps.
CREATE UNIQUE INDEX IF NOT EXISTS voucher_code_uniq ON vouchers (upper(code));
CREATE INDEX IF NOT EXISTS voucher_brand_idx ON vouchers (brand_user_id);

CREATE TABLE IF NOT EXISTS voucher_redemptions (
  id           VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_id   VARCHAR NOT NULL REFERENCES vouchers(id),
  user_id      VARCHAR NOT NULL REFERENCES users(id),
  redeemed_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One redemption per person per voucher. Stops a double-submitted form, and
-- stops one creator consuming several of a brand's twenty seats.
CREATE UNIQUE INDEX IF NOT EXISTS voucher_redemption_user_uniq
  ON voucher_redemptions (voucher_id, user_id);

CREATE INDEX IF NOT EXISTS voucher_redemption_voucher_idx
  ON voucher_redemptions (voucher_id);
