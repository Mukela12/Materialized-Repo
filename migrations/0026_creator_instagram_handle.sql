-- ============================================================================
-- 0026 — The creator's Instagram handle
--
-- THE CLIENT: 'Mail merge field, replace "by a creator" should use
-- "by [Creator_Instagram_Handle]"'.
--
-- The field did not exist on a creator at all. `instagram_handle` was on
-- subscriber_intakes — a signup form, not a profile — so the outreach email
-- had nothing to merge and used the display name instead.
--
-- A brand's PR contact can look up a handle and see the creator's audience in
-- ten seconds. A display name tells them nothing, which is the difference
-- between an email that gets a reply and one that does not.
--
-- Nullable: most existing creators have not set one, and the email falls back
-- to the display name rather than printing an empty "by".
-- ============================================================================

ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT;
