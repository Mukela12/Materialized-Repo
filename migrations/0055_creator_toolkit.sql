-- The Creator Toolkit on the creator homepage (client, 18 Nov 2026).
-- site_content: editable page content, one JSON value per key ('creator_toolkit').
CREATE TABLE IF NOT EXISTS site_content (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by varchar REFERENCES users(id),
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Clicks on a partner tool card, so referral traffic can be counted per tool.
CREATE TABLE IF NOT EXISTS toolkit_clicks (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name text NOT NULL,
  link_url text NOT NULL,
  user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS toolkit_clicks_tool_idx ON toolkit_clicks (tool_name, created_at);

-- The month a video was entered into the Creator Challenge ("YYYY-MM"), or null.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS challenge_month text;
CREATE INDEX IF NOT EXISTS videos_challenge_month_idx ON videos (challenge_month) WHERE challenge_month IS NOT NULL;

-- Registrations of interest for the Creator Film Awards, one per account.
CREATE TABLE IF NOT EXISTS film_award_registrations (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id varchar NOT NULL REFERENCES users(id),
  email text NOT NULL,
  handle text NOT NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS film_award_registrations_user_uniq ON film_award_registrations (user_id);
