-- Watch time (client, 16 Nov 2026): the creator dashboard's "average view
-- duration". One row per viewing per video per UTC day, raised as the viewer
-- keeps watching and capped at the video's length (server/watchTime.ts).
-- viewer_hash is a salted digest that rotates daily, never a raw IP.
CREATE TABLE IF NOT EXISTS video_watch_time (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id varchar NOT NULL REFERENCES videos(id),
  creator_id varchar REFERENCES users(id),
  viewer_hash text NOT NULL,
  seconds_watched integer NOT NULL DEFAULT 0,
  video_seconds integer,
  created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS video_watch_time_viewer_uniq ON video_watch_time (video_id, viewer_hash);
CREATE INDEX IF NOT EXISTS video_watch_time_creator_period_idx ON video_watch_time (creator_id, created_at);
