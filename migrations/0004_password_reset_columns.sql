-- 0004  PR #19 emails-password-reset  (commit 7cee468)
-- Password-reset token hash + expiry on users.
-- Idempotent: safe to re-run against prod where this DDL is already applied.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_token_hash text;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS password_reset_expires timestamp;
