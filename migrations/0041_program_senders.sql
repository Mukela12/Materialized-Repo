-- Program invites (client, 7 Oct 2026). Fashion Week producers were handed
-- voucher codes in a CSV and asked to email them out themselves, and the
-- codes did not get used: "I think the clunk is the voucher code sharing".
-- An admin now switches an account on to send invites from the app: how many
-- designers (brand seats) and influencers (creator seats) it may invite, and
-- which existing code each invite copies its terms from, so every invite
-- carries exactly what the program's own codes already give.
CREATE TABLE IF NOT EXISTS program_senders (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  program_name text NOT NULL,
  brand_limit integer NOT NULL DEFAULT 0,
  brand_template_voucher_id varchar REFERENCES vouchers(id) ON DELETE SET NULL,
  creator_limit integer NOT NULL DEFAULT 0,
  creator_template_voucher_id varchar REFERENCES vouchers(id) ON DELETE SET NULL,
  created_by varchar,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
