-- Activity (client, 22 Oct 2026): "there is presently no way to see whether
-- users have actually entered the platform. We need to be able to assess which
-- areas of the web application they're landing on, or leaving on."
--
-- First-party page views and sign-ins only: no IP address, no third-party
-- script. visitor_id is a random id kept in the visitor's browser, so a
-- session's landing and exit pages can be found before anyone signs up.
CREATE TABLE IF NOT EXISTS activity_events (
  id bigserial PRIMARY KEY,
  at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  type text NOT NULL,
  visitor_id text,
  session_id text,
  user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  path text,
  referrer_host text,
  device text,
  voucher_id varchar REFERENCES vouchers(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS activity_events_at_idx ON activity_events (at);
CREATE INDEX IF NOT EXISTS activity_events_session_idx ON activity_events (session_id, at);
CREATE INDEX IF NOT EXISTS activity_events_user_idx ON activity_events (user_id, at);
CREATE INDEX IF NOT EXISTS activity_events_voucher_idx ON activity_events (voucher_id);
CREATE INDEX IF NOT EXISTS activity_events_visitor_idx ON activity_events (visitor_id);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS last_login_at timestamp,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamp,
  ADD COLUMN IF NOT EXISTS login_count integer NOT NULL DEFAULT 0;
