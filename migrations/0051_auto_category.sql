-- migrate:no-transaction
-- Auto category (4 Nov 2026): the client asked for Auto in the video library next to
-- Fashion, Travel and Skincare. `ALTER TYPE ... ADD VALUE` runs outside a transaction
-- (see 0007); IF NOT EXISTS keeps a re-run harmless.
ALTER TYPE video_category ADD VALUE IF NOT EXISTS 'auto';
