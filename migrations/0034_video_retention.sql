-- Video retention: record that a file was reclaimed, without losing the video.
--
-- The client wanted files deleted at expiry to cap storage cost; she also
-- decided earlier that a lapsed account keeps its profile and videos so it can
-- reactivate by paying. Both hold if the FILE goes and the RECORD stays: the
-- account still shows what it had, the title, the products, the analytics, and
-- can be brought back by re-uploading rather than starting from nothing.
--
-- videos.video_url is NOT NULL and stays that way — the stored URL is kept as
-- the record of what was deleted. media_deleted_at is the flag every playback
-- and listing path checks; status moves to 'archived' at the same time so
-- nothing tries to serve a file that is no longer there.
ALTER TABLE videos ADD COLUMN IF NOT EXISTS media_deleted_at timestamp;

-- The retention sweep asks for "videos whose media is still present", which is
-- almost every row, so the index is partial: it stays small and only carries
-- the rows the job must consider.
CREATE INDEX IF NOT EXISTS videos_media_present_idx
  ON videos (creator_id)
  WHERE media_deleted_at IS NULL;
