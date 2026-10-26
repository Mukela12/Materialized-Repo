-- Partner commissions, welcome freebies and creator bonuses (27 Oct 2026).
--
-- The client's model: partners (agencies, influencer platforms, Creative
-- Advisors, event organisers) earn an adjustable 1-3% (default 2%) of the
-- gross sales of the creators and brands they bring in, including creators
-- those brands then invite, for a set term. Creators can get an extra bonus %
-- on their own sales for a set term (the "extra 5%" on the Paris page). All of
-- it comes out of MTRLZD's 15% fee, which always keeps 3.9% for Stripe and at
-- least 3.1% for MTRLZD (server/feeConfig.ts).

-- Partners are program senders: their free passes per type, and their deal.
ALTER TABLE program_senders
  ADD COLUMN IF NOT EXISTS publisher_limit integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS publisher_template_voucher_id varchar REFERENCES vouchers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS commission_pct numeric(4,2),
  ADD COLUMN IF NOT EXISTS commission_until timestamp;

-- Any code can credit a partner (e.g. an Advisor's own named code), and can
-- carry a creator bonus that the person who redeems it gets.
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS referrer_user_id varchar REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS creator_bonus_pct numeric(4,2),
  ADD COLUMN IF NOT EXISTS creator_bonus_months integer;

-- A per-person commission override can now end.
ALTER TABLE users ADD COLUMN IF NOT EXISTS commission_override_until timestamp;

-- Which part of the sale a commission row is: creator, publisher, partner.
ALTER TABLE commission_transactions ADD COLUMN IF NOT EXISTS kind text;

-- The brand offer (client, 26 Oct 2026): 10 Creator Passes to start, 100 on
-- the paid plan, and an email 14 days before the trial ends saying so. Added
-- at the end of the Brands journey, once, switched off until the client has
-- read it.
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note, enabled)
SELECT $j$brands$j$, coalesce((SELECT max(position) FROM email_journey_steps WHERE segment = $j$brands$j$), 0) + 1,
  $j$trial_end$j$, -14, $j$not_paying$j$,
  $j${{FirstName}}, 100 Creator Passes for {{CompanyName}}$j$,
  $j$Hi {{FirstName}},

Your trial ends in 14 days.

During the trial, {{CompanyName}} can invite up to 10 creators with free Creator Passes. On the paid plan that goes up to 100, so ten times more creators can feature, tag and sell your pieces.

You still have {{CreatorPasses}} Creator Passes to use now.

Stay on your plan when the trial ends and the 100 passes are yours.$j$,
  $j$See my plan$j$, $j${plans}$j$,
  $j$New: the brand offer (10 passes in the trial, 100 on the paid plan). Check the wording before switching on.$j$, false
WHERE EXISTS (SELECT 1 FROM email_journeys WHERE segment = $j$brands$j$)
  AND NOT EXISTS (SELECT 1 FROM email_journey_steps WHERE segment = $j$brands$j$ AND condition = $j$not_paying$j$ AND day = -14);
