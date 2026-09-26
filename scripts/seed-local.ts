/**
 * Local QA seed. Populates a LOCAL database (refuses anything that is not
 * localhost) with one account per portal and enough content that every
 * dashboard renders real-looking data at every screen size.
 *
 *   set -a; . ./.env.local; set +a; npx tsx scripts/seed-local.ts
 *
 * Accounts: creator@ / brand@ / publisher@mtrlzd.test, password from
 * LOCAL_TEST_PASSWORD in .env.local. Idempotent: re-running is a no-op.
 */
import { storage } from "../server/storage";
import { hashPassword } from "../server/auth";

const url = process.env.DATABASE_URL ?? "";
if (!/localhost|127\.0\.0\.1/.test(url)) {
  console.error("Refusing to seed a non-local database:", url.replace(/:\/\/.*@/, "://***@"));
  process.exit(1);
}

const CDN = "https://vz-97d498f7-34a.b-cdn.net";
// Real renditions from the live library (public CDN), so players actually play.
const VIDEOS = [
  { title: "Street style — Paris Edit", guid: "30879803-d8e6-4f24-abf8-b8b2f2948768", res: "720p", duration: 38, status: "published" },
  { title: "Botnari Showroom Interview", guid: "464b4f7b-7524-43be-8624-58dc78c6ed7d", res: "720p", duration: 64, status: "published" },
  { title: "Finding Frida", guid: "16549d53-f33a-4e90-8558-a4ce61715aac", res: "360p", duration: 52, status: "published" },
  { title: "Experimental Marais — an unusually long campaign title to test wrapping", guid: "1c12e096-518f-4202-92dc-312a458a008c", res: "720p", duration: 45, status: "draft" },
];
const PRODUCTS = [
  { name: "Sage Linen Blazer", price: "189.00", img: "https://images.unsplash.com/photo-1594938298603-c8148c4dae35?w=300&h=300&fit=crop" },
  { name: "Statement Ankle Boots", price: "145.00", img: "https://images.unsplash.com/photo-1601924638867-3a6de6b7a500?w=300&h=300&fit=crop" },
  { name: "Gold Hoop Earrings", price: "65.00", img: "https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?w=300&h=300&fit=crop" },
  { name: "Hand-Loomed Silk Scarf in Midnight Indigo", price: "95.00", img: null },
];

async function user(email: string, role: "creator" | "brand" | "affiliate", displayName: string) {
  const existing = await storage.getUserByEmail(email);
  if (existing) return existing;
  const u = await storage.createUser({
    username: email.split("@")[0], email, displayName, role,
    password: await hashPassword(process.env.LOCAL_TEST_PASSWORD!),
    emailVerified: true,
  } as any);
  // Paid-up, so QA sees the product itself rather than obligation banners.
  await storage.updateUser(u.id, { setupFeePaid: true, freeAccess: true, freeAccessUntil: null } as any);
  return u;
}

(async () => {
  const creator = await user("creator@mtrlzd.test", "creator", "Miro Misljen");
  const brandUser = await user("brand@mtrlzd.test", "brand", "Maison Demo");
  await user("publisher@mtrlzd.test", "affiliate", "Vogue Weekend Edit");

  const existingBrands = await storage.getBrands();
  let brand = existingBrands.find((b: any) => b.name === "Maison Demo");
  if (!brand) {
    brand = await storage.createBrand({
      name: "Maison Demo", website: "https://www.one30m.group", category: "Fashion",
      description: "Ethical luxury ready-to-wear.", ownerId: brandUser.id, isActive: true,
    } as any);
  }

  const existingProducts = (await storage.getProducts(brand!.id)) as any[];
  const products = existingProducts.length ? existingProducts : await Promise.all(PRODUCTS.map(p =>
    storage.createProduct({
      brandId: brand!.id, name: p.name, price: p.price, imageUrl: p.img,
      productUrl: "https://www.one30m.group/", isActive: true,
    } as any)));

  const mine = await storage.getVideos(creator.id);
  for (const v of VIDEOS) {
    if (mine.some((m: any) => m.title === v.title)) continue;
    const video = await storage.createVideo({
      creatorId: creator.id, title: v.title, status: v.status as any,
      videoUrl: `${CDN}/${v.guid}/play_${v.res}.mp4`,
      thumbnailUrl: `${CDN}/${v.guid}/thumbnail.jpg`,
      durationSeconds: v.duration,
      description: "Seeded for local UI QA.",
    } as any);
    await storage.addVideoBrand({ videoId: video.id, brandId: brand!.id });
    for (const [i, p] of products.slice(0, 3).entries()) {
      await storage.createVideoProductOverlay({
        videoId: video.id, productId: p.id, name: p.name, price: String(p.price),
        imageUrl: p.imageUrl, productUrl: p.productUrl, brandName: "Maison Demo",
        position: "bottom", startTime: String(i * 4), endTime: "999",
      } as any);
    }
  }
  console.log("seeded: 3 portal accounts, 1 brand,", products.length, "products,", VIDEOS.length, "videos");
})().catch(e => { console.error("SEED FAILED:", e.message); process.exit(1); }).finally(() => process.exit(0));
