-- ============================================================================
-- 0022 — The rest of the carousel styling controls
--
-- WHAT THE CLIENT ASKED FOR, verbatim:
--   "Must also include Carousel background color, opacity slider,
--    button-background color, button text color, Brand title color, product
--    title color, button corners, carousel corners, button-background color on
--    hover, opacity slider."
--   "Options must include 'Enable Commerce' or 'Disable Commerce' with a Radio
--    selection."
--
-- Of that list, only the button colour, button text colour, carousel corners
-- and the carousel opacity existed. The rest are added here.
--
-- WHY EACH ONE MATTERS, rather than being a preference
--   carousel_background_color  The panel was hard-coded black at whatever
--                              opacity was set. A brand could colour the button
--                              and nothing else, so every carousel on the
--                              platform looked the same.
--   button_corner_radius       ONE radius drove the panel AND the button. A
--                              square panel forced square buttons; a pill
--                              button forced a pill panel. They are different
--                              decisions and now have different columns.
--   brand_title_color          Both inherited the theme's white. White text is
--   product_title_color        legible on a dark panel and invisible on a pale
--                              one — so the moment the panel became colourable,
--                              these had to be too.
--   button_hover_color         Requested explicitly.
--   button_opacity             The second "opacity slider" in her list; the
--                              first is the existing carousel opacity.
--   commerce_enabled           Disabled, the viewer gets a product list at the
--                              end of playback instead of an overlay during it.
--
-- NULLABLE, WITH NO DEFAULT, DELIBERATELY
--   Every column here is nullable and defaults to NULL rather than to a value.
--   A default would silently restyle every carousel already published the
--   moment this migration ran. NULL means "not chosen", the renderer keeps its
--   existing behaviour, and a brand's carousel changes only when someone
--   actually changes it.
--
--   On video_carousel_overrides, NULL additionally carries its established
--   meaning in that table: inherit from the brand kit. The client wants to
--   restyle one video for a season without disturbing the other thirty.
-- ============================================================================

ALTER TABLE brand_kits
  ADD COLUMN IF NOT EXISTS default_carousel_background_color  TEXT,
  ADD COLUMN IF NOT EXISTS default_button_corner_radius       INTEGER,
  ADD COLUMN IF NOT EXISTS default_brand_title_color          TEXT,
  ADD COLUMN IF NOT EXISTS default_product_title_color        TEXT,
  ADD COLUMN IF NOT EXISTS default_button_hover_color         TEXT,
  ADD COLUMN IF NOT EXISTS default_button_opacity             INTEGER,
  ADD COLUMN IF NOT EXISTS default_commerce_enabled           BOOLEAN;

ALTER TABLE video_carousel_overrides
  ADD COLUMN IF NOT EXISTS carousel_background_color  TEXT,
  ADD COLUMN IF NOT EXISTS button_corner_radius       INTEGER,
  ADD COLUMN IF NOT EXISTS brand_title_color          TEXT,
  ADD COLUMN IF NOT EXISTS product_title_color        TEXT,
  ADD COLUMN IF NOT EXISTS button_hover_color         TEXT,
  ADD COLUMN IF NOT EXISTS button_opacity             INTEGER,
  ADD COLUMN IF NOT EXISTS commerce_enabled           BOOLEAN;
