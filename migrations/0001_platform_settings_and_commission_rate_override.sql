-- 0001  PR #4 admin-adjustable-rates  (commit bdaba2e)
-- Adds the admin-editable rate override on users and the singleton platform_settings table.
-- Idempotent: safe to re-run against prod where this DDL is already applied.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS commission_rate_override numeric(5, 2);

CREATE TABLE IF NOT EXISTS platform_settings (
  id                  varchar PRIMARY KEY DEFAULT 'singleton',
  marketplace_fee_pct numeric(5, 2),
  creator_pct         numeric(5, 2),
  publisher_pct       numeric(5, 2),
  updated_at          timestamp DEFAULT CURRENT_TIMESTAMP
);
