-- Journey sender settings and a plain first email (23 Oct 2026).
--
-- The client's experience: short, plain, personal emails reach the inbox when
-- designed ones go to spam, and a reply from the recipient keeps later emails
-- out of spam too. So each journey gets a sender name and a reply-to address
-- (replies reach a real person instead of noreply@), any email can be sent
-- "plain" (no logo or layout), and every journey now opens with a short
-- personal welcome that asks for a reply.
--
-- The doc's original first emails are replaced only where nobody has edited
-- them yet (matched on their original subject).

ALTER TABLE email_journeys ADD COLUMN IF NOT EXISTS from_name text,
  ADD COLUMN IF NOT EXISTS reply_to text;
ALTER TABLE email_journey_steps ADD COLUMN IF NOT EXISTS plain boolean NOT NULL DEFAULT false;

UPDATE email_journey_steps SET subject = $j$Welcome to MTRLZD, {{FirstName}}$j$, body = $j$Hi {{FirstName}},

Thanks for joining MTRLZD. I'm Beth, and I'll be your point of contact while you get started.

As a creator, you can turn videos you've already made into shoppable ones, just by tagging the brands in them.

Could you reply to this email with a quick hello? It makes sure the next few emails, with tips to get you going, land in your inbox and not in spam.

Beth
MTRLZD$j$, cta_label = NULL, cta_path = NULL, plain = true, condition = 'always', enabled = true, review_note = NULL, updated_at = now()
  WHERE segment = $j$creators$j$ AND position = 1 AND subject = $j${{FirstName}}, your videos could be worth more than views$j$;
UPDATE email_journey_steps SET subject = $j$Welcome to MTRLZD, {{FirstName}}$j$, body = $j$Hi {{FirstName}},

Thanks for joining MTRLZD. I'm Beth, and I'll be your point of contact while you get started.

As a brand, you can make your product videos shoppable and have creators feature your products in theirs.

Could you reply to this email with a quick hello? It makes sure the next few emails, with tips to get you going, land in your inbox and not in spam.

Beth
MTRLZD$j$, cta_label = NULL, cta_path = NULL, plain = true, condition = 'always', enabled = true, review_note = NULL, updated_at = now()
  WHERE segment = $j$brands$j$ AND position = 1 AND subject = $j${{FirstName}}, your $1,739 Brand Pass package is waiting$j$;
UPDATE email_journey_steps SET subject = $j$Welcome to MTRLZD, {{FirstName}}$j$, body = $j$Hi {{FirstName}},

Thanks for joining MTRLZD. I'm Beth, and I'll be your point of contact while you get started.

As a publisher, you can add shoppable videos to your pages and earn on the sales they bring in.

Could you reply to this email with a quick hello? It makes sure the next few emails, with tips to get you going, land in your inbox and not in spam.

Beth
MTRLZD$j$, cta_label = NULL, cta_path = NULL, plain = true, condition = 'always', enabled = true, review_note = NULL, updated_at = now()
  WHERE segment = $j$publishers$j$ AND position = 1 AND subject = $j${{CompanyName}} could be earning more from every video$j$;
UPDATE email_journey_steps SET subject = $j$Welcome to MTRLZD, {{FirstName}}$j$, body = $j$Hi {{FirstName}},

Thanks for joining MTRLZD. I'm Beth, and I'll be your point of contact while you get started.

As an agency, you can bring your talent on board with Creator Passes and earn on the activity they create.

Could you reply to this email with a quick hello? It makes sure the next few emails, with tips to get you going, land in your inbox and not in spam.

Beth
MTRLZD$j$, cta_label = NULL, cta_path = NULL, plain = true, condition = 'always', enabled = true, review_note = NULL, updated_at = now()
  WHERE segment = $j$talent_agencies$j$ AND position = 1 AND subject = $j${{FirstName}}, your talent roster could earn more with MTRLZD$j$;
UPDATE email_journey_steps SET subject = $j$Welcome to MTRLZD, {{FirstName}}$j$, body = $j$Hi {{FirstName}},

Thanks for joining MTRLZD. I'm Beth, and I'll be your point of contact while you get started.

As an agency, you can run shoppable video campaigns for your brand clients from one place.

Could you reply to this email with a quick hello? It makes sure the next few emails, with tips to get you going, land in your inbox and not in spam.

Beth
MTRLZD$j$, cta_label = NULL, cta_path = NULL, plain = true, condition = 'always', enabled = true, review_note = NULL, updated_at = now()
  WHERE segment = $j$brand_agencies$j$ AND position = 1 AND subject = $j${{FirstName}}, give your clients a new way to monetize video$j$;
UPDATE email_journey_steps SET subject = $j$Welcome to MTRLZD, {{FirstName}}$j$, body = $j$Hi {{FirstName}},

Thanks for joining MTRLZD. I'm Beth, and I'll be your point of contact while you get started.

For your fashion week, you can turn runway, backstage and designer videos into shoppable content for your partners.

Could you reply to this email with a quick hello? It makes sure the next few emails, with tips to get you going, land in your inbox and not in spam.

Beth
MTRLZD$j$, cta_label = NULL, cta_path = NULL, plain = true, condition = 'always', enabled = true, review_note = NULL, updated_at = now()
  WHERE segment = $j$fashion_weeks$j$ AND position = 1 AND subject = $j${{FirstName}}, put $34,000+ in subscription value behind your Fashion Week$j$;
UPDATE email_journey_steps SET subject = $j$Welcome to MTRLZD, {{FirstName}}$j$, body = $j$Hi {{FirstName}},

Thanks for joining MTRLZD. I'm Beth, and I'll be your point of contact while you get started.

For your festival, you can make fashion films shoppable and give your filmmakers and sponsors a new way to earn.

Could you reply to this email with a quick hello? It makes sure the next few emails, with tips to get you going, land in your inbox and not in spam.

Beth
MTRLZD$j$, cta_label = NULL, cta_path = NULL, plain = true, condition = 'always', enabled = true, review_note = NULL, updated_at = now()
  WHERE segment = $j$film_festivals$j$ AND position = 1 AND subject = $j${{FirstName}}, add $34,000 in subscription value to your festival partnership$j$;
