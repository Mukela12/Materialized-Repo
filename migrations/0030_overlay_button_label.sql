-- Per-product button text.
--
-- The label was a single carousel setting applied to every product in a video,
-- so a showroom listing and a pair of shoes had to share one call to action.
-- The client's example: OpenHouse should read APPLY NOW while the silver pumps
-- read BUY NOW.
--
-- NULL keeps the video-wide setting, which is what every existing overlay wants
-- and means this changes nothing until somebody types an override.
ALTER TABLE video_product_overlays ADD COLUMN IF NOT EXISTS button_label text;

COMMENT ON COLUMN video_product_overlays.button_label IS
  'Overrides the video-wide button label for this product. NULL = use the carousel setting.';
