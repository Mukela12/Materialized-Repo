-- Where each account came from (25 Oct 2026). The client wants every person's
-- source (Google Ads, Paris Creator Week, Agency A...) and, for the Most
-- Engaged Video competition, engagement compared by source.
--
-- Partner and event codes already say where someone came from (voucher
-- partner). These columns add the rest: the ad or campaign link that first
-- brought them to the site, captured in the browser and sent with sign-up.
ALTER TABLE users ADD COLUMN IF NOT EXISTS signup_utm_source text,
  ADD COLUMN IF NOT EXISTS signup_utm_medium text,
  ADD COLUMN IF NOT EXISTS signup_utm_campaign text,
  ADD COLUMN IF NOT EXISTS signup_referrer text;
