-- Invite campaigns (3 Nov 2026): the client's list of creators and brands with
-- no MTRLZD account, invited a set number a day, each with their own free pass
-- and an unsubscribe link. See server/inviteCampaigns.ts.
CREATE TABLE IF NOT EXISTS invite_campaigns (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  from_name text,
  reply_to text,
  creator_subject text NOT NULL,
  creator_body text NOT NULL,
  brand_subject text NOT NULL,
  brand_body text NOT NULL,
  cta_label text NOT NULL,
  creator_free_days integer NOT NULL DEFAULT 30,
  brand_free_days integer NOT NULL DEFAULT 30,
  use_within_days integer NOT NULL DEFAULT 30,
  daily_limit integer NOT NULL DEFAULT 50,
  postal_address text,
  -- Sending: started and not paused.
  started_at timestamp,
  paused_at timestamp,
  created_by varchar REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One row per person on a campaign's list. The token is their unsubscribe
-- link; an opt-out holds for that address on every campaign and, if they later
-- make an account, for the journeys too.
CREATE TABLE IF NOT EXISTS invite_contacts (
  id serial PRIMARY KEY,
  campaign_id varchar NOT NULL REFERENCES invite_campaigns(id) ON DELETE CASCADE,
  position integer NOT NULL,
  email text NOT NULL,
  name text NOT NULL DEFAULT '',
  company text,
  type text NOT NULL CHECK (type IN ('creator', 'brand')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sending', 'sent', 'failed', 'skipped')),
  reason text,
  attempts integer NOT NULL DEFAULT 0,
  voucher_id varchar REFERENCES vouchers(id) ON DELETE SET NULL,
  token text NOT NULL UNIQUE,
  sent_at timestamp,
  opted_out_at timestamp,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (campaign_id, email)
);
CREATE INDEX IF NOT EXISTS invite_contacts_email_idx ON invite_contacts (email);
CREATE INDEX IF NOT EXISTS invite_contacts_queue_idx ON invite_contacts (campaign_id, status, position);
