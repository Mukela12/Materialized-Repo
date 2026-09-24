/**
 * One-off: move every Cloudinary-hosted video row to Bunny Stream.
 * Resumable — the mapping file records fetch guids and finished rows, so a
 * re-run polls rather than re-fetching. Rows are rewritten ONLY after the
 * transcode is Finished and the new URL actually serves bytes; until then a
 * row keeps its working Cloudinary URL. Originals stay on Cloudinary.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { db } from "./server/db";
import { videos } from "./shared/schema";
import { eq, sql } from "drizzle-orm";
import { bestBunnyMp4Url, bunnyThumbnailUrl, getBunnyVideo } from "./server/bunnyService";

const LIB = process.env.BUNNY_LIBRARY_ID!;
const KEY = process.env.BUNNY_STREAM_API_KEY!;
const MAP_PATH = process.argv[2];
type Entry = { guid: string; done?: boolean; failed?: string };
const map: Record<string, Entry> = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, "utf8")) : {};
const save = () => writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));

(async () => {
  const rows = await db.select().from(videos).where(sql`${videos.videoUrl} like '%cloudinary.com%'`);
  console.log(`cloudinary-hosted rows: ${rows.length}`);

  for (const row of rows) {
    if (map[row.id]) continue;
    const res = await fetch(`https://video.bunnycdn.com/library/${LIB}/videos/fetch`, {
      method: "POST",
      headers: { AccessKey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ url: row.videoUrl, title: row.title || "untitled" }),
    });
    const j: any = await res.json().catch(() => ({}));
    const guid = j.guid ?? j.id;
    if (!res.ok || !guid) { console.log(`FETCH FAILED ${row.id.slice(0,8)}: ${res.status} ${JSON.stringify(j).slice(0,150)}`); continue; }
    map[row.id] = { guid }; save();
    console.log(`fetched ${row.id.slice(0,8)} -> ${guid}`);
  }

  const deadline = Date.now() + 7.5 * 60_000;
  while (Date.now() < deadline) {
    let pending = 0;
    for (const row of rows) {
      const e = map[row.id];
      if (!e || e.done || e.failed) continue;
      const v = await getBunnyVideo(e.guid).catch(() => null);
      if (!v) { pending++; continue; }
      if (v.status === 5 || v.status === 6) { e.failed = `bunny status ${v.status}`; save(); console.log(`FAILED ${row.id.slice(0,8)}: status ${v.status}`); continue; }
      if (v.status !== 4) { pending++; continue; }
      const mp4 = bestBunnyMp4Url(v);
      if (!mp4) { e.failed = "no mp4 rendition"; save(); console.log(`FAILED ${row.id.slice(0,8)}: no rendition`); continue; }
      const probe = await fetch(mp4, { headers: { Range: "bytes=0-99" } });
      if (!(probe.status === 200 || probe.status === 206)) { pending++; console.log(`serve not ready ${row.id.slice(0,8)}: ${probe.status}`); continue; }
      await db.update(videos).set({
        videoUrl: mp4,
        thumbnailUrl: bunnyThumbnailUrl(e.guid, v.thumbnailFileName),
      }).where(eq(videos.id, row.id));
      e.done = true; save();
      console.log(`MIGRATED ${row.id.slice(0,8)} -> ${mp4.split("/").slice(-2).join("/")}`);
    }
    if (!pending) break;
    await new Promise(r => setTimeout(r, 20_000));
  }
  const done = Object.values(map).filter(e => e.done).length;
  const failed = Object.values(map).filter(e => e.failed).length;
  console.log(`summary: ${done} migrated, ${failed} failed, ${rows.length - done - failed} still transcoding`);
})().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => process.exit(0));
