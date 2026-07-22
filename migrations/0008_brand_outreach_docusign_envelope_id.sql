-- 0008  WF-6 ops-hardening: DocuSign real-envelope integration
--
-- Adds the column that backs setBrandOutreachEnvelopeId(). Drizzle SELECTs every
-- column declared in shared/schema.ts, so this column MUST exist in the DB before
-- the new brandOutreachRequests-reading code deploys, or those reads error with
-- "column does not exist" — hence this is applied ahead of the deploy, not only
-- when DocuSign creds are provisioned.
--
-- Additive + idempotent (ADD COLUMN IF NOT EXISTS); safe to re-run. Runs inside a
-- transaction (no autocommit-only statements here).

ALTER TABLE brand_outreach_requests
  ADD COLUMN IF NOT EXISTS docusign_envelope_id text;
