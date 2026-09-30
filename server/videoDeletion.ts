/**
 * Deleting a video.
 *
 * It used to be a bare DELETE on `videos`, and almost every table that points
 * at a video refuses that, so any video with a tagged brand, an AI scan or a
 * view on record answered "Failed to delete video" (found 29 Sep 2026 while
 * recording the client's demo). Nearly every real video has at least one.
 *
 * Now, in one transaction:
 *  - A video with money on record (an order, a commission, a marketplace fee
 *    or a licence sale) is NOT deleted. Those rows are the books and must
 *    keep their video; the creator is told why.
 *  - Records that only mention the video in passing (token spends, bonuses,
 *    outreach emails, campaigns) keep themselves and let go of the video.
 *  - Everything that exists only because of the video (brand tags, AI scan
 *    results, carousel settings, overlays, library listings, embeds, its
 *    view and click events) goes with it.
 *
 * The file on the video host is left alone: retention (server/retention.ts)
 * owns storage, and two rows can share one Bunny video.
 */
import { sql } from "drizzle-orm";
import { db } from "./db";

export const VIDEO_HAS_SALES =
  "This video has sales on record, so it's kept for your accounts. You can still unpublish it.";

export type DeleteVideoResult = { deleted: true } | { deleted: false; reason: "not_found" | "has_sales" };

export async function deleteVideoCompletely(videoId: string): Promise<DeleteVideoResult> {
  return db.transaction(async (tx) => {
    const found = await tx.execute(sql`SELECT id FROM videos WHERE id = ${videoId} FOR UPDATE`);
    if (found.rows.length === 0) return { deleted: false, reason: "not_found" as const };

    const money = await tx.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM video_orders WHERE video_id = ${videoId})
        OR EXISTS (SELECT 1 FROM commission_transactions WHERE video_id = ${videoId})
        OR EXISTS (SELECT 1 FROM platform_fee_accruals WHERE video_id = ${videoId})
        OR EXISTS (SELECT 1 FROM video_license_purchases p
                   JOIN global_video_library g ON g.id = p.global_listing_id
                   WHERE g.video_id = ${videoId}) AS has_sales`);
    if ((money.rows[0] as { has_sales: boolean }).has_sales) {
      return { deleted: false, reason: "has_sales" as const };
    }

    // Keep the record, drop the link.
    await tx.execute(sql`UPDATE token_ledger SET attributed_video_id = NULL WHERE attributed_video_id = ${videoId}`);
    await tx.execute(sql`UPDATE creator_bonuses SET attributed_video_id = NULL WHERE attributed_video_id = ${videoId}`);
    await tx.execute(sql`UPDATE brand_outreach_requests SET video_id = NULL WHERE video_id = ${videoId}`);
    await tx.execute(sql`UPDATE campaigns SET video_id = NULL WHERE video_id = ${videoId}`);

    // What only existed for this video. Children before parents.
    await tx.execute(sql`DELETE FROM playlist_items WHERE listing_id IN (SELECT id FROM global_video_library WHERE video_id = ${videoId})`);
    await tx.execute(sql`DELETE FROM wishlists WHERE global_listing_id IN (SELECT id FROM global_video_library WHERE video_id = ${videoId})`);
    await tx.execute(sql`DELETE FROM global_video_library WHERE video_id = ${videoId}`);
    await tx.execute(sql`UPDATE publisher_notifications SET campaign_affiliate_id = NULL WHERE campaign_affiliate_id IN (SELECT id FROM campaign_affiliates WHERE video_id = ${videoId})`);
    await tx.execute(sql`DELETE FROM campaign_affiliates WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM video_detection_results WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM video_detection_jobs WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM video_product_overlays WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM video_carousel_overrides WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM video_brands WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM video_products WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM video_publish_records WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM embed_deployments WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM analytics_events WHERE video_id = ${videoId}`);
    await tx.execute(sql`DELETE FROM videos WHERE id = ${videoId}`);
    return { deleted: true as const };
  });
}
