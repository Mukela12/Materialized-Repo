-- ============================================================================
-- 0023 — The frame a playlist's videos are viewed in
--
-- THE CLIENT, verbatim:
--   "Playlist Styling refers to the box in which one or several videos are
--    viewed in. There should be basic options here to Add Border (1pt - 5pt),
--    Color Border, Corners, Show Frame/Hide Frame (radio selection), Show Play
--    Button/Automatic Playback, Play Button color, size, opacity. Show
--    Audio/Hide Audio, Audio Icon/Mute Icon color, size, opacity. Add Logo,
--    Logo position (top left, top middle, top right, bottom left, bottom
--    middle, bottom right, watermark bottom left, watermark bottom right,
--    watermark top left / top right."
--
-- None of it existed. Worth recording WHY nobody noticed: the script that
-- draws a playlist embed, /embed/playlist.js, had never been written, and the
-- embed code handed to publishers pointed at "https://your-app.replit.dev" —
-- a placeholder left over from the Replit build. So every published playlist
-- embed was requesting a non-existent script from a domain we do not own.
-- There was no rendered playlist anywhere for the missing styling to show up
-- as missing on.
--
-- NULLABLE, NO DEFAULTS
--   Same reasoning as 0022: a default would restyle every already-published
--   playlist the moment this ran. NULL means "not chosen" and the renderer
--   keeps its existing look, which the defaults in shared/playlistStyle.ts
--   deliberately reproduce.
-- ============================================================================

ALTER TABLE playlists
  ADD COLUMN IF NOT EXISTS frame_show           BOOLEAN,
  ADD COLUMN IF NOT EXISTS frame_border_width   INTEGER,
  ADD COLUMN IF NOT EXISTS frame_border_color   TEXT,
  ADD COLUMN IF NOT EXISTS frame_corner_radius  INTEGER,
  ADD COLUMN IF NOT EXISTS play_autoplay        BOOLEAN,
  ADD COLUMN IF NOT EXISTS play_button_color    TEXT,
  ADD COLUMN IF NOT EXISTS play_button_size     INTEGER,
  ADD COLUMN IF NOT EXISTS play_button_opacity  INTEGER,
  ADD COLUMN IF NOT EXISTS audio_show           BOOLEAN,
  ADD COLUMN IF NOT EXISTS audio_icon_color     TEXT,
  ADD COLUMN IF NOT EXISTS audio_icon_size      INTEGER,
  ADD COLUMN IF NOT EXISTS audio_icon_opacity   INTEGER,
  ADD COLUMN IF NOT EXISTS logo_url             TEXT,
  ADD COLUMN IF NOT EXISTS logo_position        TEXT;
