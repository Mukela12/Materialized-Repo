-- Removing an uploaded font takes it out of the account's list and keeps it for
-- the videos that already use it.
--
-- The app has always said so ("Videos already published keep rendering it"),
-- and the file was kept in storage for that reason, but the row was deleted,
-- and the row is where a video's embed finds the file. So a published video
-- went back to the fallback font the moment its font was removed from the list.
-- removed_at hides the font from the list and the pickers; the embed still
-- finds it by id.
ALTER TABLE brand_fonts ADD COLUMN IF NOT EXISTS removed_at timestamp;
