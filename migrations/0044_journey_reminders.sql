-- The three emails quoted on 22 Oct that the doc didn't include (23 Oct 2026):
--   * a nudge after 2 days without visiting, one per journey (repeats only
--     after the person came back and drifted off again, at most weekly);
--   * a creator reminder when a video is uploaded but no brand is tagged.
-- The brand accept/decline note is sent when the brand answers, not here.
-- Like everything else in the journeys, these only go once a journey is on.

INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$creators$j$, 13, $j$inactive$j$, 2, $j$always$j$, $j${{FirstName}}, pick up where you left off$j$, $j$Hi {{FirstName}},

It's been a couple of days since you last stopped by MTRLZD, so here's a quick nudge.

Upload a video and tag the brands in it, and it becomes shoppable wherever it's shared.

If something got in the way, the Help page in your dashboard has quick answers.$j$, $j$Open My Dashboard$j$, $j${portal}$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$brands$j$, 13, $j$inactive$j$, 2, $j$always$j$, $j${{FirstName}}, pick up where you left off$j$, $j$Hi {{FirstName}},

It's been a couple of days since you last stopped by MTRLZD, so here's a quick nudge.

Upload a product video or invite your creators, and every view becomes a way to shop.

If something got in the way, the Help page in your dashboard has quick answers.$j$, $j$Open My Dashboard$j$, $j${portal}$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$publishers$j$, 13, $j$inactive$j$, 2, $j$always$j$, $j${{FirstName}}, pick up where you left off$j$, $j$Hi {{FirstName}},

It's been a couple of days since you last stopped by MTRLZD, so here's a quick nudge.

Browse the Video Library and add shoppable videos to your pages, and earn on the sales they bring in.

If something got in the way, the Help page in your dashboard has quick answers.$j$, $j$Open My Dashboard$j$, $j${portal}$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$talent_agencies$j$, 13, $j$inactive$j$, 2, $j$always$j$, $j${{FirstName}}, pick up where you left off$j$, $j$Hi {{FirstName}},

It's been a couple of days since you last stopped by MTRLZD, so here's a quick nudge.

Share your Creator Passes and see who has joined, and what they've uploaded, from your dashboard.

If something got in the way, the Help page in your dashboard has quick answers.$j$, $j$Open My Dashboard$j$, $j${portal}$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$brand_agencies$j$, 13, $j$inactive$j$, 2, $j$always$j$, $j${{FirstName}}, pick up where you left off$j$, $j$Hi {{FirstName}},

It's been a couple of days since you last stopped by MTRLZD, so here's a quick nudge.

Pick one client and one video to start with, and see how interactive shopping performs.

If something got in the way, the Help page in your dashboard has quick answers.$j$, $j$Open My Dashboard$j$, $j${portal}$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$fashion_weeks$j$, 13, $j$inactive$j$, 2, $j$always$j$, $j${{FirstName}}, pick up where you left off$j$, $j$Hi {{FirstName}},

It's been a couple of days since you last stopped by MTRLZD, so here's a quick nudge.

Share your codes with designers and creators, and see who has joined from your dashboard.

If something got in the way, the Help page in your dashboard has quick answers.$j$, $j$Open My Dashboard$j$, $j${portal}$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$film_festivals$j$, 13, $j$inactive$j$, 2, $j$always$j$, $j${{FirstName}}, pick up where you left off$j$, $j$Hi {{FirstName}},

It's been a couple of days since you last stopped by MTRLZD, so here's a quick nudge.

Share your codes with filmmakers and partners, and see who has joined from your dashboard.

If something got in the way, the Help page in your dashboard has quick answers.$j$, $j$Open My Dashboard$j$, $j${portal}$j$) ON CONFLICT (segment, position) DO NOTHING;
INSERT INTO email_journey_steps (segment, position, anchor, day, condition, subject, body, cta_label, cta_path) VALUES ($j$creators$j$, 14, $j$signup$j$, 3, $j$uploaded_not_tagged$j$, $j$Your video is up. Now make it shoppable$j$, $j$Hi {{FirstName}},

Your video is on MTRLZD. Nice work.

One step left: tag the brands that appear in it. Tagging is what lets viewers shop the products they see, and it's how those brands find you.

It takes about a minute per video.$j$, $j$Tag the Brands in My Video$j$, $j${upload}$j$) ON CONFLICT (segment, position) DO NOTHING;
