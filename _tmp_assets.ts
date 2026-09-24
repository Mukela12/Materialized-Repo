/** Marketing/landing videos → Bunny, independent of any DB row. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { bestBunnyMp4Url, getBunnyVideo } from "./server/bunnyService";
const LIB = process.env.BUNNY_LIBRARY_ID!;
const KEY = process.env.BUNNY_STREAM_API_KEY!;
const URLS = [
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609692/materialized/landing/hero-video.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609709/materialized/landing/discovery-packs.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609713/materialized/landing/vertical-demo.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609784/materialized/public/street-style-ss26.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1784819097/materialized/landing/mtrlzd-video-banner.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609824/materialized/public/miro-misljen-dress.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609801/materialized/public/vessels-jetski.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1784819059/materialized/landing/miro-misljen-black-dress.mp4",
  "https://res.cloudinary.com/dvj7ayoot/video/upload/v1775609780/materialized/public/croissant-demo.mp4",
];
const MAP_PATH = process.argv[2];
const map: Record<string, { guid: string; mp4?: string }> = existsSync(MAP_PATH) ? JSON.parse(readFileSync(MAP_PATH, "utf8")) : {};
const save = () => writeFileSync(MAP_PATH, JSON.stringify(map, null, 2));
(async () => {
  for (const url of URLS) {
    if (map[url]) continue;
    const name = "landing: " + url.split("/").pop();
    const res = await fetch(`https://video.bunnycdn.com/library/${LIB}/videos/fetch`, {
      method: "POST", headers: { AccessKey: KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ url, title: name }),
    });
    const j: any = await res.json().catch(() => ({}));
    const guid = j.guid ?? j.id;
    if (!res.ok || !guid) { console.log(`FETCH FAILED ${name}: ${res.status}`); continue; }
    map[url] = { guid }; save();
    console.log(`fetched ${name} -> ${guid}`);
  }
  const deadline = Date.now() + 8 * 60_000;
  while (Date.now() < deadline) {
    let pending = 0;
    for (const url of URLS) {
      const e = map[url];
      if (!e || e.mp4) continue;
      const v = await getBunnyVideo(e.guid).catch(() => null);
      if (!v || v.status !== 4) { pending++; continue; }
      const mp4 = bestBunnyMp4Url(v);
      if (!mp4) { console.log(`NO RENDITION for ${url.split("/").pop()}`); pending++; continue; }
      const probe = await fetch(mp4, { headers: { Range: "bytes=0-99" } });
      if (!(probe.status === 200 || probe.status === 206)) { pending++; continue; }
      e.mp4 = mp4; save();
      console.log(`READY ${url.split("/").pop()} -> ${mp4}`);
    }
    if (!pending) break;
    await new Promise(r => setTimeout(r, 20_000));
  }
  console.log("done:", Object.values(map).filter(e => e.mp4).length, "/", URLS.length);
})().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => process.exit(0));
