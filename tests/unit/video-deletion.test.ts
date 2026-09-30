/**
 * Deleting a video (30 Sep 2026). It was a bare DELETE that every table
 * pointing at the video refused, so any video with a tagged brand, an AI scan
 * or a view answered "Failed to delete video". These pin that every such
 * table is handled, that money is never deleted, and that the UI asks first.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(__dirname, "../..", p), "utf8");
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const del = code("server/videoDeletion.ts");

/** Every table in the schema with a column that references videos.id. */
function tablesReferencingVideos(): string[] {
  const schema = read("shared/schema.ts");
  const out: string[] = [];
  const re = /pgTable\("([a-z_]+)",\s*\{([\s\S]*?)\n\}\)?/g;
  for (let m; (m = re.exec(schema)); ) if (/references\(\(\) => videos\.id/.test(m[2])) out.push(m[1]);
  return out;
}

describe("deleting a video", () => {
  it("handles every table that points at a video", () => {
    const tables = tablesReferencingVideos();
    expect(tables.length).toBeGreaterThan(10);
    for (const t of tables) expect(del, t).toMatch(new RegExp(`\\b${t}\\b`));
  });

  it("refuses when there is money on record, before touching anything", () => {
    const guard = del.indexOf("has_sales\" as const");
    const firstWrite = del.search(/(UPDATE|DELETE FROM) /);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstWrite);
    for (const t of ["video_orders", "commission_transactions", "platform_fee_accruals", "video_license_purchases"]) {
      expect(del.slice(0, guard), t).toMatch(new RegExp(`FROM ${t}`));
      expect(del, t).not.toMatch(new RegExp(`DELETE FROM ${t}\\b`));
    }
  });

  it("keeps ledger and outreach records, letting go of the video", () => {
    for (const t of ["token_ledger", "creator_bonuses", "brand_outreach_requests", "campaigns"]) {
      expect(del).toMatch(new RegExp(`UPDATE ${t} SET \\w+ = NULL`));
      expect(del).not.toMatch(new RegExp(`DELETE FROM ${t}\\b`));
    }
  });

  it("runs as one transaction and deletes the video last", () => {
    expect(del).toMatch(/return db\.transaction\(async \(tx\) =>/);
    expect(del).toMatch(/FOR UPDATE/);
    const deletes = [...del.matchAll(/DELETE FROM (\w+)/g)].map((m) => m[1]);
    expect(deletes[deletes.length - 1]).toBe("videos");
  });

  it("the route says why a video with sales is kept (409), not a generic failure", () => {
    const routes = code("server/routes.ts");
    const h = routes.slice(routes.indexOf('app.delete("/api/videos/:id"'), routes.indexOf("REFERRAL ROUTES"));
    expect(h).toMatch(/deleteVideoCompletely\(req\.params\.id\)/);
    expect(h).toMatch(/res\.status\(409\)\.json\(\{ error: VIDEO_HAS_SALES/);
    expect(h).toMatch(/existing\.creatorId !== sessionUserId/);
  });

  it("My Campaigns asks before deleting and shows the server's reason", () => {
    const page = code("client/src/pages/my-videos.tsx");
    expect(page).toMatch(/const handleDelete\s+= \(video: VideoType\) => setDeleting\(video\);/);
    expect(page).toMatch(/data-testid="dialog-delete-video"/);
    expect(page).toMatch(/serverMessage\(err\)/);
  });
});
