-- "Show Brand" separate from "Show Title", and a carousel width (client, 10 Nov 2026).
-- NULL inherits, as with every other carousel column. Anyone who had switched
-- the title off had the brand line off too (one toggle drove both), so that is
-- copied across: their carousels look the same after this as before.
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS default_show_brand boolean;
ALTER TABLE brand_kits ADD COLUMN IF NOT EXISTS default_carousel_width integer;
ALTER TABLE video_carousel_overrides ADD COLUMN IF NOT EXISTS show_brand boolean;
ALTER TABLE video_carousel_overrides ADD COLUMN IF NOT EXISTS carousel_width integer;
UPDATE brand_kits SET default_show_brand = false WHERE default_show_title = false AND default_show_brand IS NULL;
UPDATE video_carousel_overrides SET show_brand = false WHERE show_title = false AND show_brand IS NULL;
