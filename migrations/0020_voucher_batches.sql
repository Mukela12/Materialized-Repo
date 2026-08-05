-- ============================================================================
-- 0020 — Vouchers in batches, and who each one went to
--
-- WHAT THE CLIENT ACTUALLY NEEDS (voice note, 5 Aug)
--   "One account holder will be given a publisher account... I'll then generate
--    for them 80 voucher codes and they will share those with their network."
--
--   That is EIGHTY DISTINCT CODES handed to a partner to distribute — not one
--   code that may be redeemed eighty times, which is what 0019 built. The
--   difference matters:
--
--     one code, 80 uses    anyone holding it can redeem; you cannot tell whose
--                          seat was taken, cannot revoke one recipient, and a
--                          code forwarded once is a code forwarded everywhere.
--     80 codes, 1 use      each is traceable to a recipient and revocable on its
--                          own, which is what a partner distributing them needs.
--
--   Both remain possible; max_redemptions still does the shared-code case.
--
-- `batch_id` GROUPS A MINT
--   So "the 80 I gave Vogue" is one query, one CSV, and one thing to revoke —
--   rather than eighty rows to pick out of a list by eye.
--
-- `assigned_to` IS A NOTE, NOT A FOREIGN KEY
--   She plans to hand the partner a spreadsheet and have THEM write in which
--   brand each code went to. At that point the recipient is a name typed by
--   someone outside the system, not a user row — most of them will not have
--   accounts yet, which is the entire point of a voucher. Modelling it as an FK
--   would make the common case unrepresentable.
-- ============================================================================

ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS batch_id     VARCHAR,
  ADD COLUMN IF NOT EXISTS assigned_to  TEXT;

-- Pull back a whole mint at once.
CREATE INDEX IF NOT EXISTS voucher_batch_idx ON vouchers (batch_id, created_at);
