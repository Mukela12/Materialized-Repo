/**
 * Seed the Global Video Library with the real videos that already exist.
 *
 * WHY THIS EXISTS
 *   `GET /api/library` returned [] in production, so the Global Video Library
 *   page showed "No Videos Available" — the first thing a client sees when they
 *   click the feature the whole marketplace is named after.
 *
 * WHAT IT DOES NOT DO
 *   It does not invent content. It lists videos that are already in the videos
 *   table, and nothing else. On 4 Aug 2026 that was four rows, of which only the
 *   two below are real creator content:
 *
 *     Finding Frida    — fashion, interior setting          LISTED
 *     Street style     — fashion, architectural setting     LISTED
 *     Summer Fashion Collection 2026 — SKIPPED. Despite the title this is a
 *                        screen recording of a browser window with tabs like
 *                        "Procurement" and "Home - Fontwerk" visible. Putting it
 *                        in front of a client under that name is worse than an
 *                        empty library.
 *     Smoke Test Video — SKIPPED. It is the landing page hero video, reused.
 *
 * NO BILLING SIDE EFFECTS
 *   Listing through the product flow costs a token. This writes the listing row
 *   directly and deliberately does NOT touch token_ledger, so it cannot move a
 *   balance or make a wallet disagree with its history. That is the right trade
 *   for demo content: the alternative, minting tokens to spend them, would put
 *   fabricated entries in an append-only ledger that is never edited.
 *
 * THUMBNAILS
 *   None of the videos had one — "Summer Fashion" had an empty string rather
 *   than NULL, which reads as present but renders as nothing. Cloudinary can
 *   render a poster frame from the video itself by swapping the extension, so
 *   the thumbnails below are derived from the video URLs already in the row.
 *   The frame for each was chosen by looking at the candidates: frame 0 for
 *   Finding Frida, and 5s in for Street style, whose opening frames are blown
 *   out to near-white.
 *
 * USAGE — prints the plan and changes nothing unless SEED_APPLY=1:
 *
 *   railway run --service Postgres -- \
 *     sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" npx tsx script/seed-library.ts'
 *
 *   railway run --service Postgres -- \
 *     sh -c 'DATABASE_URL="$DATABASE_PUBLIC_URL" SEED_APPLY=1 npx tsx script/seed-library.ts'
 *
 * Re-running is safe: a video that already has a listing is skipped, so this
 * cannot produce duplicate cards.
 */
import { db } from "../server/db";
import { sql } from "drizzle-orm";
import { LICENSE_FEE_DECIMAL } from "../shared/pricing";

interface Seed {
  videoId: string;
  /** Cloudinary transform inserted before the version segment; "" = frame 0. */
  frame: string;
  category: string;
  listingTitle: string;
  listingDescription: string;
}

/**
 * Narrow by design: only these video IDs are ever touched. Adding a video to the
 * library is a deliberate act, not something a script should decide by pattern.
 */
const SEEDS: Seed[] = [
  {
    videoId: "f22dfb0f-ed3d-4e0d-af8b-01d7e253c2cf", // Finding Frida
    frame: "",
    category: "fashion",
    listingTitle: "Finding Frida",
    listingDescription: "Editorial fashion film shot on location.",
  },
  {
    videoId: "830068a4-1a47-4a1e-85ff-3f8215939c08", // Street style
    frame: "so_5",
    category: "fashion",
    listingTitle: "Street style",
    listingDescription: "Street style feature with statement outerwear.",
  },
];

/** cloudinary .../video/upload/[transform/]v123/path.mp4 -> .../path.jpg */
function posterFrom(videoUrl: string, frame: string): string | null {
  const marker = "/video/upload/";
  const at = videoUrl.indexOf(marker);
  if (at === -1) return null;
  const head = videoUrl.slice(0, at + marker.length);
  const tail = videoUrl.slice(at + marker.length).replace(/\.[a-z0-9]+$/i, ".jpg");
  return `${head}${frame ? `${frame}/` : ""}${tail}`;
}

(async () => {
  const apply = process.env.SEED_APPLY === "1";
  console.log(apply ? "MODE: APPLY — writing changes\n" : "MODE: DRY RUN — set SEED_APPLY=1 to write\n");

  let listed = 0;
  let skipped = 0;

  for (const seed of SEEDS) {
    const { rows } = await db.execute(sql`
      select v.id, v.title, v.creator_id, v.video_url, v.thumbnail_url, v.status,
             (select count(*) from global_video_library g where g.video_id = v.id) as listing_count
      from videos v
      where v.id = ${seed.videoId}
    `);

    const video = rows[0] as any;
    if (!video) {
      console.log(`✗ ${seed.listingTitle}: video row not found (${seed.videoId}) — skipping`);
      skipped++;
      continue;
    }

    if (Number(video.listing_count) > 0) {
      console.log(`• ${seed.listingTitle}: already listed — skipping`);
      skipped++;
      continue;
    }

    const poster = posterFrom(video.video_url, seed.frame);
    if (!poster) {
      console.log(`✗ ${seed.listingTitle}: video_url is not a Cloudinary upload URL — skipping`);
      skipped++;
      continue;
    }

    // Verify the derived thumbnail actually renders before storing it. A URL that
    // 404s would leave a card with a broken image, which is worse than the
    // placeholder it replaces.
    const head = await fetch(poster, { method: "GET", headers: { Range: "bytes=0-0" } });
    const type = head.headers.get("content-type") ?? "";
    if (!head.ok || !type.startsWith("image/")) {
      console.log(`✗ ${seed.listingTitle}: poster frame not renderable (${head.status} ${type}) — skipping`);
      skipped++;
      continue;
    }

    console.log(`✓ ${seed.listingTitle}`);
    console.log(`    creator  ${video.creator_id}`);
    console.log(`    poster   ${poster}`);
    console.log(`    category ${seed.category}   fee $${LICENSE_FEE_DECIMAL}`);

    if (!apply) {
      listed++;
      continue;
    }

    // Only fill a thumbnail that is missing or empty — never overwrite one a
    // creator chose. "Summer Fashion" proved the empty-string case is real.
    await db.execute(sql`
      update videos
      set thumbnail_url = ${poster}
      where id = ${seed.videoId}
        and (thumbnail_url is null or thumbnail_url = '')
    `);

    await db.execute(sql`
      insert into global_video_library
        (video_id, creator_id, license_fee, publish_status,
         listing_title, listing_description, category, total_licenses, listed_at)
      values
        (${seed.videoId}, ${video.creator_id}, ${LICENSE_FEE_DECIMAL}, 'published',
         ${seed.listingTitle}, ${seed.listingDescription}, ${seed.category}, 0, now())
    `);

    listed++;
  }

  console.log(`\n${apply ? "listed" : "would list"}: ${listed}   skipped: ${skipped}`);

  const { rows: after } = await db.execute(sql`
    select g.listing_title, g.category, g.publish_status, u.display_name as creator,
           (v.thumbnail_url is not null and v.thumbnail_url <> '') as has_thumb
    from global_video_library g
    join videos v on v.id = g.video_id
    join users u on u.id = g.creator_id
    order by g.created_at
  `);
  console.log("\n── library now ──");
  if (after.length === 0) console.log("   (empty)");
  else console.table(after);

  await db.$client.end?.();
  process.exit(0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
