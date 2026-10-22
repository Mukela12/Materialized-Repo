-- Email journeys (22 Oct 2026): the client's 7 x 12 onboarding emails from the
-- "MTRLZD DEV" doc, sent on a schedule and gated on what each person has done.
--
-- Every journey starts OFF (enabled_at null). The seeded copy carries review
-- notes where it promises things the app doesn't do yet; the admin switches a
-- journey on once its emails are right. Only accounts created after a journey
-- is switched on are enrolled, so turning one on never mails old accounts a
-- backlog.

CREATE TABLE IF NOT EXISTS email_journeys (
  segment text PRIMARY KEY,
  name text NOT NULL,
  audience text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  enabled_at timestamp,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS email_journey_steps (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  segment text NOT NULL REFERENCES email_journeys(segment) ON DELETE CASCADE,
  position integer NOT NULL,
  -- 'signup': day N after the account was made. 'trial_end': N days from the
  -- end of the free window (negative = before), so a 14-day trial and a 60-day
  -- pass both get their "ending soon" email at the right time.
  anchor text NOT NULL DEFAULT 'signup',
  day integer NOT NULL,
  condition text NOT NULL DEFAULT 'always',
  subject text NOT NULL,
  body text NOT NULL,
  cta_label text,
  cta_path text,
  enabled boolean NOT NULL DEFAULT true,
  review_note text,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (segment, position)
);

CREATE TABLE IF NOT EXISTS email_journey_enrollments (
  user_id varchar PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  segment text NOT NULL REFERENCES email_journeys(segment) ON DELETE CASCADE,
  enrolled_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS email_journey_enrollments_segment_idx ON email_journey_enrollments (segment);

-- One row per person per email: the unique key is what stops a double send.
CREATE TABLE IF NOT EXISTS email_journey_sends (
  id bigserial PRIMARY KEY,
  user_id varchar NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  step_id varchar NOT NULL REFERENCES email_journey_steps(id) ON DELETE CASCADE,
  status text NOT NULL,
  reason text,
  attempts integer NOT NULL DEFAULT 1,
  at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, step_id)
);
CREATE INDEX IF NOT EXISTS email_journey_sends_step_idx ON email_journey_sends (step_id, status);
CREATE INDEX IF NOT EXISTS email_journey_sends_user_idx ON email_journey_sends (user_id, at);

-- Which journey a voucher partner's people get (e.g. "Fashion Week Brooklyn"
-- codes went to brands, a talent agency's codes to an agency).
CREATE TABLE IF NOT EXISTS email_journey_partners (
  partner text PRIMARY KEY,
  segment text NOT NULL REFERENCES email_journeys(segment) ON DELETE CASCADE
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS journey_segment text,
  ADD COLUMN IF NOT EXISTS email_opt_out_at timestamp,
  ADD COLUMN IF NOT EXISTS email_token text;
CREATE UNIQUE INDEX IF NOT EXISTS users_email_token_idx ON users (email_token);

-- Seed: the doc's copy, with the {{FirstName}} / {{CompanyName}} fields that
-- were lost from most segments put back, and em dashes replaced.
INSERT INTO email_journeys (segment, name, audience, sort) VALUES ($j$creators$j$, $j$Creators$j$, $j$Creators who sign up or join with a Creator Pass$j$, 1) ON CONFLICT (segment) DO NOTHING;
INSERT INTO email_journeys (segment, name, audience, sort) VALUES ($j$brands$j$, $j$Brands$j$, $j$Brands who sign up or join with a Brand Pass$j$, 2) ON CONFLICT (segment) DO NOTHING;
INSERT INTO email_journeys (segment, name, audience, sort) VALUES ($j$publishers$j$, $j$Media & publishers$j$, $j$Digital magazines, editorial publishers and video-led media$j$, 3) ON CONFLICT (segment) DO NOTHING;
INSERT INTO email_journeys (segment, name, audience, sort) VALUES ($j$talent_agencies$j$, $j$Talent agencies$j$, $j$Agencies who share Creator Passes with their talent$j$, 4) ON CONFLICT (segment) DO NOTHING;
INSERT INTO email_journeys (segment, name, audience, sort) VALUES ($j$brand_agencies$j$, $j$Brand agencies$j$, $j$Agencies running campaigns for brand clients$j$, 5) ON CONFLICT (segment) DO NOTHING;
INSERT INTO email_journeys (segment, name, audience, sort) VALUES ($j$fashion_weeks$j$, $j$Fashion week organizers$j$, $j$Fashion week organizers and their sponsors$j$, 6) ON CONFLICT (segment) DO NOTHING;
INSERT INTO email_journeys (segment, name, audience, sort) VALUES ($j$film_festivals$j$, $j$Fashion film festivals$j$, $j$Fashion film festival organizers$j$, 7) ON CONFLICT (segment) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 1, $j$signup$j$, 0, $j$always$j$, $j${{FirstName}}, your talent roster could earn more with MTRLZD$j$, $j$Hi {{FirstName}},

What if your talent could earn more from the brand deals they're already doing?

MTRLZD turns existing videos into interactive, shoppable entertainment. Your agency can share complimentary 30-day Creator Passes, with a stated combined value of $1,730+, so your talent can upload up to 4 videos, tag brands, and explore an additional 5% MTRLZD affiliate commission opportunity alongside eligible existing brand payouts.

Your agency can also earn a potential 2% affiliate commission from qualifying creator activity.

That's more value for your talent, and a new revenue opportunity for {{CompanyName}}.$j$, $j$Activate Your Agency Account$j$, $j${portal}$j$, $j$States a dollar value for the package. Confirm it against current pricing. Promises creators an extra 5% commission. The live creator commission is 0%, so confirm the terms or take it out before switching this on. Says a pass includes 4 uploads. Check that matches the allowance the codes actually give. There's no separate agency account or workspace; agencies use a normal account. Consider rewording the button.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 2, $j$signup$j$, 1, $j$no_invites_joined$j$, $j$Give your talent $1,730+ in opportunities to explore$j$, $j$Hi {{FirstName}},

Your talent already creates content. MTRLZD gives them another way to put those videos to work.

Share your complimentary Creator Passes and let your roster test interactive video, tag eligible brands, and explore additional affiliate earnings, without committing to a paid plan during the 30-day trial.$j$, $j$Share Creator Passes$j$, $j${portal}/invites$j$, $j$States a dollar value for the package. Confirm it against current pricing.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 3, $j$signup$j$, 3, $j$no_invites_sent$j$, $j$Start with 5 creators. Build a new revenue channel.$j$, $j$Hi {{FirstName}},

You don't need to onboard your entire roster to see the potential.

Invite 5 creators whose fashion, beauty, lifestyle, or editorial content is already attracting attention. They'll get a practical way to test shoppable video, while {{CompanyName}} can begin building qualifying creator activity.$j$, $j$Invite Your First 5 Creators$j$, $j${portal}/invites$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 4, $j$signup$j$, 5, $j$invites_joined$j$, $j$Your talent can earn an extra 5%, here's how$j$, $j$Hi {{FirstName}},

Your creators don't have to abandon their existing brand relationships to try something new.

Eligible creators can earn an additional 5% MTRLZD affiliate commission under the applicable programme terms, alongside their existing brand payouts. They can tag eligible products in their videos and explore new brand opportunities.$j$, $j$Help Your Talent Start Earning$j$, $j${portal}$j$, $j$Promises creators an extra 5% commission. The live creator commission is 0%, so confirm the terms or take it out before switching this on.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 5, $j$signup$j$, 7, $j$invitee_uploaded$j$, $j$More visibility. More brand opportunities. More earning potential.$j$, $j$Hi {{FirstName}},

Your talent's videos may have a life beyond their own social channels.

Through the MTRLZD Global Video Library, eligible content can be made available to participating affiliate publishers for redistribution, subject to permissions and programme terms. That creates additional opportunities for discovery, audience growth, and commercial partnerships.$j$, $j$Explore the Global Video Library$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 6, $j$signup$j$, 9, $j$always$j$, $j$Turn your roster into a measurable revenue opportunity$j$, $j$Hi {{FirstName}},

Which creators are active? Which videos are live? Where could the next brand opportunity come from?

Review your available activity data and identify the talent most ready for interactive campaigns. Qualifying creator activity may also contribute to your agency's potential 2% affiliate commission.$j$, $j$Review Agency Activity$j$, $j${portal}/analytics$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 7, $j$signup$j$, 12, $j$invitee_uploaded$j$, $j$Match your talent with brands that fit their content$j$, $j$Hi {{FirstName}},

The right brand partnership starts with a natural fit.

Identify creators whose content aligns with participating brands, then help them turn relevant videos into interactive product experiences. It's another way to build commercial value from content they've already invested in producing.$j$, $j$Explore Brand Opportunities$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 8, $j$signup$j$, 15, $j$invites_joined$j$, $j$4 uploads. 30 days. Let's put those Passes to work.$j$, $j$Hi {{FirstName}},

Your creators have up to 4 video uploads during their 30-day trial. Encourage them to test different products, storytelling approaches, and brand tags.

The goal is simple: help your talent discover what works, build a stronger video portfolio, and explore additional earning opportunities.$j$, $j$Complete Your First 4 Uploads$j$, $j${upload}$j$, $j$Says a pass includes 4 uploads. Check that matches the allowance the codes actually give.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 9, $j$signup$j$, 18, $j$needs_feature$j$, $j$Give your creators a new reason to publish this month$j$, $j$Hi {{FirstName}},

MTRLZD's monthly Creator Challenges give your roster fresh creative prompts and another reason to make interactive content.

Share the current challenge with your talent and encourage eligible submissions. It's an easy way to keep your portfolio engaged and introduce creators to new brand opportunities.$j$, $j$Explore This Month's Challenge$j$, $j${portal}$j$, $j$Creator Challenges don't exist in the app yet, so this one stays paused. Edit it to be about something else, or leave it until challenges are built.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 10, $j$signup$j$, 21, $j$invites_joined$j$, $j$Your agency's next revenue opportunity may already be in your roster$j$, $j$Hi {{FirstName}},

Your first creators are getting started. Now consider which 5 creators should join them.

Use your available activity data to identify promising talent, encourage repeat uploads, and connect relevant creators with participating brands. Your potential 2% affiliate earnings are tied to qualifying activity, so active participation matters.$j$, $j$Expand Your Creator Network$j$, $j${portal}/invites$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 11, $j$trial_end$j$, -4, $j$not_subscribed$j$, $j${{FirstName}}, let's keep your talent's momentum going$j$, $j$Hi {{FirstName}},

Your initial 30-day trial period is nearly complete. Review your creators' participation, video uploads, and available commercial opportunities.

If MTRLZD is helping your talent build new ways to showcase their work and explore affiliate earnings, let's plan the next phase for {{CompanyName}}.$j$, $j$Review Your Continuation Options$j$, $j${plans}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$talent_agencies$j$, 12, $j$trial_end$j$, 0, $j$not_subscribed$j$, $j$Don't leave your talent's next earning opportunity on the table$j$, $j$Hi {{FirstName}},

Your complimentary trial is ending. Keep your creators moving with interactive video, eligible brand tagging, publisher discovery, and monthly creative challenges.

Review the available continuation options and decide how you'd like to grow {{CompanyName}}'s MTRLZD activity.$j$, $j$Continue With MTRLZD$j$, $j${plans}$j$, $j$Mentions monthly challenges, which the app doesn't have yet.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 1, $j$signup$j$, 0, $j$always$j$, $j${{FirstName}}, give your clients a new way to monetize video$j$, $j$Hi {{FirstName}},

MTRLZD connects brands, creators, and interactive shoppable video in a single commerce-oriented workflow.

can introduce clients to complimentary Brand and Creator Passes, explore existing influencer programme integrations, and build a new service around video engagement, product discovery, and affiliate performance.$j$, $j$Activate Your Agency Workspace$j$, $j${portal}$j$, $j$There's no separate agency account or workspace; agencies use a normal account. Consider rewording the button.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 2, $j$signup$j$, 1, $j$always$j$, $j$Your clients' influencer programmes could do more$j$, $j$Hi {{FirstName}},

Your clients already invest in creators. MTRLZD gives them another way to connect those relationships with interactive, shoppable video.

Choose 1 client programme to pilot and explore how existing product catalogues, creators, and eligible commission structures can work together.$j$, $j$Choose Your First Client$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 3, $j$signup$j$, 3, $j$always$j$, $j$Start with 1 brand. Prove the opportunity.$j$, $j$Hi {{FirstName}},

You don't need a portfolio-wide rollout to get started.

Select 1 client, 1 creator cohort, and 1 measurable objective, such as video engagement, product discovery, or attributed revenue. Use the initial pilot to determine what deserves further investment.$j$, $j$Launch Your First Pilot$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 4, $j$signup$j$, 5, $j$always$j$, $j$See which creators and videos are delivering value$j$, $j$Hi {{FirstName}},

MTRLZD's brand dashboard is designed to help clients review available post activity, engagement, revenue, and top-performing videos and creators.

Give your account team another way to identify strong content, evaluate creator performance, and inform campaign decisions.$j$, $j$Explore Brand Analytics$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 5, $j$signup$j$, 7, $j$always$j$, $j$Connect your brand and talent portfolios$j$, $j$Hi {{FirstName}},

Your agency's advantage is the relationships you already have.

Connect relevant brand clients with suitable talent, then explore how interactive video can turn their collaborations into product-discovery experiences and new commercial opportunities.$j$, $j$Connect Brands and Creators$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 6, $j$signup$j$, 9, $j$always$j$, $j$Make influencer commissions more performance-driven$j$, $j$Hi {{FirstName}},

Brands can explore integrating existing influencer programmes and adjusting eligible affiliate commissions based on creator performance.

Depending on the integration, MTRLZD can help centralize video-commerce activity and connect creator incentives with campaign objectives.$j$, $j$Explore Commission Integration$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 7, $j$signup$j$, 12, $j$needs_feature$j$, $j$What if your next campaign had 2 different endings?$j$, $j$Hi {{FirstName}},

Interactive video opens up new creative possibilities. Where supported, test alternate endings, product presentations, or calls to action to explore what resonates with your audience.

Define your hypothesis first, then use the available engagement data to inform the next campaign.$j$, $j$Plan an Interactive Campaign$j$, $j${portal}$j$, $j$Choose-your-ending video (alternate endings) isn't something the app can do yet. Paused until it can, or edit it to be about something else.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 8, $j$signup$j$, 15, $j$always$j$, $j$Turn client videos into shoppable experiences$j$, $j$Hi {{FirstName}},

MTRLZD brings product discovery and in-video shopping to eligible brand content across supported e-commerce experiences, websites, and Substack publications.

The stated marketplace fee is 15% for transactions using MTRLZD's in-video shopping marketplace. Review the applicable commercial terms and identify a client campaign to launch.$j$, $j$Publish a Shoppable Video$j$, $j${upload}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 9, $j$signup$j$, 18, $j$always$j$, $j$Give your clients' best videos another route to market$j$, $j$Hi {{FirstName}},

Eligible videos may be discovered and redistributed through participating affiliate publishers in the MTRLZD Global Video Library, subject to permissions and programme terms.

That means another potential route to audience growth, qualified traffic, and sales leads for your clients.$j$, $j$Explore Publisher Distribution$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 10, $j$signup$j$, 21, $j$needs_feature$j$, $j$Give your creators a reason to make fresh content every month$j$, $j$Hi {{FirstName}},

MTRLZD's monthly Creator Challenges give brands a repeatable way to encourage fresh content around their products.

Use the challenge format to complement your clients' influencer calendars, with clear briefs, eligibility criteria, and appropriate incentives.$j$, $j$Explore This Month's Challenge$j$, $j${portal}$j$, $j$Creator Challenges don't exist in the app yet, so this one stays paused. Edit it to be about something else, or leave it until challenges are built.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 11, $j$trial_end$j$, -4, $j$not_subscribed$j$, $j$Turn your first pilot into a scalable client service$j$, $j$Hi {{FirstName}},

Review the progress of your first brand and talent integrations. Identify which workflows can be replicated across additional clients, from creator onboarding to commission management and performance reporting.$j$, $j$Expand Your Client Portfolio$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brand_agencies$j$, 12, $j$trial_end$j$, 0, $j$not_subscribed$j$, $j${{FirstName}}, let's build your agency's next growth channel$j$, $j$Hi {{FirstName}},

Your first month is an opportunity to establish how interactive video can support your clients' creator programmes and commercial campaigns.

Let's map the next rollout across {{CompanyName}}'s brand and talent portfolio.$j$, $j$Plan Your Agency Rollout$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 1, $j$signup$j$, 0, $j$always$j$, $j${{CompanyName}} could be earning more from every video$j$, $j$Hi {{FirstName}},

What if your video interviews, editorials, and product reviews could do more than attract views?

With MTRLZD, your digital magazine can become an interactive video magazine, where readers explore featured products, shop directly from video, and choose how a story unfolds.

Your publication can earn a 2% affiliate commission on eligible purchases made through its shoppable content, while featured brands gain a direct opportunity to generate product sales.

Your content already has value. MTRLZD helps you unlock more of it.$j$, $j$Activate Your Media Pass$j$, $j${portal}$j$, $j$Choose-your-ending video (alternate endings) isn't something the app can do yet.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 2, $j$signup$j$, 1, $j$always$j$, $j$Turn your existing video library into a revenue opportunity$j$, $j$Hi {{FirstName}},

You've already invested in interviews, editorial films, reviews, and branded content. Why leave that content working only for views?

MTRLZD helps you make videos interactive and shoppable, connecting featured products to the brands behind them.

• Monetize eligible product purchases through affiliate commissions.
• Give brands and advertisers more measurable commercial opportunities.
• Extend the value of interviews, reviews, and editorial features.
• Create new reasons for readers to engage with your publication.$j$, $j$See How Video Commerce Works$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 3, $j$signup$j$, 3, $j$needs_feature$j$, $j$What if readers could choose how your video ends?$j$, $j$Hi {{FirstName}},

Remember the Goosebumps books, where readers chose what happened next?

Now imagine bringing that concept into digital editorial video.

A single video interview, fashion film, or branded story could offer 2 different endings, or more, allowing viewers to choose their preferred narrative path where the format supports it.

Imagine a fashion editorial with alternative styling outcomes, a travel feature with 2 possible experiences, or a product story that lets viewers explore different recommendations.

It's an opportunity to make video more participatory, encourage repeat viewing, and create a more distinctive editorial experience.$j$, $j$Explore Interactive Video$j$, $j${portal}$j$, $j$Choose-your-ending video (alternate endings) isn't something the app can do yet. Paused until it can, or edit it to be about something else.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 4, $j$signup$j$, 5, $j$always$j$, $j$Your product reviews could generate revenue$j$, $j$Hi {{FirstName}},

Your readers discover products through your interviews, reviews, and editorials. MTRLZD helps connect that discovery to shopping.

Imagine a beauty interview where viewers can shop the products discussed, a designer profile featuring shoppable looks, or a travel editorial linking viewers to featured products.

When readers purchase through eligible affiliate links, {{CompanyName}} can earn a 2% affiliate commission, subject to applicable program terms.

Your publication creates the discovery. Your video creates the experience. MTRLZD helps connect both to commerce.$j$, $j$Monetize Your Editorials$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 5, $j$signup$j$, 7, $j$always$j$, $j$Give your advertisers a path from attention to sales$j$, $j$Hi {{FirstName}},

Traditional digital advertising often stops at exposure. Interactive, shoppable video creates an opportunity to connect brand storytelling with product discovery and purchasing.

With MTRLZD, advertisers and featured brands can present products within relevant editorial video, giving audiences a direct way to explore what they see.

For {{CompanyName}}, this creates a stronger proposition for commercial partnerships: editorial storytelling combined with shopping functionality, engagement opportunities, and potential sales.$j$, $j$Explore Video Commerce for Advertisers$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 6, $j$signup$j$, 9, $j$always$j$, $j$The next evolution of digital magazines$j$, $j$Hi {{FirstName}},

Digital magazines don't have to remain static pages supplemented by video.

MTRLZD opens the door to an editorial experience where video becomes interactive, products become shoppable, and viewers can influence how selected stories unfold.

Think:

• Fashion editorials with shoppable looks.
• Interviews featuring products, artists, and designers.
• Beauty reviews linked to the products discussed.
• Travel films featuring destinations and relevant products.
• Interactive storytelling with alternative endings.

Give your readers more ways to experience your content, and your advertisers more ways to participate.$j$, $j$Transform Your Digital Magazine$j$, $j${portal}$j$, $j$Choose-your-ending video (alternate endings) isn't something the app can do yet.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 7, $j$signup$j$, 12, $j$always$j$, $j$A new revenue layer for {{CompanyName}}$j$, $j$Hi {{FirstName}},

MTRLZD offers publishers an opportunity to build commerce into their existing editorial strategy rather than treating video and monetization as separate activities.

Your publication can potentially generate revenue through:

• Affiliate commissions: Earn 2% on eligible purchases attributed to your shoppable content, subject to program terms.
• Advertiser partnerships: Offer brands interactive video placements that connect storytelling with product discovery.
• Branded editorial: Develop shoppable interviews, reviews, and product-led features.
• Audience engagement: Experiment with interactive formats designed to give readers more control over their viewing experience.

The opportunity is to create more commercial value from content your publication already knows how to produce.$j$, $j$Get Started With MTRLZD$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 8, $j$signup$j$, 15, $j$always$j$, $j$Let the brands you feature become part of the experience$j$, $j$Hi {{FirstName}},

Your publication gives brands, artists, and products something valuable: context, storytelling, and an audience interested in what you feature.

MTRLZD helps turn that editorial context into an interactive experience.

Readers can discover products within video, explore featured items, and shop where purchasing functionality is available. Brands gain an additional route from editorial exposure to potential sales, while your publication can earn affiliate commissions on eligible transactions.

This is an opportunity to make editorial content more commercially connected without losing its creative identity.$j$, $j$Explore Brand Integration$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 9, $j$signup$j$, 18, $j$always$j$, $j$Your best-performing stories deserve another life$j$, $j$Hi {{FirstName}},

Your video archive may contain valuable interviews, product reviews, designer profiles, and editorial films that can continue working for your publication.

With MTRLZD, you can explore turning suitable existing videos into interactive, shoppable experiences, without relying entirely on producing new content.

Start with a small selection of videos. Identify relevant products and brands. Test interactive storytelling. Then evaluate engagement and commercial performance.

A practical way to discover what your audience responds to, and where new revenue opportunities may exist.$j$, $j$Start With Existing Videos$j$, $j${upload}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 10, $j$signup$j$, 22, $j$needs_feature$j$, $j$What would your readers choose?$j$, $j$Hi {{FirstName}},

Imagine giving readers a choice between 2 endings to a fashion film, 2 looks in an editorial, or different product directions within a branded story.

Which would they select? Would they explore both? Which version would lead to more product discovery?

MTRLZD's interactive video-commerce approach creates an opportunity to test new storytelling formats and learn from audience behavior, subject to the functionality and analytics available in your setup.

Your next editorial experiment could become more than a video. It could become an experience readers actively participate in.$j$, $j$Plan Your First Interactive Video$j$, $j${portal}$j$, $j$Choose-your-ending video (alternate endings) isn't something the app can do yet. Paused until it can, or edit it to be about something else.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 11, $j$trial_end$j$, -4, $j$not_subscribed$j$, $j${{FirstName}}, let's bring your first shoppable editorial to life$j$, $j$Hi {{FirstName}},

You don't need to reinvent {{CompanyName}} to explore video commerce.

Start with 1 existing interview, editorial, or product review. Identify the featured brands and products, explore the available shopping integrations, and create an experience that gives readers more ways to engage.

MTRLZD is designed to help connect editorial storytelling, product discovery, and commerce in a single video experience.

The next step is simple: activate your Media Pass and identify the first video you'd like to transform.$j$, $j$Activate Your Media Pass$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$publishers$j$, 12, $j$trial_end$j$, 0, $j$not_subscribed$j$, $j$Is interactive video part of {{CompanyName}}'s next chapter?$j$, $j$Hi {{FirstName}},

One final thought: your publication already creates stories that influence what readers discover, discuss, and buy.

MTRLZD offers a way to bring those activities closer together, with shoppable video, interactive storytelling, advertiser opportunities, and the potential to earn affiliate commissions on eligible purchases.

Whether you start with a single product review or develop an interactive video-magazine strategy, you can begin testing how this format fits your editorial business.

If you're ready to explore a more engaging and commercially connected digital magazine, let's get started.$j$, $j$Start With MTRLZD$j$, $j${portal}$j$, $j$Choose-your-ending video (alternate endings) isn't something the app can do yet.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 1, $j$signup$j$, 0, $j$always$j$, $j${{FirstName}}, put $34,000+ in subscription value behind your Fashion Week$j$, $j$Hi {{FirstName}},

Imagine your runway shows, green rooms, sponsors, designers, and influencer VIPs becoming part of an interactive video-commerce experience.

MTRLZD proposes an exclusive video-commerce sponsorship with $34,000+ in stated subscription value, potential 2% affiliate earnings for {{CompanyName}}, and a $2,000 cash prize for the Most Engaged Video.

Let's explore how to turn your event into a digital commerce opportunity for your partners.$j$, $j$Explore Your Sponsorship Package$j$, $j${portal}$j$, $j$States a dollar value for the package. Confirm it against current pricing. Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 2, $j$signup$j$, 1, $j$always$j$, $j$Your runway could keep selling after the final walk$j$, $j$Hi {{FirstName}},

Runway footage can become more than a highlight reel.

MTRLZD can turn eligible runway videos into interactive, shoppable experiences, giving audiences a way to discover participating designers and products after the show.$j$, $j$Explore Interactive Runway Video$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 3, $j$signup$j$, 3, $j$always$j$, $j$Give your sponsors more than logo placement$j$, $j$Hi {{FirstName}},

Extend sponsor visibility through participating video campaigns that connect products with designers, talent, and event audiences.

Let's identify sponsor inventory, potential video placements, and reporting objectives that make the activation more commercially compelling.$j$, $j$Design Your Sponsor Activations$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 4, $j$signup$j$, 5, $j$always$j$, $j$Activate your VIP influencers, and give them a reason to post$j$, $j$Hi {{FirstName}},

Invite selected influencers and creators to document the event through interactive video.

Eligible creators can explore product tagging, additional affiliate opportunities, and publisher discovery while helping extend the reach of your designers and sponsors.$j$, $j$Activate Creator Passes$j$, $j${portal}/invites$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 5, $j$signup$j$, 7, $j$always$j$, $j$Give your designers a new way to monetize their runway$j$, $j$Hi {{FirstName}},

Your designers invest in collections, production, and visual storytelling. MTRLZD offers an opportunity to turn eligible runway and campaign videos into product-discovery experiences.

Invite participating designers to explore shoppable content that can continue working beyond the physical event.$j$, $j$Invite Your Designers$j$, $j${portal}/invites$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 6, $j$signup$j$, 9, $j$always$j$, $j$Add a potential 2% affiliate revenue stream to your event$j$, $j$Hi {{FirstName}},

MTRLZD's proposed partner model gives a potential 2% affiliate commission on qualifying activity, subject to agreed terms.

Let's map your sponsors, designers, creators, and video-commerce opportunities to understand how the programme could support your event's commercial objectives.$j$, $j$Map Your Revenue Opportunities$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 7, $j$signup$j$, 12, $j$always$j$, $j$$2,000 for the Most Engaged Video, let's make it part of the show$j$, $j$Hi {{FirstName}},

MTRLZD proposes a $2,000 cash prize for the Most Engaged Video associated with your event.

Submissions open for 14 days from the festival date, followed by a 30-day active campaign to analyze eligible entries and announce the winner.$j$, $j$Plan Your $2,000 Video Competition$j$, $j${portal}$j$, $j$Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 8, $j$signup$j$, 15, $j$always$j$, $j$Your green room is a content opportunity$j$, $j$Hi {{FirstName}},

Designer interviews, backstage preparation, product details, and creator moments can all contribute to your event's interactive video programme.

Let's identify your priority filming locations, participating brands, and content permissions before the event begins.$j$, $j$Map Your Content Opportunities$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 9, $j$signup$j$, 18, $j$always$j$, $j$Give media partners a new reason to distribute your content$j$, $j$Hi {{FirstName}},

Eligible videos can be made available to participating affiliate publishers through the MTRLZD Global Video Library, subject to permissions and programme terms.

Invite your media partners to explore how they can help extend the life of your event content and create additional audience and commerce opportunities.$j$, $j$Explore Media Distribution$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 10, $j$signup$j$, 21, $j$always$j$, $j$Show sponsors how their video activation will be measured$j$, $j$Hi {{FirstName}},

Define the available engagement, video, and commerce metrics before launch so sponsors know what they'll be able to evaluate.

A clear reporting plan helps turn an exciting sponsorship into a more accountable commercial partnership.$j$, $j$Define Sponsor Reporting$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 11, $j$trial_end$j$, -4, $j$not_subscribed$j$, $j$Let's finalize your Fashion Week activation$j$, $j$Hi {{FirstName}},

Confirm your sponsors, designers, VIP creators, video deliverables, submission rules, and prize timeline.

With the right plan in place, MTRLZD can help turn your event content into an interactive experience with potential commercial value beyond the runway.$j$, $j$Finalize Your Partnership$j$, $j${portal}$j$, $j$Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$fashion_weeks$j$, 12, $j$trial_end$j$, 0, $j$not_subscribed$j$, $j${{FirstName}}, let's make this Fashion Week work harder$j$, $j$Hi {{FirstName}},

Your event has the potential to generate content, sponsor engagement, and product discovery long after the final walk.

Let's confirm the sponsorship scope and implementation schedule for {{CompanyName}}'s MTRLZD activation.$j$, $j$Confirm Your Fashion Week Partnership$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 1, $j$signup$j$, 0, $j$always$j$, $j${{FirstName}}, add $34,000 in subscription value to your festival partnership$j$, $j$Hi {{FirstName}},

MTRLZD proposes a video-commerce sponsorship designed to connect fashion filmmakers, brands, and festival audiences through interactive, shoppable entertainment.

The proposed package includes $34,000 in stated subscription value, 10 hours of marketing and messaging consulting, and a $2,000 cash prize for the Most Engaged Video, subject to agreed terms.$j$, $j$Explore Your Festival Partnership$j$, $j${portal}$j$, $j$States a dollar value for the package. Confirm it against current pricing. Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 2, $j$signup$j$, 1, $j$always$j$, $j$Give your films a life beyond the screening room$j$, $j$Hi {{FirstName}},

Your festival showcases visual storytelling. MTRLZD offers an opportunity to connect eligible films with products, participating brands, and interactive experiences.

Let's identify the films and partners best suited to your first video-commerce pilot.$j$, $j$Plan Your Festival Pilot$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 3, $j$signup$j$, 3, $j$always$j$, $j$Give your filmmakers free access to interactive video$j$, $j$Hi {{FirstName}},

Complimentary Creator Passes give eligible filmmakers a practical way to experiment with shoppable video and product tagging.

Invite your first group to upload work, explore the platform, and discover new ways to present their films to audiences and brands.$j$, $j$Activate Festival Creator Passes$j$, $j${portal}/invites$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 4, $j$signup$j$, 5, $j$always$j$, $j$Turn sponsor visibility into an interactive experience$j$, $j$Hi {{FirstName}},

Your sponsors can become part of the content experience, not just the festival branding.

MTRLZD can support participating brand activations around eligible films and product discovery. Let's align on sponsor objectives, content permissions, and reporting.$j$, $j$Design Your Sponsor Activations$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 5, $j$signup$j$, 7, $j$always$j$, $j$10 consulting hours to sharpen your festival's marketing strategy$j$, $j$Hi {{FirstName}},

Your proposed sponsorship includes 10 hours of consulting to develop your marketing and messaging strategy.

Use those hours to refine your audience proposition, filmmaker outreach, sponsor communications, submission funnel, and campaign calendar.$j$, $j$Schedule Your Strategy Session$j$, $j${portal}$j$, $j$Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 6, $j$signup$j$, 9, $j$always$j$, $j$Put $2,000 behind your festival's Most Engaged Video$j$, $j$Hi {{FirstName}},

MTRLZD proposes a $2,000 cash prize to incentivize engagement with eligible festival videos.

The submission window is 14 days from the festival date, followed by a 30-day active campaign to analyze entries and announce the winner.$j$, $j$Plan Your Video Competition$j$, $j${portal}$j$, $j$Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 7, $j$signup$j$, 12, $j$always$j$, $j$More than screenings: build a festival content programme$j$, $j$Hi {{FirstName}},

Filmmaker interviews, behind-the-scenes footage, designer conversations, and product details can all become part of your digital programme.

Invite creators to capture eligible content and explore how interactive video can extend the festival experience.$j$, $j$Build Your Creator Brief$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 8, $j$signup$j$, 15, $j$always$j$, $j$Give emerging filmmakers another reason to participate$j$, $j$Hi {{FirstName}},

Complimentary Creator Passes let eligible filmmakers test interactive video with their existing work.

Encourage participants to develop engaging content, discover product-tagging opportunities, and explore how their films could reach audiences beyond the festival.$j$, $j$Invite More Filmmakers$j$, $j${portal}/invites$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 9, $j$signup$j$, 18, $j$always$j$, $j$Let your films travel beyond your festival audience$j$, $j$Hi {{FirstName}},

Eligible videos may be discovered and redistributed by participating affiliate publishers through the MTRLZD Global Video Library, subject to permissions and programme terms.

That's another potential route to audience discovery and brand exposure for participating filmmakers.$j$, $j$Explore Video Distribution$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 10, $j$signup$j$, 21, $j$always$j$, $j$Make your $2,000 prize compelling, and transparent$j$, $j$Hi {{FirstName}},

Before announcing the Most Engaged Video competition, confirm the eligibility criteria, engagement measures, verification process, and announcement date.

Clear rules help filmmakers understand how to participate and give your festival a stronger campaign foundation.$j$, $j$Finalize Prize Criteria$j$, $j${portal}$j$, $j$Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 11, $j$trial_end$j$, -4, $j$not_subscribed$j$, $j$Your festival campaign is ready to take shape$j$, $j$Hi {{FirstName}},

Confirm Creator Pass distribution, sponsor participation, marketing assets, competition rules, and the schedule for submissions and the winner announcement.

Use the agreed consulting plan to align each communication with your audience and festival positioning.$j$, $j$Confirm Your Campaign Plan$j$, $j${portal}$j$, $j$Prize and consulting terms are a commercial offer. Confirm they're in the written agreement before this goes out automatically.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$film_festivals$j$, 12, $j$trial_end$j$, 0, $j$not_subscribed$j$, $j${{FirstName}}, let's make your festival work harder after the credits$j$, $j$Hi {{FirstName}},

Your festival can become a launchpad for filmmakers, brands, and interactive video experiences that continue beyond the screening room.

Let's finalize the sponsorship scope, Creator Pass rollout, and campaign calendar for {{CompanyName}}.$j$, $j$Confirm Festival Sponsorship$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 1, $j$signup$j$, 0, $j$always$j$, $j${{FirstName}}, your videos could be worth more than views$j$, $j$Hi {{FirstName}},

Your content already takes time, creativity, and effort. Now give it another way to work for you.

Your free 30-day MTRLZD Creator Pass includes up to 4 video uploads. Tag eligible brands, explore interactive shopping, and discover an additional 5% MTRLZD affiliate commission opportunity.

You may also qualify for $49 in platform credits for each brand you tag under the promotional terms.$j$, $j$Activate My Free Creator Pass$j$, $j${portal}$j$, $j$Promises creators an extra 5% commission. The live creator commission is 0%, so confirm the terms or take it out before switching this on. Promises $49 credit per brand tagged. Today creators earn tokens only when a brand they tagged subscribes. Confirm the wording. Says a pass includes 4 uploads. Check that matches the allowance the codes actually give.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 2, $j$signup$j$, 1, $j$no_upload$j$, $j$Your first shoppable video is closer than you think$j$, $j$Hi {{FirstName}},

You don't need to create a new campaign from scratch. Start with a fashion look, product review, beauty routine, travel video, or lifestyle feature you've already made.

Upload your first video and explore how to turn it into an interactive experience.$j$, $j$Upload My First Video$j$, $j${upload}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 3, $j$signup$j$, 2, $j$always$j$, $j$Tag a brand. Unlock your $49 credit opportunity.$j$, $j$Hi {{FirstName}},

Your videos can do more than tell a story, they can help audiences discover the products featured in them.

Tag a qualifying brand and explore the $49 platform credit offer for each eligible brand under the current promotion's terms.$j$, $j$Tag My First Brand$j$, $j${upload}$j$, $j$Promises $49 credit per brand tagged. Today creators earn tokens only when a brand they tagged subscribes. Confirm the wording.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 4, $j$signup$j$, 4, $j$always$j$, $j$Make your videos shoppable without losing your creative style$j$, $j$Hi {{FirstName}},

MTRLZD connects storytelling with product discovery. Add relevant products to eligible videos so viewers can explore what they see without relying solely on captions or separate links.

Keep the creative yours, and make the shopping experience part of the story.$j$, $j$Make My Video Shoppable$j$, $j${upload}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 5, $j$signup$j$, 6, $j$always$j$, $j$An additional 5% affiliate commission opportunity$j$, $j$Hi {{FirstName}},

Your existing brand relationships can remain part of your strategy.

Eligible creators can earn an additional 5% MTRLZD affiliate commission alongside existing brand payouts, according to the applicable programme terms. Explore the available brands, qualifying products, and commission conditions.$j$, $j$Explore Affiliate Earnings$j$, $j${portal}$j$, $j$Promises creators an extra 5% commission. The live creator commission is 0%, so confirm the terms or take it out before switching this on.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 6, $j$signup$j$, 8, $j$under_2_uploads$j$, $j$You've got 4 uploads. Let's make the most of them.$j$, $j$Hi {{FirstName}},

Your 30-day Creator Pass includes up to 4 video uploads. Test a product review, a styling video, a tutorial, or another format that suits your audience.

Each upload gives you another opportunity to explore interactive storytelling and product discovery.$j$, $j$Upload My Next Video$j$, $j${upload}$j$, $j$Says a pass includes 4 uploads. Check that matches the allowance the codes actually give.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 7, $j$signup$j$, 11, $j$always$j$, $j$Your next audience might come from a publisher$j$, $j$Hi {{FirstName}},

Through the MTRLZD Global Video Library, eligible videos may be discovered and redistributed by participating affiliate publishers, subject to permissions and programme terms.

That's another potential route to new viewers, subscribers, brand opportunities, and affiliate earnings.$j$, $j$Explore Publisher Visibility$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 8, $j$signup$j$, 14, $j$needs_feature$j$, $j$New challenge. Fresh content. More opportunities.$j$, $j$Hi {{FirstName}},

MTRLZD's monthly Creator Challenges give you a reason to try something new, showcase your creative style, and participate in brand-led content opportunities.

Check the current challenge, submission criteria, and deadline to see if it's a fit.$j$, $j$Join This Month's Challenge$j$, $j${portal}$j$, $j$Creator Challenges don't exist in the app yet, so this one stays paused. Edit it to be about something else, or leave it until challenges are built.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 9, $j$signup$j$, 17, $j$always$j$, $j$What does your audience want to see next?$j$, $j$Hi {{FirstName}},

Try a different product presentation, storytelling style, or call to action. Where alternate versions and engagement reporting are supported, use the results to guide your next video.

Your next upload can be an experiment, not just another post.$j$, $j$Plan My Next Video$j$, $j${upload}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 10, $j$signup$j$, 21, $j$always$j$, $j$Build a video portfolio brands can discover$j$, $j$Hi {{FirstName}},

Your MTRLZD content can help demonstrate your creative style and product storytelling to participating brands.

Review your uploads and focus on the categories that best fit your audience. Then explore opportunities to develop your next brand collaboration.$j$, $j$Build My Creator Portfolio$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 11, $j$trial_end$j$, -4, $j$not_subscribed$j$, $j$Don't let your last trial week go to waste$j$, $j$Hi {{FirstName}},

Your complimentary 30-day Pass is nearing its end. Use any remaining uploads to test products, tag eligible brands, and explore the platform's available creator opportunities.

Make your final trial days count.$j$, $j$Use My Remaining Uploads$j$, $j${upload}$j$, $j$Says a pass includes 4 uploads. Check that matches the allowance the codes actually give.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$creators$j$, 12, $j$trial_end$j$, 0, $j$not_subscribed$j$, $j${{FirstName}}, keep your next earning opportunity in motion$j$, $j$Hi {{FirstName}},

Your free Creator Pass is ending. Review your videos, tagged brands, and available activity data to decide how you want to continue.

If interactive video is helping you develop your content and explore additional brand opportunities, choose an available plan and keep creating.$j$, $j$Continue With MTRLZD$j$, $j${plans}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 1, $j$signup$j$, 0, $j$always$j$, $j${{FirstName}}, your $1,739 Brand Pass package is waiting$j$, $j$Hi {{FirstName}},

What if your existing videos could become a new route to product discovery and sales?

Your complimentary 30-day MTRLZD Brand Pass includes 4 video uploads and 10 Creator Passes, with a stated combined value of $1,739.

Create interactive, shoppable video experiences, bring creators into your campaign, and explore a new way to connect content with commerce.$j$, $j$Activate My Brand Pass$j$, $j${portal}$j$, $j$States a dollar value for the package. Confirm it against current pricing. Says a pass includes 4 uploads. Check that matches the allowance the codes actually give.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 2, $j$signup$j$, 1, $j$no_upload$j$, $j$Start with 1 product video, and make it shoppable$j$, $j$Hi {{FirstName}},

You don't need an entirely new campaign to get started.

Choose an existing product demonstration, campaign film, or creator video. Upload it to MTRLZD and explore how to turn the content into an interactive shopping experience.$j$, $j$Upload My First Brand Video$j$, $j${upload}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 3, $j$signup$j$, 2, $j$no_products$j$, $j$Connect your inventory. Unlock product tagging.$j$, $j$Hi {{FirstName}},

Your product catalogue is the foundation of a useful shopping experience.

Review the available inventory integration options and ensure your relevant products are ready for tagging. Then start building an interactive video around the products you want customers to discover.$j$, $j$Connect My Product Inventory$j$, $j$/brand/inventory$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 4, $j$signup$j$, 4, $j$always$j$, $j$Turn video views into product discovery opportunities$j$, $j$Hi {{FirstName}},

MTRLZD connects eligible video content with interactive product discovery and in-video shopping.

Publish your first shoppable video across supported e-commerce experiences, websites, or Substack publications, and explore how content can become a more direct route to your products.$j$, $j$Publish My First Shoppable Video$j$, $j${upload}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 5, $j$signup$j$, 6, $j$always$j$, $j$Your existing influencer programme can work harder$j$, $j$Hi {{FirstName}},

You may already have the creators, the products, and the affiliate programme. MTRLZD gives you an opportunity to connect those elements through interactive video.

Explore integrating your existing influencer programme, including eligible creator relationships and commission arrangements.$j$, $j$Integrate My Influencer Programme$j$, $j${portal}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 6, $j$signup$j$, 8, $j$always$j$, $j$Know which videos and creators deserve more investment$j$, $j$Hi {{FirstName}},

MTRLZD's brand dashboard is designed to help you review available post activity, engagement, revenue, and top-performing videos and creators.

Use those insights to identify promising content, refine your creator strategy, and inform where your next campaign investment should go.$j$, $j$Explore My Brand Dashboard$j$, $j${portal}/analytics$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 7, $j$signup$j$, 10, $j$no_invites_sent$j$, $j$Your 10 Creator Passes could kick-start a new campaign$j$, $j$Hi {{FirstName}},

Your Brand Pass includes 10 Creator Passes. Invite creators who already understand your products and audience to explore interactive video.

Give them a clear brief, select eligible products, and use the first cohort to test creator-led product storytelling.$j$, $j$Invite My First 10 Creators$j$, $j${portal}/invites$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 8, $j$signup$j$, 13, $j$needs_feature$j$, $j$Test a different ending. Discover a different response.$j$, $j$Hi {{FirstName}},

Could a different product presentation or campaign ending change how your audience responds?

Where your implementation supports alternate versions, test creative variations against a clear hypothesis and review the engagement data available to your team.$j$, $j$Plan My Creative Test$j$, $j${portal}$j$, $j$Choose-your-ending video (alternate endings) isn't something the app can do yet. Paused until it can, or edit it to be about something else.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 9, $j$signup$j$, 16, $j$needs_feature$j$, $j$Give your influencers a reason to create every month$j$, $j$Hi {{FirstName}},

MTRLZD's monthly Creator Challenges give brands a repeatable way to encourage new videos featuring their products.

Build a brief around a launch, seasonal collection, or signature product, with clear submission criteria and appropriate creator incentives.$j$, $j$Explore This Month's Challenge$j$, $j${portal}$j$, $j$Creator Challenges don't exist in the app yet, so this one stays paused. Edit it to be about something else, or leave it until challenges are built.$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 10, $j$signup$j$, 20, $j$always$j$, $j$Let your best videos find new audiences$j$, $j$Hi {{FirstName}},

Eligible videos may be discovered and redistributed through participating affiliate publishers in the MTRLZD Global Video Library, subject to permissions and programme terms.

This offers another potential route to brand visibility, qualified traffic, sales leads, and additional revenue opportunities.$j$, $j$Explore Publisher Distribution$j$, $j${portal}/library$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 11, $j$trial_end$j$, -5, $j$not_subscribed$j$, $j$What has your first month revealed about your video strategy?$j$, $j$Hi {{FirstName}},

Review your published videos, creator participation, product tagging, and available engagement and revenue data.

Identify what worked, which creators you want to develop, and what you'd change in your next campaign. The stated marketplace fee is 15% for transactions using MTRLZD's in-video shopping marketplace; review the applicable terms as you evaluate the commercial opportunity.$j$, $j$Review My Campaign Activity$j$, $j${portal}/analytics$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path, review_note) VALUES ($j$brands$j$, 12, $j$trial_end$j$, 0, $j$not_subscribed$j$, $j${{FirstName}}, ready to turn your trial into a growth channel?$j$, $j$Hi {{FirstName}},

Your complimentary Brand Pass is approaching its end. You've had the opportunity to explore interactive video, product tagging, creator invitations, and your brand's video-commerce workflow.

Continue with an available plan to build on what you've learned and develop your next campaign.$j$, $j$Continue With MTRLZD$j$, $j${plans}$j$, NULL) ON CONFLICT (segment, position) DO NOTHING;
