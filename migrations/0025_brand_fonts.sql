-- ============================================================================
-- 0025 — Uploaded brand fonts
--
-- THE CLIENT: "Font upload must allow for the .otf or .ttf"
--
-- Until now a font was one of twelve built-ins, or a NAME typed into the brand
-- kit and looked up on Google Fonts. A brand with its own licensed typeface —
-- which is most fashion brands — had no way to use it, and a name Google does
-- not publish fell back to system-ui silently, so the setting appeared to save
-- and changed nothing.
--
-- `id` IS THE CSS FAMILY NAME, as `custom:<id>`
--   The label a person types NEVER reaches a stylesheet. `font-family:'X'`
--   closes on an apostrophe like any other CSS string, and this rule is served
--   inside a brand's own page by the embed. So the family name in CSS is a uuid
--   we minted, and the label exists only in the app. That is also what lets
--   sanitiseSettings validate a font key structurally, without a database
--   lookup it cannot perform.
--
-- `format` IS DECIDED BY SNIFFING THE BYTES
--   Not the extension, not the Content-Type — both are chosen by whoever
--   uploads. This file is served from our domain and fetched by every visitor
--   to a brand's page, so a zip or an HTML document renamed .ttf must not be
--   storable. See sniffFontFormat in shared/brandFonts.ts.
-- ============================================================================

CREATE TABLE IF NOT EXISTS brand_fonts (
  id          VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     VARCHAR NOT NULL REFERENCES users(id),
  label       TEXT NOT NULL,
  file_url    TEXT NOT NULL,
  format      TEXT NOT NULL,
  size_bytes  INTEGER,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS brand_fonts_user_idx ON brand_fonts (user_id);
