/**
 * WINK hotels on videos (26 Nov 2026).
 *
 *   GET  /api/wink/status          is WINK set up on this server
 *   GET  /api/wink/hotels?q=       hotels for a city or hotel name (signed in)
 *   POST /api/videos/:id/hotels    put a hotel in a video's carousel (owner)
 *   GET  /api/wink/book/:urlName   the carousel button: on to WINK's booking
 *                                  page with MTRLZD's customization id
 *
 * A hotel is an ordinary carousel overlay with source "wink", so timing,
 * position, button text, click tracking and removal all work as they do for
 * products. What differs is where its fields come from: WINK, on the server,
 * never the request, the same rule inventory products follow.
 */
import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { publicOrigin } from "./publicOrigin";
import { winkConfig, winkBookingUrl, isWinkSlug, hotelOverlayFields } from "./integrations/wink/winkHotels";
import { searchWinkHotels, getWinkHotel } from "./integrations/wink/winkClient";
import { carouselPositionEnum } from "@shared/schema";

/** Searches per signed-in user per minute. A search is two calls to WINK. */
const SEARCH_LIMIT = 30;
const searchLog = new Map<string, number[]>();
function allowSearch(uid: string): boolean {
  const now = Date.now();
  const recent = (searchLog.get(uid) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= SEARCH_LIMIT) {
    searchLog.set(uid, recent);
    return false;
  }
  recent.push(now);
  searchLog.set(uid, recent);
  return true;
}

export function registerWinkRoutes(app: Express) {
  app.get("/api/wink/status", (_req, res) => {
    res.json({ enabled: winkConfig() != null });
  });

  app.get("/api/wink/hotels", async (req: Request, res: Response) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not authenticated" });
    if (!winkConfig()) return res.status(503).json({ error: "Hotel booking isn't switched on yet." });
    const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
    if (q.length < 2) return res.status(400).json({ error: "Type a city or hotel name." });
    if (!allowSearch(uid)) return res.status(429).json({ error: "Too many searches. Try again in a minute." });
    try {
      const hotels = await searchWinkHotels(q);
      res.json({ hotels });
    } catch (err) {
      console.error("[wink] hotel search failed:", (err as Error)?.message);
      res.status(502).json({ error: "Couldn't reach WINK. Try again in a moment." });
    }
  });

  app.post("/api/videos/:id/hotels", async (req: Request, res: Response) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not authenticated" });
    const video = await storage.getVideo(req.params.id);
    if (!video) return res.status(404).json({ error: "Video not found" });
    const actor = await storage.getUser(uid);
    if (!actor?.isAdmin && video.creatorId !== uid) return res.status(403).json({ error: "Forbidden" });
    if (!winkConfig()) return res.status(503).json({ error: "Hotel booking isn't switched on yet." });

    const { urlName, position, startTime, endTime } = req.body ?? {};
    if (!isWinkSlug(urlName)) return res.status(400).json({ error: "Choose a hotel from the search." });
    try {
      const hotel = await getWinkHotel(urlName);
      if (!hotel) return res.status(404).json({ error: "WINK doesn't list that hotel. Search again and pick it from the list." });

      const existing = await storage.getVideoProductOverlays(video.id);
      const fields = hotelOverlayFields(hotel, publicOrigin(req));
      if (existing.some((o) => o.source === "wink" && o.productUrl === fields.productUrl)) {
        return res.status(409).json({ error: "That hotel is already on this video." });
      }
      const start = Number(startTime);
      const end = endTime == null || endTime === "" ? null : Number(endTime);
      const overlay = await storage.createVideoProductOverlay({
        videoId: video.id,
        productId: null,
        ...fields,
        currency: "USD",
        position: (carouselPositionEnum.enumValues as readonly string[]).includes(position) ? position : "bottom",
        startTime: String(Number.isFinite(start) && start >= 0 ? start : 0),
        endTime: end != null && Number.isFinite(end) && end >= 0 ? String(end) : null,
      });
      res.status(201).json(overlay);
    } catch (err) {
      console.error("[wink] add hotel failed:", (err as Error)?.message);
      res.status(502).json({ error: "Couldn't add the hotel. Try again in a moment." });
    }
  });

  /**
   * The BOOK NOW button. Public: it is clicked by viewers on brands' sites.
   * The customization id is added here, so it never sits in a stored row.
   */
  app.get("/api/wink/book/:urlName", (req: Request, res: Response) => {
    const cfg = winkConfig();
    const slug = req.params.urlName;
    if (!cfg || !isWinkSlug(slug)) return res.status(404).send("This hotel link isn't available.");
    res.set("Cache-Control", "no-store");
    res.redirect(302, winkBookingUrl(cfg, slug));
  });
}
