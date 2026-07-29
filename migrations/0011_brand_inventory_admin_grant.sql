-- ============================================================================
-- 0011 — Admin-granted brand inventory access
--
-- WHY THIS EXISTS
--   The client's rule (28 Jul 2026) is that a brand's inventory becomes
--   discoverable once the brand accepts and pays a $29 administration fee,
--   WITHOUT a full subscription, for a 30-day window.
--
--   The self-serve version of that flow — emailed accept link, brand claims its
--   own row, connects its store, pays via hosted checkout — was built and then
--   cut. Adversarial review found that a creator could file a free-text invite
--   naming an unclaimed brand, receive the authorization token at their own
--   address, and take ownership of a real, product-bearing catalogue; ownership
--   then bypasses the inventory gate entirely. The store-credential check that
--   was meant to prove control did not, because the store domain was never
--   constrained. That work is preserved in the git stash
--   "WIP: self-serve brand acceptance".
--
--   This migration supports the safe form of the same commercial outcome: an
--   admin verifies the brand and settles the $29 out of band, then grants a
--   window. No untrusted party can reach it.
--
-- EXPIRY
--   `inventory_access_until` is compared against now() at READ time, so a window
--   self-expires. There is no scheduler in this codebase and this deliberately
--   does not require one.
--
-- SAFETY
--   Additive only — three nullable columns, no backfill, no data rewritten.
--   Existing brands are unaffected: NULL reads as "no admin grant", so access
--   continues to depend solely on an active subscription exactly as before.
--   Re-running is a no-op.
-- ============================================================================

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS inventory_access_until timestamp;

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS inventory_access_granted_by varchar REFERENCES users(id);

ALTER TABLE brands
  ADD COLUMN IF NOT EXISTS inventory_access_note text;

-- The gate filters on this column for every product listing, so index the live
-- window. Partial: only granted rows are ever scanned.
CREATE INDEX IF NOT EXISTS brands_inventory_access_until_idx
  ON brands (inventory_access_until)
  WHERE inventory_access_until IS NOT NULL;
