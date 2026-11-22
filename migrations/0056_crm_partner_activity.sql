-- Admin CRM and partner inactivity (client, 22 Nov 2026).
--
-- CRM: one admin table of every account, with a company, the admin's own
-- notes and an Archived status. These three are the admin's, never the
-- account holder's, so they are read and written only by server/crm.ts and
-- are deliberately not in the Drizzle schema (no user-facing route can set them).
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_company text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS crm_notes text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS archived_at timestamp;

-- Partner inactivity: a partner is flagged after 30 days with no activity and
-- their partner status is switched off after 60 (a daily job sets
-- deactivated_at). Admin switches it back on, which restarts the count.
ALTER TABLE program_senders ADD COLUMN IF NOT EXISTS deactivated_at timestamp;
ALTER TABLE program_senders ADD COLUMN IF NOT EXISTS reactivated_at timestamp;
