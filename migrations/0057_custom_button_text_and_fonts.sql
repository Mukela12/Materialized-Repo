-- Custom text on the carousel's buy button, and the font settings that had
-- nowhere to be saved (client, 23 Nov 2026).
--
-- 1. The button text was one of eight fixed labels, held as an enum. The client
--    asked for "Custom" text of up to 9 characters, so both columns become
--    text. Every existing value is kept as it is. The app cleans what is typed
--    (shared/carousel.ts, safeButtonLabel) before it is kept and before it is
--    drawn. The old enum type is left in place, unused.
ALTER TABLE brand_kits ALTER COLUMN default_button_label DROP DEFAULT;
ALTER TABLE brand_kits ALTER COLUMN default_button_label TYPE text USING default_button_label::text;
ALTER TABLE brand_kits ALTER COLUMN default_button_label SET DEFAULT 'BUY NOW';
ALTER TABLE video_carousel_overrides ALTER COLUMN button_label TYPE text USING button_label::text;

-- 2. The title font and the three text sizes had controls in the editor and no
--    column, so they were dropped on save. A Brand Kit scan sets the title font
--    from the brand's heading font, which needs somewhere to live. NULL
--    inherits, as with every other carousel column.
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS default_title_font text;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS default_title_font_size integer;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS default_price_font_size integer;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS default_button_font_size integer;
ALTER TABLE video_carousel_overrides ADD COLUMN IF NOT EXISTS title_font text;
ALTER TABLE video_carousel_overrides ADD COLUMN IF NOT EXISTS title_font_size integer;
ALTER TABLE video_carousel_overrides ADD COLUMN IF NOT EXISTS price_font_size integer;
ALTER TABLE video_carousel_overrides ADD COLUMN IF NOT EXISTS button_font_size integer;
