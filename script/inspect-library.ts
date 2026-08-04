/**
 * READ-ONLY snapshot of what the Global Video Library has to work with.
 *
 * Run before seeding, to see which creators and videos actually exist and which
 * of them are fit to list — a listing points at a video row and a user row, and
 * a card with no thumbnail renders as a grey box with a play icon.
 *
 *   railway run --service Postgres -- \
 *     sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx script/inspect-library.ts'
 *
 * This script writes NOTHING. Every statement is a SELECT.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";

(async () => {
  const q = async (label: string, statement: any) => {
    const { rows } = await db.execute(statement);
    console.log(`\n── ${label} ${"─".repeat(Math.max(0, 60 - label.length))}`);
    if (rows.length === 0) {
      console.log("   (none)");
      return rows;
    }
    console.table(rows);
    return rows;
  };

  await q("counts", sql`
    select
      (select count(*) from users)                 as users,
      (select count(*) from users where role = 'creator') as creators,
      (select count(*) from videos)                as videos,
      (select count(*) from global_video_library)  as listings
  `);

  await q("creators", sql`
    select id, email, display_name, role, email_verified
    from users
    where role = 'creator'
    order by created_at
    limit 20
  `);

  await q("videos (listable candidates)", sql`
    select
      v.id,
      v.creator_id,
      left(v.title, 40)                            as title,
      v.status,
      (v.thumbnail_url is not null)                as has_thumb,
      (v.video_url is not null)                    as has_video,
      exists(select 1 from global_video_library g where g.video_id = v.id) as already_listed
    from videos v
    order by v.created_at desc
    limit 30
  `);

  await q("existing listings", sql`
    select id, video_id, creator_id, license_fee, publish_status, category, total_licenses, listed_at
    from global_video_library
    order by created_at desc
    limit 30
  `);

  await q("legal category values already in use", sql`
    select distinct category from global_video_library where category is not null
  `);

  // The live DDL is not provable from migrations/ — those only reach 0009 and
  // touch global_video_library once, so the deployed columns came from a
  // drizzle-kit push at some unknown point. Read the real thing before writing.
  await q("global_video_library DDL (live)", sql`
    select column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where table_name = 'global_video_library'
    order by ordinal_position
  `);

  await q("video_publish_status enum labels (live)", sql`
    select enumlabel from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'video_publish_status'
    order by e.enumsortorder
  `);

  // Where the media actually lives decides whether a missing thumbnail can be
  // derived (Cloudinary can render a poster frame from a video) or has to be
  // uploaded by hand.
  await q("media hosts", sql`
    select id, left(title, 30) as title, video_url, thumbnail_url
    from videos
    order by created_at desc
  `);

  await db.$client.end?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
