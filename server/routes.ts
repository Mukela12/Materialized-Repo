import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { sanitizeUser, toPublicBrand } from "./serializers";
import { viewerHash, isUniqueViolation } from "./viewerIdentity";
import { canAccessUserResource } from "./authz";
import { randomBytes } from "crypto";
import { encryptSecret, decryptSecret } from "./crypto";
import { hashPassword } from "./auth";
import { recordSaleCommissions, clawbackSaleCommissions } from "./commissions";
import { recordFeeAccrual, voidFeeAccrual } from "./feeAccruals";
import { generateFeeInvoice, finalizeFeeInvoice } from "./feeInvoicing";
import { quoteCheckout, checkoutIdempotencyKey, parsePriceToCents } from "./inVideoCheckout";
import { checkRedeemable, grantsOf, normaliseCode, generateVoucherCode, mintCodes, MAX_BATCH } from "./vouchers";
import { videoDeliveryUrl } from "@shared/videoDelivery";
import { feeInvoiceStripeAdapter } from "./feeInvoiceStripe";


import { appendUtm } from "./embedUtils";
import { resolveFeeConfig, userRateOr, centsToAmount, formatMoney, getPlatformCurrency } from "./feeConfig";
import { buildNotifications, countUnread, parseMailboxId, type MailboxSources } from "./mailbox";
import { LICENSE_FEE, LICENSE_FEE_PER_VIDEO, tokensForFee } from "@shared/pricing";
import { isPlaylistLocked, playlistLockedMessage } from "@shared/playlists";
import {
  spendTokens, creditTokens, revokeTokens, summarizeLedger, ledgerRowValues,
} from "./wallet";
import { applyTokenSubsidy } from "./subscriptionSubsidy";
import { runPayouts } from "./payoutRunner";
import { schedulerEnabled } from "./scheduledJobs";
import { verifyStoreHmac, extractShopifyAttribution, extractWooAttribution, type OrderAttribution } from "./storeWebhooks";
import { 
  insertVideoSchema, 
  insertBrandReferralSchema, 
  insertBrandSchema, 
  insertProductSchema, 
  insertAnalyticsEventSchema, 
  insertCreatorInvitationSchema,
  insertAffiliateInvitationSchema,
  insertCampaignAffiliateSchema,
  insertGlobalVideoLibrarySchema,
  insertVideoLicensePurchaseSchema,
  insertVideoPublishRecordSchema,
  insertSubscriberIntakeSchema,
  insertUserProfileSchema,
  insertCreatorRewardSchema,
  insertBrandOutreachSchema,
  insertBrandSubscriptionSchema,
  insertBrandBillingRecordSchema,
  insertBrandPayoutMethodSchema,
  insertBrandBillingProfileSchema,
  insertBrandApiKeySchema,
  insertPlaylistSchema,
  VIDEO_CATEGORY_OPTIONS,
} from "@shared/schema";
import { z } from "zod";
import {
  sendBrandOutreachEmail,
  sendBrandAgreementEmail,
  sendDocuSignReminderEmail,
  sendVideoResultsExcitementEmail,
  sendGlobalPitchEmail,
  sendSubscriptionNudgeEmail,
  sendContactEnquiryEmail,
  sendCreatorInvitationEmail,
  sendAffiliateInvitationEmail,
  sendReferralEmail,
  sendPayoutExecutedEmail,
  sendCommissionApprovedEmail,
  isEmailConfigured,
} from "./emailService";
import { setupPdfAnalysisRoutes } from "./replit_integrations/pdf_analysis";
import { ai, batchAnalyzeFrames, consolidateDetections, type ProductInfo } from "./replit_integrations/detection/client";
import { detectAiGeneratedContent } from "./replit_integrations/detection/aiContentDetector";
import { sampleVideoFrames } from "./frameSampler";
// Object storage removed — using Cloudinary instead
import type Stripe from "stripe";
import { stripeService, PLAN_CONFIG, PLAN_KEYS, isPlanKey, isAllowedPlan, BRAND_PLANS, CREATOR_PLANS, isEligibleForIntroOffer, setupFeeMajor, TRIAL_DAYS, type PlanKey } from "./stripeService";
import { getStripePublishableKey, getUncachableStripeClient } from "./stripeClient";
import { dispatchStripeEvent } from "./webhookHandlers";
import { resolveSigningUrl } from "./docusignHelper";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ==================== AI/PDF ANALYSIS ROUTES ====================
  setupPdfAnalysisRoutes(app);

  // ==================== AI DETECTION ROUTES ====================
  /**
   * REMOVED: registerDetectionRoutes — POST /api/detection/analyze-frames and
   * POST /api/detection/analyze-image.
   *
   * Both were live in production with NO authentication of any kind: no session
   * check, no subscription gate, no rate limit beyond the global one. Each
   * accepted an arbitrary-length array of images and turned every one into a
   * paid Gemini vision call on the platform's account. Verified reachable on
   * 3 Aug 2026 — an empty body returned 400 "No frames provided", i.e. the
   * route was registered and would have proceeded to the model with real input.
   *
   * No client code ever called them. They were dead code that was still
   * deployed and open, so this is a deletion rather than an auth fix — the
   * sibling route that does the same work (POST /api/videos/:id/detections)
   * is session-guarded and is the one the product actually uses.
   *
   * The underlying detection functions are untouched: server/replit_integrations/
   * detection/client.ts is still imported by the real path.
   */

  // ==================== OBJECT STORAGE ROUTES ====================
  // Object storage removed — using Cloudinary instead

  // ==================== USER ROUTES ====================
  
  // Get current user (demo user for now)
  app.get("/api/users/me", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      res.json(sanitizeUser(user));
    } catch (error) {
      res.status(500).json({ error: "Failed to get user" });
    }
  });

  // Trial status — is the user on free trial, and have they used it?
  app.get("/api/users/me/trial-status", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "Not authenticated" });

      const sub = await storage.getBrandSubscription(user.id);
      const hasActiveSubscription = user.isAdmin || !!user.freeAccess || !!(sub && (sub.status === "active" || sub.status === "trialing"));
      const videoCount = await storage.getVideoCountByUser(user.id);

      res.json({
        hasActiveSubscription,
        videoCount,
        isTrialExhausted: !hasActiveSubscription && videoCount >= 1,
        trialVideosAllowed: user.isAdmin ? 99999 : 1,
        trialMaxDurationSeconds: user.isAdmin ? 99999 : 120,
        // Whether to OFFER the intro deal. Presentation only — the checkout route
        // re-decides this from the same rule and is the actual gate, so a client
        // that ignores this flag gets a 409 rather than a free trial.
        eligibleForIntroOffer: isEligibleForIntroOffer(sub),
        introOfferSetupFee: setupFeeMajor(),
        introOfferTrialDays: TRIAL_DAYS,
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to get trial status" });
    }
  });

  // ─── Creator Subscription (mirrors brand subscription flow) ──────────────────

  // Creator subscription checkout
  // Sells CREATOR_PLANS only (see shared/plans.ts — `plan` gates no entitlement,
  // so this allowlist is what stops cross-tier underpayment).
  app.post("/api/creator/subscription/checkout", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { plan } = req.body;
      // Permissive: legacy creators hold 'starter'/'pro' and must still transact.
      if (!isAllowedPlan(plan, CREATOR_PLANS)) {
        return res.status(400).json({ error: `Plan must be one of: ${CREATOR_PLANS.join(", ")}` });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user.email ?? "", userId, user.name ?? undefined);
        customerId = customer.id;
        await storage.updateUser(userId, { stripeCustomerId: customerId });
      }

      const origin = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
      const successUrl = `${origin}/creator/settings/subscription?checkout=success`;
      const cancelUrl = `${origin}/creator/settings/subscription?checkout=cancelled`;

      /**
       * The onboarding offer: pay the setup fee once, then TRIAL_DAYS before the
       * first monthly charge.
       *
       * ELIGIBILITY IS DECIDED HERE, NOT BY THE CALLER. `withTrial` is a request,
       * not an instruction. Without a server-side check, a creator could cancel
       * and re-run this endpoint every month and hold the product indefinitely
       * for the setup fee instead of the monthly price — cheaper than the plan,
       * repeatable forever, and invisible in the subscription table because the
       * row is upserted rather than appended.
       *
       * "Never subscribed" is the test, and `brand_subscriptions.userId` being
       * unique is what makes it reliable: cancelling UPDATES the row's status
       * rather than deleting it (storage.upsertBrandSubscription), so the row's
       * mere existence is a durable record that this user has transacted before,
       * whatever state they are in now.
       *
       * The setup fee is never waived here. Comped accounts are a decision for an
       * admin, and a creator must not be able to zero their own fee by posting a
       * flag — stripeService.createTrialWithSetupFeeCheckout takes waiveSetupFee
       * for that future admin-driven path, and this route always leaves it false.
       */
      const session = await (async () => {
        if (req.body?.withTrial !== true) {
          return stripeService.createSubscriptionCheckout(
            customerId, plan, successUrl, cancelUrl, { userId, plan },
          );
        }

        const priorSubscription = await storage.getBrandSubscription(userId);
        if (!isEligibleForIntroOffer(priorSubscription)) {
          return null;
        }

        return stripeService.createTrialWithSetupFeeCheckout(
          customerId, plan, successUrl, cancelUrl, { userId, plan, offer: "trial" },
        );
      })();

      if (!session) {
        return res.status(409).json({
          error: "The introductory offer is for first-time subscribers only.",
          code: "TRIAL_NOT_ELIGIBLE",
        });
      }

      res.json({ url: session.url, sessionId: session.id });
    } catch (e: any) {
      console.error("Creator checkout error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to create checkout session" });
    }
  });

  // Creator billing portal
  /**
   * REMOVED (pre-live): POST /api/creator/subscription/surplus-invoice
   *                     POST /api/brand/subscription/surplus-invoice
   *
   * Both took `totalAmount` straight from the request body, validated it only as
   * `> 0`, and passed it to a charge_automatically invoice that was finalised
   * immediately. The rates behind that number lived exclusively in two client
   * files, so the amount the platform charged was decided entirely by the
   * caller's browser. Under a test key that was a curiosity; under a live key it
   * is a route where the customer sets their own bill.
   *
   * There was also no idempotency key on the path, so a double click raised two
   * invoices.
   *
   * The sliders that drove these remain, relabelled as an estimator — the maths
   * is useful as a sales tool, it simply must not reach Stripe. Overage will be
   * billed server-side from recorded usage, priced from rates held in the
   * database, and attached to the subscription's own invoice. See the overage
   * scope; stripeService.createSurplusInvoice is kept for that work.
   */

  app.post("/api/creator/subscription/portal", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const user = await storage.getUser(userId);
      if (!user?.stripeCustomerId) {
        return res.status(400).json({ error: "No billing account on file. Please subscribe first." });
      }

      const origin = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
      const portal = await stripeService.createBillingPortal(
        user.stripeCustomerId,
        `${origin}/creator/settings/subscription`,
      );

      res.json({ url: portal.url });
    } catch (e: any) {
      console.error("Creator portal error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to open billing portal" });
    }
  });

  // Creator surplus invoice

  // ==================== BRAND ROUTES ====================
  
  // Get all brands
  app.get("/api/brands", async (req, res) => {
    try {
      const brands = await storage.getBrands();
      res.json(brands.map(toPublicBrand));
    } catch (error) {
      res.status(500).json({ error: "Failed to get brands" });
    }
  });

  // Get single brand
  app.get("/api/brands/:id", async (req, res) => {
    try {
      const brand = await storage.getBrand(req.params.id);
      if (!brand) {
        return res.status(404).json({ error: "Brand not found" });
      }
      res.json(toPublicBrand(brand));
    } catch (error) {
      res.status(500).json({ error: "Failed to get brand" });
    }
  });

  // Create brand
  app.post("/api/brands", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const actor = await storage.getUser(sessionUserId);
      // A created brand is owned by its creator; only an admin may set a different
      // owner. This makes the brand/product/campaign ownership gates meaningful.
      const data = insertBrandSchema.parse({
        ...req.body,
        ownerId: actor?.isAdmin && req.body?.ownerId ? req.body.ownerId : sessionUserId,
      });
      const brand = await storage.createBrand(data);
      res.status(201).json(brand);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create brand" });
    }
  });

  // ==================== PRODUCT ROUTES ====================

  /**
   * Is a brand's INVENTORY discoverable to other users?
   *
   * Client rule (28 Jul 2026): "their inventory is discoverable while tag a brand
   * is selected from the drop-down list" — i.e. any brand can be TAGGED whether or
   * not it subscribes (that is the acquisition funnel: tag -> $29 setup + 30-day
   * trial -> subscribe), but its products only become available to creators once
   * the brand is subscribed. Subscribing is what makes a brand's videos shoppable.
   *
   * 'active' covers Stripe's `trialing` too (see mapStripeStatus), so a brand in
   * its 30-day trial is discoverable — which is the point of the trial.
   *
   * This gates DISCOVERY only. Already-published videos are unaffected: the public
   * embed renders stored video_product_overlays rows, never a live product query,
   * so a lapsed subscription cannot retroactively break a creator's live video or
   * their tracked sales.
   */
  async function isBrandInventoryDiscoverable(brandId: string): Promise<boolean> {
    const brand = await storage.getBrand(brandId);
    if (!brand) return false;

    // (a) Admin-granted window. Checked FIRST and independently of ownership: the
    // whole point is to switch on a brand that has accepted and paid the $29 but
    // has no subscription — and possibly no owner account yet. Compared at read
    // time, so the window self-expires with no scheduler.
    if (brand.inventoryAccessUntil && brand.inventoryAccessUntil.getTime() > Date.now()) {
      return true;
    }

    // (b) Active subscription. Unchanged.
    if (!brand.ownerId) return false;
    const sub = await storage.getBrandSubscription(brand.ownerId);
    return sub?.status === "active";
  }

  // Get products (optionally by brand). A caller may always see their OWN brand's
  // inventory; another brand's inventory requires that brand to be subscribed.
  app.get("/api/products", async (req, res) => {
    try {
      const brandId = req.query.brandId as string | undefined;
      const products = await storage.getProducts(brandId);

      const sessionUserId = (req.session as any)?.userId;
      const actor = sessionUserId ? await storage.getUser(sessionUserId) : null;
      if (actor?.isAdmin) return res.json(products);

      // Filter to brands whose inventory this caller may discover. Cached per
      // brand so a mixed list costs one lookup per brand, not one per product.
      const allowed = new Map<string, boolean>();
      const visible: typeof products = [];
      for (const p of products) {
        const bid = p.brandId;
        if (!bid) continue;
        if (!allowed.has(bid)) {
          const brand = await storage.getBrand(bid);
          const isOwner = !!sessionUserId && brand?.ownerId === sessionUserId;
          allowed.set(bid, isOwner || (await isBrandInventoryDiscoverable(bid)));
        }
        if (allowed.get(bid)) visible.push(p);
      }
      res.json(visible);
    } catch (error) {
      res.status(500).json({ error: "Failed to get products" });
    }
  });

  // Create product
  app.post("/api/products", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      let { brandId, price, ...rest } = req.body;
      // Resolve brandId — prefer explicit, else the caller's own brand (not an
      // arbitrary first brand, which would let anyone add products to it).
      const brands = await storage.getBrands();
      const actor = await storage.getUser(sessionUserId);
      if (!brandId) brandId = brands.find(b => b.ownerId === sessionUserId)?.id;
      if (!brandId) return res.status(400).json({ error: "No brand available" });
      const targetBrand = brands.find(b => b.id === brandId);
      if (!targetBrand) return res.status(404).json({ error: "Brand not found" });
      if (!actor?.isAdmin && targetBrand.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      // Drizzle decimal columns are validated as strings by drizzle-zod
      const priceStr = price !== undefined && price !== null ? String(price) : undefined;
      const data = insertProductSchema.parse({ ...rest, brandId, price: priceStr });
      const product = await storage.createProduct(data);
      res.status(201).json(product);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create product error:", error);
      res.status(500).json({ error: "Failed to create product" });
    }
  });

  // Update a product (owner brand or admin only)
  app.patch("/api/products/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const product = await storage.getProduct(req.params.id);
      if (!product) return res.status(404).json({ error: "Product not found" });
      const actor = await storage.getUser(sessionUserId);
      const brand = (await storage.getBrands()).find((b) => b.id === product.brandId);
      if (!actor?.isAdmin && brand?.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const editable = ["name", "description", "price", "imageUrl", "productUrl", "productType", "sku", "category", "isActive"];
      const patch: Record<string, any> = {};
      for (const k of editable) if (k in req.body) patch[k] = req.body[k];
      if (patch.price !== undefined && patch.price !== null) patch.price = String(patch.price);
      const updated = await storage.updateProduct(req.params.id, patch);
      res.json(updated);
    } catch (error) {
      console.error("Update product error:", error);
      res.status(500).json({ error: "Failed to update product" });
    }
  });

  // Delete a product (owner brand or admin only)
  app.delete("/api/products/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const product = await storage.getProduct(req.params.id);
      if (!product) return res.status(404).json({ error: "Product not found" });
      const actor = await storage.getUser(sessionUserId);
      const brand = (await storage.getBrands()).find((b) => b.id === product.brandId);
      if (!actor?.isAdmin && brand?.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await storage.deleteProduct(req.params.id);
      res.json({ success: true });
    } catch (error) {
      console.error("Delete product error:", error);
      res.status(500).json({ error: "Failed to delete product" });
    }
  });

  // ==================== VIDEO ROUTES ====================

  // Get videos for current user
  app.get("/api/videos", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const videos = await storage.getVideos(user.id);
      res.json(videos);
    } catch (error) {
      res.status(500).json({ error: "Failed to get videos" });
    }
  });

  // Get all published videos (global library)
  app.get("/api/videos/library", async (req, res) => {
    try {
      const videos = await storage.getAllPublishedVideos();
      res.json(videos);
    } catch (error) {
      res.status(500).json({ error: "Failed to get library videos" });
    }
  });

  // Get single video
  app.get("/api/videos/:id", async (req, res) => {
    try {
      const video = await storage.getVideo(req.params.id);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.json(video);
    } catch (error) {
      res.status(500).json({ error: "Failed to get video" });
    }
  });

  // Create video
  app.post("/api/videos", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);

      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      // ─── Trial enforcement ─────────────────────────────────────────────────
      const sub = await storage.getBrandSubscription(user.id);
      const hasActiveSubscription = user.isAdmin || !!user.freeAccess || !!(sub && (sub.status === "active" || sub.status === "trialing"));

      if (!hasActiveSubscription) {
        const videoCount = await storage.getVideoCountByUser(user.id);
        if (videoCount >= 1) {
          return res.status(403).json({
            error: "TRIAL_EXHAUSTED",
            message:
              "Your free trial allows 1 video upload. Subscribe to a paid plan to upload more videos and unlock unlimited campaigns, analytics, and affiliate payouts.",
          });
        }

        // Duration check for trial videos (max 2 minutes)
        const durationSeconds = req.body.durationSeconds ?? null;
        if (durationSeconds !== null && durationSeconds > 120) {
          return res.status(400).json({
            error: "TRIAL_DURATION_EXCEEDED",
            message:
              "Trial videos are limited to 2 minutes. Please trim your video or subscribe to a paid plan to upload longer videos.",
          });
        }
      }
      // ──────────────────────────────────────────────────────────────────────

      const { brandIds, ...videoData } = req.body;
      const isTrial = !hasActiveSubscription;

      const data = insertVideoSchema.parse({
        ...videoData,
        creatorId: user.id,
        isTrial,
      });
      
      const video = await storage.createVideo(data);

      // Add brand associations
      if (brandIds && Array.isArray(brandIds)) {
        for (const brandId of brandIds) {
          await storage.addVideoBrand({
            videoId: video.id,
            brandId,
          });
        }
      }

      // Update video status to published after a delay (simulating processing)
      setTimeout(async () => {
        await storage.updateVideo(video.id, { status: "published" } as any);
      }, 3000);

      res.status(201).json(video);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create video" });
    }
  });

  // Update video
  app.patch("/api/videos/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const existing = await storage.getVideo(req.params.id);
      if (!existing) return res.status(404).json({ error: "Video not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && existing.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      /**
       * Explicit allowlist. This previously passed req.body straight into
       * storage.updateVideo, which does db.update(videos).set(data) with no
       * whitelist and no parse — so once past the ownership check above, a
       * creator could write ANY column on their own video row:
       *
       *   creatorId      — hand the video to another account
       *   totalViews / totalClicks / totalRevenue — fabricate their own stats
       *   isTrial        — escape trial accounting
       *   utmCode        — retarget attribution
       *
       * Only the fields the UI actually sends are accepted: VideoDetailSheet
       * sends title/description/categories/thumbnailUrl, and VideoUploadModal
       * sends status/carouselSettings. Unknown keys are dropped by zod rather
       * than reaching the database.
       *
       * `status` is constrained to the two values a creator may legitimately
       * choose; "processing" is server-set and deliberately not offered.
       */
      const videoPatchSchema = z.object({
        title: z.string().min(1).max(300).optional(),
        description: z.string().max(5000).optional(),
        categories: z.string().max(2000).optional(),
        thumbnailUrl: z.string().max(2000).optional(),
        status: z.enum(["draft", "published"]).optional(),
        carouselSettings: z.string().max(20000).optional(),
      });

      const patch = videoPatchSchema.parse(req.body ?? {});
      if (Object.keys(patch).length === 0) {
        return res.status(400).json({ error: "No updatable fields supplied" });
      }

      const video = await storage.updateVideo(req.params.id, patch);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.json(video);
    } catch (error) {
      res.status(500).json({ error: "Failed to update video" });
    }
  });

  // Delete video
  app.delete("/api/videos/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const existing = await storage.getVideo(req.params.id);
      if (!existing) return res.status(404).json({ error: "Video not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && existing.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const deleted = await storage.deleteVideo(req.params.id);
      if (!deleted) {
        return res.status(404).json({ error: "Video not found" });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete video" });
    }
  });

  // ==================== REFERRAL ROUTES ====================
  
  // Get referrals for current user
  app.get("/api/referrals", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const referrals = await storage.getReferrals(user.id);
      res.json(referrals);
    } catch (error) {
      res.status(500).json({ error: "Failed to get referrals" });
    }
  });

  // Create referral
  app.post("/api/referrals", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const data = insertBrandReferralSchema.parse({
        ...req.body,
        creatorId: user.id,
      });
      
      const referral = await storage.createReferral(data);

      // Send the referral email to the brand's PR contact, then mark it "sent".
      if (isEmailConfigured()) {
        try {
          const signupUrl = `${req.protocol}://${req.get("host")}/register?ref=${referral.signupToken}`;
          await sendReferralEmail({
            prContactName: referral.prContactName,
            prContactEmail: referral.prContactEmail,
            creatorDisplayName: user.displayName,
            brandName: referral.brandName,
            message: referral.message,
            signupUrl,
          });
          await storage.updateReferralStatus(referral.id, "sent");
        } catch (emailErr) {
          console.error("Referral email failed:", emailErr);
        }
      }

      res.status(201).json(referral);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create referral" });
    }
  });

  // Submit a brand referral from the brand dashboard (same store as /api/referrals)
  app.post("/api/brand-referrals", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const data = insertBrandReferralSchema.parse({ ...req.body, creatorId: user.id });
      const referral = await storage.createReferral(data);

      // Send the referral email to the brand's PR contact, then mark it "sent".
      if (isEmailConfigured()) {
        try {
          const signupUrl = `${req.protocol}://${req.get("host")}/register?ref=${referral.signupToken}`;
          await sendReferralEmail({
            prContactName: referral.prContactName,
            prContactEmail: referral.prContactEmail,
            creatorDisplayName: user.displayName,
            brandName: referral.brandName,
            message: referral.message,
            signupUrl,
          });
          await storage.updateReferralStatus(referral.id, "sent");
        } catch (emailErr) {
          console.error("Brand referral email failed:", emailErr);
        }
      }

      res.status(201).json(referral);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Create brand referral error:", error);
      res.status(500).json({ error: "Failed to create brand referral" });
    }
  });

  // Resend a referral email (owner creator or admin only)
  app.post("/api/referrals/:id/resend", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const referral = await storage.getReferral(req.params.id);
      if (!referral) return res.status(404).json({ error: "Referral not found" });
      // getReferral is not scoped by creator, so enforce ownership here.
      if (!user.isAdmin && referral.creatorId !== user.id) {
        return res.status(403).json({ error: "Forbidden" });
      }

      if (!isEmailConfigured()) {
        return res.status(503).json({ error: "Email is not configured" });
      }

      const signupUrl = `${req.protocol}://${req.get("host")}/register?ref=${referral.signupToken}`;
      await sendReferralEmail({
        prContactName: referral.prContactName,
        prContactEmail: referral.prContactEmail,
        creatorDisplayName: user.displayName,
        brandName: referral.brandName,
        message: referral.message,
        signupUrl,
      });
      await storage.updateReferralStatus(referral.id, "sent");

      res.json({ success: true });
    } catch (error) {
      console.error("Resend referral error:", error);
      res.status(500).json({ error: "Failed to resend referral" });
    }
  });

  // ==================== BRAND OUTREACH ROUTES ====================

  // Create brand outreach (creator sends email to brand PR contact)
  app.post("/api/brand-outreach", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const data = insertBrandOutreachSchema.parse({
        ...req.body,
        creatorId: user.id,
      });

      const outreach = await storage.createBrandOutreach(data);

      const baseUrl = `${req.protocol}://${req.get("host")}`;
      const authorizeUrl = `${baseUrl}/brand-authorize/${outreach.authToken}`;
      const videoPreviewUrl = data.videoUrl
        ? `${baseUrl}/creator/my-videos`
        : `${baseUrl}/creator/my-videos`;

      if (isEmailConfigured()) {
        await sendBrandOutreachEmail({
          prContactName: outreach.prContactName,
          prContactEmail: outreach.prContactEmail,
          creatorDisplayName: user.displayName,
          brandName: outreach.brandName,
          videoTitle: outreach.videoTitle ?? "Video Preview",
          videoPreviewUrl,
          authorizeUrl,
          creatorMessage: outreach.creatorMessage ?? undefined,
        });
        await storage.updateBrandOutreachStatus(outreach.id, "email_sent");
      } else {
        console.warn("[Brand Outreach] Email not configured. Set RESEND_API_KEY env var.");
        await storage.updateBrandOutreachStatus(outreach.id, "email_sent");
      }

      res.status(201).json({ ...outreach, authorizeUrl });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("[Brand Outreach] Failed:", error);
      res.status(500).json({ error: "Failed to send brand outreach" });
    }
  });

  // Get outreach requests for the current creator
  app.get("/api/brand-outreach", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const outreaches = await storage.getBrandOutreachesByCreator(user.id);
      res.json(outreaches);
    } catch (error) {
      res.status(500).json({ error: "Failed to get outreach requests" });
    }
  });

  // Public: get outreach details by auth token (brand PR contact's view)
  app.get("/api/brand-outreach/authorize/:token", async (req, res) => {
    try {
      const outreach = await storage.getBrandOutreachByToken(req.params.token);
      if (!outreach) return res.status(404).json({ error: "Outreach request not found" });
      if (outreach.status === "authorized" || outreach.status === "agreement_sent" || outreach.status === "completed") {
        return res.status(410).json({ error: "This link has already been used", status: outreach.status });
      }
      // Return safe subset
      res.json({
        id: outreach.id,
        brandName: outreach.brandName,
        prContactName: outreach.prContactName,
        videoTitle: outreach.videoTitle,
        videoUrl: outreach.videoUrl,
        creatorMessage: outreach.creatorMessage,
        status: outreach.status,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get outreach details" });
    }
  });

  // Public: brand PR contact clicks "Let's Do This!" — authorize and send DocuSign email
  app.post("/api/brand-outreach/authorize/:token", async (req, res) => {
    try {
      const outreach = await storage.getBrandOutreachByToken(req.params.token);
      if (!outreach) return res.status(404).json({ error: "Outreach request not found" });
      if (outreach.status !== "pending" && outreach.status !== "email_sent") {
        return res.status(410).json({ error: "This link has already been used" });
      }

      await storage.updateBrandOutreachStatus(outreach.id, "authorized", new Date());

      const creator = await storage.getUser(outreach.creatorId);
      const embedCode = `<script src="https://embed.join.materialized.com/player.js" data-video="${outreach.videoId ?? "pending"}" data-brand="${outreach.brandName}"></script>`;
      // When DOCUSIGN_* is unset this returns the exact static fallback
      // (process.env.DOCUSIGN_SIGNING_URL ?? "https://app.docusign.com/templates");
      // when configured it mints a real embedded-signing envelope URL. Never throws.
      const signCompleteUrl = `${req.protocol}://${req.get("host")}/brand-outreach/signed/${outreach.id}`;
      const docuSignUrl = await resolveSigningUrl(outreach, signCompleteUrl);

      if (isEmailConfigured()) {
        await sendBrandAgreementEmail({
          prContactName: outreach.prContactName,
          prContactEmail: outreach.prContactEmail,
          creatorDisplayName: creator?.displayName ?? "The creator",
          brandName: outreach.brandName,
          videoTitle: outreach.videoTitle ?? "Video",
          docuSignUrl,
          embedCode,
        });
        await storage.updateBrandOutreachStatus(outreach.id, "agreement_sent");
      } else {
        await storage.updateBrandOutreachStatus(outreach.id, "agreement_sent");
      }

      res.json({ success: true, message: "Authorization received. Agreement email sent." });
    } catch (error) {
      console.error("[Brand Outreach Authorize] Failed:", error);
      res.status(500).json({ error: "Failed to authorize outreach" });
    }
  });

  // ==================== ANALYTICS ROUTES ====================
  
  // Get stats overview
  app.get("/api/analytics/stats", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const stats = await storage.getVideoStats(user.id);
      const charityContribution = Number(user.charityContribution || 0);
      
      res.json({
        ...stats,
        charityContribution,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get stats" });
    }
  });

  // Get detailed analytics
  app.get("/api/analytics/detailed", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const stats = await storage.getVideoStats(user.id);

      // Scope all detailed aggregations to this creator's videos.
      const creatorVideos = await storage.getVideos(user.id);
      const creatorVideoIds = creatorVideos.map((v) => v.id);
      const scope = { type: "creator" as const, videoIds: creatorVideoIds };

      const { viewsByDay, viewsByHour } = await storage.getAnalyticsTimeSeries(scope);
      const topCountries = await storage.getAnalyticsGeo(scope);
      const deviceBreakdown = await storage.getAnalyticsDevices(scope);

      // Real sales metrics from verified purchase events.
      const totalClicksNum = stats.totalClicks || 0;
      const { salesVolumeUnits, salesVolumeValue } = await storage.getAnalyticsSalesStats(scope);
      const averageSpend = salesVolumeUnits > 0 ? +(salesVolumeValue / salesVolumeUnits).toFixed(2) : 0;
      const salesConversionRate = totalClicksNum > 0 ? +((salesVolumeUnits / totalClicksNum) * 100).toFixed(1) : 0;

      // Get real embed deployment data for this creator's videos
      const userVideos = creatorVideos;
      const realEmbedTraces: any[] = [];
      for (const video of userVideos.slice(0, 10)) {
        const deployments = await storage.getEmbedDeploymentsByAffiliate(video.creatorId);
        for (const d of deployments) {
          if (d.videoId === video.id) {
            realEmbedTraces.push({
              utmCode: d.utmCode || "",
              videoTitle: video.title,
              publisherName: "",
              referrerDomain: d.referrerDomain || "",
              referrerUrl: d.referrerUrl || "",
              totalLoads: d.totalLoads || 0,
              totalClicks: 0,
              totalConversions: 0,
              revenue: 0,
            });
          }
        }
      }

      res.json({
        ...stats,
        topCountries,
        deviceBreakdown,
        viewsByDay,
        viewsByHour,
        averageSpend,
        salesConversionRate,
        salesVolumeUnits,
        salesVolumeValue,
        embedTraces: realEmbedTraces,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get detailed analytics" });
    }
  });

  // Get brand analytics (all videos featuring brand products, with embed traces)
  app.get("/api/analytics/brand-detailed", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Brand aggregations run platform-wide (unscoped) to stay internally
      // consistent with the brandViewStats block below. Proper per-brand scoping
      // is a separate correctness fix.
      const scope = { type: "brand" as const };
      const { viewsByDay, viewsByHour } = await storage.getAnalyticsTimeSeries(scope);
      const topCountries = await storage.getAnalyticsGeo(scope);
      const deviceBreakdown = await storage.getAnalyticsDevices(scope);

      // Get real brand stats from analytics
      const { db } = await import("./db");
      const { analyticsEvents: ae } = await import("@shared/schema");
      const { sql: sqlFn } = await import("drizzle-orm");
      const [brandViewStats] = await db.select({
        totalViews: sqlFn<number>`COALESCE(COUNT(CASE WHEN ${ae.eventType} = 'view' THEN 1 END), 0)::int`,
        totalClicks: sqlFn<number>`COALESCE(COUNT(CASE WHEN ${ae.eventType} = 'click' THEN 1 END), 0)::int`,
        totalRevenue: sqlFn<number>`COALESCE(SUM(CASE WHEN ${ae.eventType} = 'purchase' THEN ${ae.revenue}::numeric ELSE 0 END), 0)::float`,
      }).from(ae);

      const totalViews = brandViewStats?.totalViews ?? 0;
      const totalClicks = brandViewStats?.totalClicks ?? 0;
      const totalRevenue = brandViewStats?.totalRevenue ?? 0;
      const { salesVolumeUnits, salesVolumeValue } = await storage.getAnalyticsSalesStats(scope);
      const averageSpend = salesVolumeUnits > 0 ? +(salesVolumeValue / salesVolumeUnits).toFixed(2) : 0;
      const salesConversionRate = totalClicks > 0 ? +((salesVolumeUnits / totalClicks) * 100).toFixed(1) : 0;

      res.json({
        totalViews,
        totalClicks,
        totalRevenue,
        averageCTR: totalViews > 0 ? +((totalClicks / totalViews) * 100).toFixed(2) : 0,
        topCountries,
        deviceBreakdown,
        viewsByDay,
        viewsByHour,
        averageSpend,
        salesConversionRate,
        salesVolumeUnits,
        salesVolumeValue,
        embedTraces: [],
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get brand analytics" });
    }
  });

  // Get publisher/affiliate analytics (only their embed codes, not total audience)
  app.get("/api/analytics/publisher-detailed", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      // Scope all publisher aggregations to this affiliate's events only.
      const scope = { type: "publisher" as const, affiliateId: user.id };
      const { viewsByDay, viewsByHour } = await storage.getAnalyticsTimeSeries(scope);
      const topCountries = await storage.getAnalyticsGeo(scope);
      const deviceBreakdown = await storage.getAnalyticsDevices(scope);

      // Get real embed deployment data for this publisher
      const deployments = await storage.getEmbedDeploymentsByAffiliate(user.id);
      const earnings = await storage.getAffiliateEarningsFromLedger(user.id);
      const myCampaigns = await storage.getCampaignAffiliatesByUser(user.id);

      const embedTraces = deployments.map(d => ({
        utmCode: d.utmCode || "",
        videoTitle: "",
        publisherName: user.displayName,
        referrerDomain: d.referrerDomain || "",
        referrerUrl: d.referrerUrl || "",
        totalLoads: d.totalLoads || 0,
        totalClicks: 0,
        totalConversions: 0,
        revenue: 0,
      }));

      // Aggregate from campaign affiliates for real stats
      const myTotalViews = myCampaigns.reduce((s, c) => s + (c.totalClicks || 0), 0) + deployments.reduce((s, d) => s + (d.totalLoads || 0), 0);
      const myTotalClicks = myCampaigns.reduce((s, c) => s + (c.totalClicks || 0), 0);
      const myTotalRevenue = earnings.totalCommission || 0;
      const myTotalConversions = myCampaigns.reduce((s, c) => s + (c.totalConversions || 0), 0);
      const averageSpend = myTotalConversions > 0 ? +(myTotalRevenue / myTotalConversions).toFixed(2) : 0;
      const salesConversionRate = myTotalClicks > 0 ? +((myTotalConversions / myTotalClicks) * 100).toFixed(1) : 0;

      res.json({
        totalViews: myTotalViews,
        totalClicks: myTotalClicks,
        totalRevenue: myTotalRevenue,
        averageCTR: myTotalViews > 0 ? +((myTotalClicks / myTotalViews) * 100).toFixed(2) : 0,
        topCountries,
        deviceBreakdown,
        viewsByDay,
        viewsByHour,
        averageSpend,
        salesConversionRate,
        salesVolumeUnits: myTotalConversions,
        salesVolumeValue: myTotalRevenue,
        embedTraces,
        isPublisherView: true,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get publisher analytics" });
    }
  });

  // Track analytics event
/**
   * What POST /api/analytics/events accepts from an unauthenticated caller.
   *
   * Matches exactly what the two deployed embed players send — videoId,
   * eventType, utmCode, referrerDomain (see the widget scripts at the bottom of
   * this file) — plus productId, which the carousel sends on a click.
   *
   * Everything else about an event is decided by the server: the creator comes
   * from the video, geo and device from the request, the affiliate from a utm
   * code that must match the video, and the viewer hash from the connection.
   *
   * eventType is an enum here because the column is plain text with no CHECK
   * constraint, so this is the only thing standing between the dashboards and
   * arbitrary event types.
   */
  const analyticsIngestSchema = z.object({
    videoId: z.string().min(1),
    eventType: z.enum(["view", "click", "purchase"]),
    productId: z.string().min(1).optional(),
    utmCode: z.string().max(200).optional(),
    referrerDomain: z.string().max(253).optional(),
  });
  app.post("/api/analytics/events", async (req, res) => {
    try {
      /**
       * Narrow, explicit input — NOT the table's insert schema.
       *
       * This endpoint is unauthenticated by necessity: it is called by embed
       * scripts running on third-party sites that have no session. It used to
       * parse with `insertAnalyticsEventSchema`, which is
       * `createInsertSchema(analyticsEvents)` and therefore accepted EVERY
       * column — so a caller could set `revenue` to any value (it feeds the
       * revenue figures on the creator, brand and admin dashboards), invent an
       * `eventType` (a plain text column with no enum and no CHECK), or
       * override the server's own geo/device classification.
       *
       * Only the four fields the deployed embeds actually send are accepted,
       * plus productId for click attribution. Everything else is derived by the
       * server below. Anything not listed here is silently dropped by zod,
       * which is what keeps already-deployed embeds working unchanged.
       *
       * revenue is deliberately absent: production has never recorded a single
       * purchase event, so nothing legitimate sends it, and it drives money
       * figures on three dashboards.
       */
      const data = analyticsIngestSchema.parse(req.body);

      /**
       * The video must exist, and it decides the attribution.
       *
       * Previously videoId was taken on trust with only the foreign key
       * standing behind it, and video ids are public — every embed snippet
       * contains one. Loading the video costs one indexed lookup and gives us
       * the creator, which is what the billing aggregate is keyed on.
       */
      const video = await storage.getVideo(data.videoId);
      if (!video) return res.status(404).json({ error: "Unknown video" });

      let affiliateId: string | null = null;
      let campaignAffiliateId: string | null = null;
      let resolvedCommissionRate: string | null = null;

      const utmCode = data.utmCode || null;
      if (utmCode) {
        const resolved = await storage.resolveUtmToAffiliate(utmCode);
        // The resolver knows which video the code belongs to, and this used to
        // ignore it — so a caller could staple one affiliate's utm code onto an
        // unrelated video and have the event credited to them. Attribution now
        // requires the code and the video to agree.
        if (resolved && resolved.videoId === data.videoId) {
          affiliateId = resolved.affiliateId;
          campaignAffiliateId = resolved.campaignAffiliateId;
          resolvedCommissionRate = resolved.commissionRate;
        }
      }

      // Geo and device are derived from the request, full stop. The previous
      // `data.device ?? classifyDevice(...)` let the caller win, which is the
      // opposite of what its own comment claimed.
      const device = classifyDevice(req.headers["user-agent"]);
      const country = deriveCountry(req);

      /**
       * Deduplicate billable views at the database.
       *
       * A partial unique index on (video_id, viewer_hash) for event_type='view'
       * means a reload, a prefetch, a second tab or a retried beacon collapses
       * into the one view that was already counted. Catching the violation and
       * returning success is correct: a viewer revisiting a page has not done
       * anything wrong, and the embed must not retry.
       *
       * Only views are deduplicated — a viewer may legitimately click several
       * products on the same video.
       */
      const viewer = viewerHash(req);

      let event;
      try {
        event = await storage.createAnalyticsEvent({
          ...data,
          affiliateId,
          device,
          country,
          creatorId: video.creatorId,
          viewerHash: viewer,
        } as any);
      } catch (err) {
        if (isUniqueViolation(err)) {
          return res.status(200).json({ deduplicated: true });
        }
        throw err;
      }

      if (affiliateId && data.referrerDomain) {
        const videoId = data.videoId;
        const deployUtmCode = utmCode || "";
        const existing = await storage.getEmbedDeployment(affiliateId, videoId, data.referrerDomain, deployUtmCode);
        if (existing) {
          await storage.incrementEmbedDeploymentLoads(existing.id);
        } else {
          await storage.createEmbedDeployment({
            affiliateId,
            videoId,
            utmCode: utmCode || "",
            referrerDomain: data.referrerDomain,
            referrerUrl: (data as any).referrerUrl || data.referrerDomain,
          });
        }
      }

      // Purchase events are recorded above for funnel analytics, but they do NOT
      // move money: the sale amount here is client-supplied and unverified, so
      // trusting it would let anyone mint commissions for any affiliate. Commissions
      // are created only from *verified* sales via the authenticated POST /api/sales
      // endpoint (reconciliation / signed store webhook). See server/commissions.ts.

      if (data.eventType === "click" && campaignAffiliateId) {
        const ca = (await storage.getCampaignAffiliates(data.videoId)).find(c => c.id === campaignAffiliateId);
        if (ca) {
          await storage.updateCampaignAffiliateStats(campaignAffiliateId, {
            totalClicks: (ca.totalClicks || 0) + 1,
          });
        }
      }

      res.status(201).json(event);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Analytics event error:", error);
      res.status(500).json({ error: "Failed to track event" });
    }
  });

  // Get affiliate publishers analytics with sorting. Returns publisher names and
  // email addresses, so it must be authenticated AND scoped: a creator only sees
  // publishers who reposted their own videos. Admins see the whole platform.
  app.get("/api/analytics/affiliate-publishers", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor) return res.status(401).json({ error: "User not found" });

      const { sortBy = "earnings", order = "desc" } = req.query;
      const validSortFields = ["earnings", "clicks", "conversions", "revenue", "conversionRate"];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : "earnings";
      const sortOrder = order === "asc" ? "asc" : "desc";

      // Get campaign affiliates with user info, scoped to the caller unless admin
      const affiliatePublishers = await storage.getAffiliatePublishersAnalytics(
        actor.isAdmin ? undefined : sessionUserId,
      );
      
      // Sort based on the requested field
      const sorted = [...affiliatePublishers].sort((a, b) => {
        let aVal: number, bVal: number;
        switch (sortField) {
          case "clicks":
            aVal = a.totalClicks;
            bVal = b.totalClicks;
            break;
          case "conversions":
            aVal = a.totalConversions;
            bVal = b.totalConversions;
            break;
          case "revenue":
            aVal = parseFloat(a.totalRevenue);
            bVal = parseFloat(b.totalRevenue);
            break;
          case "conversionRate":
            aVal = a.totalClicks > 0 ? (a.totalConversions / a.totalClicks) * 100 : 0;
            bVal = b.totalClicks > 0 ? (b.totalConversions / b.totalClicks) * 100 : 0;
            break;
          case "earnings":
          default:
            aVal = parseFloat(a.totalEarnings);
            bVal = parseFloat(b.totalEarnings);
            break;
        }
        return sortOrder === "asc" ? aVal - bVal : bVal - aVal;
      });
      
      res.json(sorted);
    } catch (error) {
      res.status(500).json({ error: "Failed to get affiliate publishers analytics" });
    }
  });

  // Get commission transactions for an affiliate
  app.get("/api/commissions/:affiliateId", requireSelfOrAdmin("affiliateId"), async (req, res) => {
    try {
      const transactions = await storage.getCommissionTransactions(req.params.affiliateId);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to get commission transactions" });
    }
  });

  // Get affiliate earnings computed from the commission transactions ledger
  app.get("/api/commissions/:affiliateId/earnings", requireSelfOrAdmin("affiliateId"), async (req, res) => {
    try {
      const earnings = await storage.getAffiliateEarningsFromLedger(req.params.affiliateId);
      res.json(earnings);
    } catch (error) {
      res.status(500).json({ error: "Failed to get affiliate earnings" });
    }
  });

  // List an affiliate's payouts
  app.get("/api/payouts/:userId", requireSelfOrAdmin("userId"), async (req, res) => {
    try {
      res.json(await storage.getPayouts(req.params.userId));
    } catch (error) {
      res.status(500).json({ error: "Failed to get payouts" });
    }
  });

  // Record a VERIFIED sale and create the commission split. Trusted path only:
  // requires an authenticated brand or admin (reconciliation from a store export,
  // or a future signed store webhook). This is the ONLY route that mints
  // commissions — the public analytics endpoint deliberately does not.
  app.post("/api/sales", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor) return res.status(401).json({ error: "User not found" });
      if (!actor.isAdmin && actor.role !== "brand") {
        return res.status(403).json({ error: "Only a brand or admin can record verified sales" });
      }

      const { videoId, revenue, utmCode, productId } = req.body ?? {};
      const revenueNum = Number(revenue);
      if (!videoId || !Number.isFinite(revenueNum) || revenueNum <= 0) {
        return res.status(400).json({ error: "videoId and a positive revenue are required" });
      }

      const video = await storage.getVideo(videoId);
      if (!video) return res.status(404).json({ error: "Video not found" });

      let affiliateId: string | null = null;
      let campaignAffiliateId: string | null = null;
      let resolvedCommissionRate: string | null = null;
      if (utmCode) {
        const resolved = await storage.resolveUtmToAffiliate(utmCode);
        if (resolved) {
          affiliateId = resolved.affiliateId;
          campaignAffiliateId = resolved.campaignAffiliateId;
          resolvedCommissionRate = resolved.commissionRate;
        }
      }

      // Resolve effective rates: admin platform settings over env defaults, plus
      // each party's per-user override. (A per-repost publisher override on the
      // campaign affiliate still wins inside recordSaleCommissions.)
      const cfg = resolveFeeConfig(await storage.getPlatformSettings());
      const creatorUser = video.creatorId ? await storage.getUser(video.creatorId) : null;
      const publisherUser = affiliateId ? await storage.getUser(affiliateId) : null;

      const result = await recordSaleCommissions(storage, revenueNum.toFixed(2), {
        videoId,
        creatorId: video.creatorId ?? null,
        affiliateId,
        campaignAffiliateId,
        resolvedCommissionRate,
        productId: productId ?? null,
      }, null, {
        marketplaceFeePct: cfg.marketplaceFeePct,
        creatorPct: userRateOr(creatorUser?.commissionRateOverride, cfg.creatorPct),
        publisherPct: userRateOr(publisherUser?.commissionRateOverride, cfg.publisherPct),
      });

      res.json({ ok: true, split: result.split });
    } catch (error) {
      console.error("Record sale error:", error);
      res.status(500).json({ error: "Failed to record sale" });
    }
  });

  // Get embed deployments for an affiliate
  app.get("/api/embed-deployments/:affiliateId", async (req, res) => {
    try {
      const deployments = await storage.getEmbedDeploymentsByAffiliate(req.params.affiliateId);
      res.json(deployments);
    } catch (error) {
      res.status(500).json({ error: "Failed to get embed deployments" });
    }
  });

  // ==================== SUBSCRIBER INTAKE ROUTES ====================
  
  // Create subscriber intake (landing page signup)
  app.post("/api/subscriber-intake", async (req, res) => {
    try {
      // No hardcoded fallback. The previous default was a real, live access code
      // committed in plaintext, so the check passed for anyone who read the source
      // even with ACCESS_CODE unset. Absent config now fails CLOSED: if the
      // platform has no code configured, no code can be accepted.
      const validAccessCode = process.env.ACCESS_CODE;
      const submittedCode = (req.body.accessCode ?? "").trim();
      if (!validAccessCode || submittedCode !== validAccessCode) {
        return res.status(403).json({ error: "Invalid access code" });
      }

      const data = insertSubscriberIntakeSchema.parse(req.body);
      
      // Check if email already exists
      const existing = await storage.getSubscriberIntakeByEmail(data.email);
      if (existing) {
        return res.status(409).json({ error: "Email already registered" });
      }
      
      const intake = await storage.createSubscriberIntake(data);
      res.status(201).json(intake);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create subscriber" });
    }
  });

  // Get all subscriber intakes. Returns the full signup list (name, email, social
  // handles, city) — admin only.
  app.get("/api/subscriber-intakes", requireAdmin, async (req, res) => {
    try {
      const intakes = await storage.getSubscriberIntakes();
      res.json(intakes);
    } catch (error) {
      res.status(500).json({ error: "Failed to get subscribers" });
    }
  });

  // ==================== UPLOAD ROUTES ====================
  
  // Get signed upload params for Cloudinary (client-side upload)
  app.post("/api/upload/url", async (req, res) => {
    try {
      // Signed Cloudinary upload params must not be mintable anonymously (storage
      // /cost abuse) — require an authenticated session.
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const { fileName, fileType } = req.body;
      const isVideo = fileType?.startsWith("video/");
      const { generateSignedUploadParams } = await import("./cloudinaryService");

      const folder = isVideo ? "materialized/videos" : "materialized/images";
      const params = generateSignedUploadParams({
        folder,
        resourceType: isVideo ? "video" : "image",
      });

      res.json(params);
    } catch (error) {
      console.error("Failed to generate upload params:", error);
      res.status(500).json({ error: "Failed to get upload URL" });
    }
  });

  // Server-side upload to Cloudinary (for smaller files / API uploads)
  app.post("/api/upload/complete", async (req, res) => {
    try {
      // This echoes a caller-supplied URL back as the canonical objectUrl, which
      // is then stored against a video. It had no auth check at all, so anyone
      // could call it. It does not mint credentials, but it should not be open.
      if (!(req.session as any)?.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }
      const { cloudinaryUrl, publicId, resourceType } = req.body;

      res.json({
        objectUrl: cloudinaryUrl,
        publicId,
        resourceType,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to complete upload" });
    }
  });

  // ==================== INVENTORY INTEGRATION ROUTES ====================

  // List store connections for current user
  app.get("/api/integrations/stores", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const connections = await db.select().from(storeConnections).where(eq(storeConnections.userId, sessionUserId));
      // Expose the exact receiver URL + whether a per-store secret is set (for the
      // self-serve UI) without ever returning the secret itself after creation.
      const enriched = connections.map((c) => {
        const { webhookSecret, accessToken, ...safe } = c as any;
        return {
          ...safe,
          hasWebhookSecret: !!webhookSecret,
          webhookUrl: (c.platform === "shopify" || c.platform === "woocommerce")
            ? receiverUrl(req, c.platform as "shopify" | "woocommerce", c.id)
            : null,
        };
      });
      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: "Failed to load store connections" });
    }
  });

  // Build the public base URL for outbound webhook registration. Same convention
  // used elsewhere in this file (APP_URL wins, then Origin, then the request host).
  const webhookBaseUrl = (req: any): string =>
    process.env.APP_URL || req.headers.origin || `${req.protocol}://${req.headers.host}`;

  // The exact receiver address the store should sign + POST orders to.
  const receiverUrl = (req: any, platform: "shopify" | "woocommerce", connectionId: string): string =>
    `${webhookBaseUrl(req)}/api/webhooks/${platform}/${connectionId}`;

  // The receiver address for refund deliveries (order refunded → commission clawback).
  const refundReceiverUrl = (req: any, platform: "shopify" | "woocommerce", connectionId: string): string =>
    `${receiverUrl(req, platform, connectionId)}/refund`;

  /**
   * Auto-register the orders/create webhook for a freshly-connected store.
   * Never throws — on any failure it returns a "manual" status so the connect
   * response can surface the receiver URL + secret for self-serve setup, and the
   * connect itself still succeeds. `rawSecret`/`rawToken` are the DECRYPTED values.
   */
  const registerStoreWebhook = async (
    req: any,
    connection: { id: string; platform: string; storeDomain: string | null },
    rawToken: string,
    rawSecret: string,
  ): Promise<{ status: "registered" | "manual"; url: string; secret: string; error?: string }> => {
    const platform = connection.platform as "shopify" | "woocommerce";
    const url = receiverUrl(req, platform, connection.id);
    const refundUrl = refundReceiverUrl(req, platform, connection.id);
    try {
      if (!connection.storeDomain) throw new Error("Store domain missing");
      if (platform === "shopify") {
        const { registerShopifyOrderWebhook, registerShopifyRefundWebhook } = await import("./integrations/shopifyService");
        await registerShopifyOrderWebhook(connection.storeDomain, rawToken, url);
        // Refund topic is additional best-effort — a failure here must not fail the connect
        // or downgrade the sale-webhook status, so we swallow it separately.
        try {
          await registerShopifyRefundWebhook(connection.storeDomain, rawToken, refundUrl);
        } catch (refundErr: any) {
          console.error(`${platform} refund webhook registration failed:`, refundErr?.message || refundErr);
        }
      } else {
        const { registerWooOrderWebhook, registerWooRefundWebhook } = await import("./integrations/woocommerceService");
        const [consumerKey, consumerSecret] = rawToken.split(":");
        await registerWooOrderWebhook(connection.storeDomain, consumerKey, consumerSecret, url, rawSecret);
        try {
          await registerWooRefundWebhook(connection.storeDomain, consumerKey, consumerSecret, refundUrl, rawSecret);
        } catch (refundErr: any) {
          console.error(`${platform} refund webhook registration failed:`, refundErr?.message || refundErr);
        }
      }
      return { status: "registered", url, secret: rawSecret };
    } catch (err: any) {
      console.error(`${platform} webhook registration failed:`, err?.message || err);
      return { status: "manual", url, secret: rawSecret, error: err?.message || String(err) };
    }
  };

  // Connect a Shopify store
  app.post("/api/integrations/shopify/connect", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { storeDomain, accessToken, webhookSecret } = req.body;
      if (!storeDomain || !accessToken) {
        return res.status(400).json({ error: "Store domain and access token are required" });
      }

      const { validateShopifyCredentials } = await import("./integrations/shopifyService");
      const validation = await validateShopifyCredentials(storeDomain, accessToken);
      if (!validation.valid) {
        return res.status(400).json({ error: `Invalid Shopify credentials: ${validation.error}` });
      }

      // Shopify signs orders/create with the app's API secret key, which is NOT
      // settable per-webhook via REST. The brand supplies it here so verification
      // passes; if omitted we leave webhookSecret NULL and the receiver falls back
      // to the app-level SHOPIFY_WEBHOOK_SECRET env var.
      const rawShopifySecret = typeof webhookSecret === "string" ? webhookSecret.trim() : "";

      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq, and, isNull } = await import("drizzle-orm");
      // Retire any existing live connection for this store BEFORE inserting.
      // Without this, reconnecting minted a second connection with its own live
      // webhook receiver — the old subscription is never removed at the store —
      // so both fired on every order and, because every dedup is scoped per
      // connection, the brand was billed the 15% twice. The partial unique index
      // added in 0018 is the backstop if this is ever bypassed.
      await db.update(storeConnections)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(and(
          eq(storeConnections.userId, sessionUserId),
          eq(storeConnections.platform, "shopify"),
          eq(storeConnections.storeDomain, storeDomain),
          isNull(storeConnections.deactivatedAt),
        ));

      const [connection] = await db.insert(storeConnections).values({
        userId: sessionUserId,
        platform: "shopify",
        storeDomain,
        accessToken: encryptSecret(accessToken),
        webhookSecret: rawShopifySecret ? encryptSecret(rawShopifySecret) : null,
        isActive: true,
      }).returning();

      // Auto-register the receiver endpoint (best-effort — never fails the connect).
      const registration = await registerStoreWebhook(req, connection, accessToken, rawShopifySecret);

      res.json({ ...connection, shopName: validation.shopName, webhookRegistration: registration });
    } catch (error) {
      console.error("Shopify connect error:", error);
      res.status(500).json({ error: "Failed to connect Shopify store" });
    }
  });

  // Connect a WooCommerce store
  app.post("/api/integrations/woocommerce/connect", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { storeUrl, consumerKey, consumerSecret } = req.body;
      if (!storeUrl || !consumerKey || !consumerSecret) {
        return res.status(400).json({ error: "Store URL, consumer key, and consumer secret are required" });
      }

      const { validateWooCommerceCredentials } = await import("./integrations/woocommerceService");
      const validation = await validateWooCommerceCredentials(storeUrl, consumerKey, consumerSecret);
      if (!validation.valid) {
        return res.status(400).json({ error: `Invalid WooCommerce credentials: ${validation.error}` });
      }

      // Woo is fully zero-touch: WE choose the secret and hand it to Woo at registration.
      // Woo then signs every delivery with it, so this is exactly what verifyStoreHmac checks.
      const rawSecret = randomBytes(32).toString("hex");

      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq, and, isNull } = await import("drizzle-orm");
      // Store combined key:secret as accessToken
      // Retire any existing live connection for this store BEFORE inserting.
      // Without this, reconnecting minted a second connection with its own live
      // webhook receiver — the old subscription is never removed at the store —
      // so both fired on every order and, because every dedup is scoped per
      // connection, the brand was billed the 15% twice. The partial unique index
      // added in 0018 is the backstop if this is ever bypassed.
      await db.update(storeConnections)
        .set({ isActive: false, deactivatedAt: new Date() })
        .where(and(
          eq(storeConnections.userId, sessionUserId),
          eq(storeConnections.platform, "woocommerce"),
          eq(storeConnections.storeDomain, storeUrl),
          isNull(storeConnections.deactivatedAt),
        ));

      const [connection] = await db.insert(storeConnections).values({
        userId: sessionUserId,
        platform: "woocommerce",
        storeDomain: storeUrl,
        accessToken: encryptSecret(`${consumerKey}:${consumerSecret}`),
        webhookSecret: encryptSecret(rawSecret),
        isActive: true,
      }).returning();

      // Auto-register the receiver endpoint (best-effort — never fails the connect).
      const registration = await registerStoreWebhook(
        req, connection, `${consumerKey}:${consumerSecret}`, rawSecret,
      );

      res.json({ ...connection, storeName: validation.storeName, webhookRegistration: registration });
    } catch (error) {
      console.error("WooCommerce connect error:", error);
      res.status(500).json({ error: "Failed to connect WooCommerce store" });
    }
  });

  // Sync products from a connected store
  app.post("/api/integrations/stores/:id/sync", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { db } = await import("./db");
      const { storeConnections, products } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      const [connection] = await db.select().from(storeConnections)
        .where(and(eq(storeConnections.id, req.params.id), eq(storeConnections.userId, sessionUserId)));

      if (!connection) return res.status(404).json({ error: "Store connection not found" });
      if (!connection.accessToken || !connection.storeDomain) {
        return res.status(400).json({ error: "Store credentials incomplete" });
      }
      const storeToken = decryptSecret(connection.accessToken);

      // Get user's brand
      const userBrands = await storage.getBrands();
      const userBrand = userBrands.find(b => b.ownerId === sessionUserId);
      if (!userBrand) return res.status(400).json({ error: "You need a brand profile to import products" });

      let importedProducts: any[] = [];

      if (connection.platform === "shopify") {
        const { fetchShopifyProducts, mapShopifyToLocalProducts } = await import("./integrations/shopifyService");
        const shopifyProducts = await fetchShopifyProducts(connection.storeDomain, storeToken);
        importedProducts = mapShopifyToLocalProducts(shopifyProducts, userBrand.id, connection.storeDomain);
      } else if (connection.platform === "woocommerce") {
        const { fetchWooCommerceProducts, mapWooToLocalProducts } = await import("./integrations/woocommerceService");
        const [consumerKey, consumerSecret] = storeToken.split(":");
        const wooProducts = await fetchWooCommerceProducts(connection.storeDomain, consumerKey, consumerSecret);
        importedProducts = mapWooToLocalProducts(wooProducts, userBrand.id);
      }

      // Upsert products: skip any whose SKU (or name, when no SKU) already exists
      // for this brand, so re-syncing doesn't create duplicates.
      const existingProducts = await storage.getProducts(userBrand.id);
      const seenKeys = new Set(
        existingProducts.map(p => (p.sku || p.name || "").toLowerCase()).filter(Boolean),
      );
      let created = 0;
      let skipped = 0;
      for (const product of importedProducts) {
        const key = (product.sku || product.name || "").toLowerCase();
        if (key && seenKeys.has(key)) { skipped++; continue; }
        await storage.createProduct(product as any);
        if (key) seenKeys.add(key);
        created++;
      }

      // Update connection metadata
      await db.update(storeConnections).set({
        lastSyncAt: new Date(),
        productCount: existingProducts.length + created,
      }).where(eq(storeConnections.id, connection.id));

      res.json({ synced: created, skipped, total: importedProducts.length });
    } catch (error) {
      console.error("Store sync error:", error);
      res.status(500).json({ error: "Failed to sync products" });
    }
  });

  // Re-register the orders/create webhook for an existing connection (self-serve
  // "reconnect webhook" affordance). Idempotent: reuses the stored per-store secret
  // when present, otherwise provisions one (Woo) and persists it encrypted.
  app.post("/api/integrations/stores/:id/register-webhook", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [connection] = await db.select().from(storeConnections)
        .where(and(eq(storeConnections.id, req.params.id), eq(storeConnections.userId, sessionUserId)));
      if (!connection) return res.status(404).json({ error: "Store connection not found" });
      if (connection.platform !== "shopify" && connection.platform !== "woocommerce") {
        return res.status(400).json({ error: "Webhooks are only supported for Shopify and WooCommerce" });
      }
      if (!connection.accessToken || !connection.storeDomain) {
        return res.status(400).json({ error: "Store credentials incomplete" });
      }

      const rawToken = decryptSecret(connection.accessToken);
      // Reuse the stored secret if we have one; for Woo without one, provision now.
      let rawSecret = connection.webhookSecret ? decryptSecret(connection.webhookSecret) : "";
      if (!rawSecret && connection.platform === "woocommerce") {
        rawSecret = randomBytes(32).toString("hex");
        await db.update(storeConnections)
          .set({ webhookSecret: encryptSecret(rawSecret) })
          .where(eq(storeConnections.id, connection.id));
      }

      const registration = await registerStoreWebhook(req, connection, rawToken, rawSecret);
      res.json(registration);
    } catch (error) {
      console.error("Webhook re-register error:", error);
      res.status(500).json({ error: "Failed to register webhook" });
    }
  });

  // "Test webhook" affordance — sign a synthetic minimal order with the connection's
  // stored secret and POST it to the connection's own receiver URL, so the brand can
  // confirm the exact verify path end-to-end without waiting for a real sale.
  app.post("/api/integrations/stores/:id/webhook-test", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");
      const [connection] = await db.select().from(storeConnections)
        .where(and(eq(storeConnections.id, req.params.id), eq(storeConnections.userId, sessionUserId)));
      if (!connection) return res.status(404).json({ error: "Store connection not found" });
      if (connection.platform !== "shopify" && connection.platform !== "woocommerce") {
        return res.status(400).json({ error: "Webhooks are only supported for Shopify and WooCommerce" });
      }

      const platform = connection.platform as "shopify" | "woocommerce";
      const secret = connection.webhookSecret
        ? decryptSecret(connection.webhookSecret)
        : (platform === "shopify" ? process.env.SHOPIFY_WEBHOOK_SECRET : process.env.WC_WEBHOOK_SECRET);
      if (!secret) {
        return res.status(400).json({ error: "No webhook secret configured for this connection" });
      }

      // A minimal, unattributed order body — the receiver will verify the signature and
      // ack it as `unattributed` (no fake commission is created).
      const { computeHmac } = await import("./storeWebhooks");
      const orderId = `test-${Date.now()}`;
      const bodyObj = platform === "shopify"
        ? { id: orderId, total_price: "0.00" }
        : { id: orderId, total: "0.00" };
      const rawBody = JSON.stringify(bodyObj);
      const signature = computeHmac(rawBody, secret);
      const hmacHeader = platform === "shopify" ? "X-Shopify-Hmac-Sha256" : "X-WC-Webhook-Signature";
      const url = receiverUrl(req, platform, connection.id);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", [hmacHeader]: signature },
        body: rawBody,
      });
      const receiverBody = await response.json().catch(() => ({}));
      res.json({ url, status: response.status, ok: response.ok, receiver: receiverBody });
    } catch (error) {
      console.error("Webhook test error:", error);
      res.status(500).json({ error: "Failed to run webhook test" });
    }
  });

  // Signed store order webhook — the automated verified-sales path. The store signs
  // the order with HMAC over the raw body; we verify it, then record the commission
  // split via the same trusted helper as /api/sales (idempotent per order id).
  const handleStoreOrderWebhook = async (
    req: any,
    res: any,
    platform: "shopify" | "woocommerce",
    hmacHeader: string,
    extract: (order: any) => OrderAttribution,
  ) => {
    try {
      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [connection] = await db.select().from(storeConnections).where(eq(storeConnections.id, req.params.connectionId));
      if (!connection || connection.platform !== platform) {
        return res.status(404).json({ error: "Store connection not found" });
      }

      // The per-store secret is stored ENCRYPTED (see the connect handlers) — decrypt
      // it before comparing. decryptSecret() returns legacy plaintext unchanged, so
      // any pre-existing plaintext rows keep working. Falls back to the app-level env
      // secret when no per-store secret is set (e.g. Shopify without a supplied secret).
      const secret = connection.webhookSecret
        ? decryptSecret(connection.webhookSecret)
        : (platform === "shopify" ? process.env.SHOPIFY_WEBHOOK_SECRET : process.env.WC_WEBHOOK_SECRET);
      if (!verifyStoreHmac(req.rawBody, req.get(hmacHeader) || undefined, secret || undefined)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      const attribution = extract(req.body);
      if (!attribution.externalOrderId) return res.status(400).json({ error: "Missing order id" });

      // Idempotency — stores retry webhooks. Scoped to this store connection, since order
      // ids collide across stores.
      if (await storage.hasCommissionForExternalOrder(attribution.externalOrderId, connection.id)) {
        return res.json({ ok: true, deduped: true });
      }

      /**
       * Record the accrual and ack, for an order that earns the platform nothing.
       *
       * These used to `return res.json({ ok: true, unattributed: true })` and
       * write nothing at all, which erased the difference between "not our sale"
       * and "our link drove this sale but the trail broke". The second is lost
       * revenue and is now findable. See server/feeAccruals.ts.
       */
      const ackUnattributed = async (state: "no_ref" | "ref_unresolved" | "video_missing") => {
        await recordFeeAccrual(storage, {
          storeConnectionId: connection.id,
          brandUserId: connection.userId,
          externalOrderId: attribution.externalOrderId!,
          videoId: null,
          currency: getPlatformCurrency(),
          saleAmount: attribution.amount,
          attributionState: state,
        });
        return res.json({ ok: true, unattributed: true, reason: state });
      };

      // Resolve the attribution ref to an affiliate/video; unattributed orders are acked, not paid.
      if (!attribution.ref) return await ackUnattributed("no_ref");
      const resolved = await storage.resolveUtmToAffiliate(attribution.ref);
      if (!resolved) return await ackUnattributed("ref_unresolved");
      const video = await storage.getVideo(resolved.videoId);
      if (!video) return await ackUnattributed("video_missing");

      const cfg = resolveFeeConfig(await storage.getPlatformSettings());
      const creatorUser = video.creatorId ? await storage.getUser(video.creatorId) : null;
      const publisherUser = resolved.affiliateId ? await storage.getUser(resolved.affiliateId) : null;

      const result = await recordSaleCommissions(storage, attribution.amount, {
        videoId: resolved.videoId,
        creatorId: video.creatorId ?? null,
        affiliateId: resolved.affiliateId,
        campaignAffiliateId: resolved.campaignAffiliateId,
        resolvedCommissionRate: resolved.commissionRate,
        externalOrderId: attribution.externalOrderId,
        storeConnectionId: connection.id,
      }, null, {
        marketplaceFeePct: cfg.marketplaceFeePct,
        creatorPct: userRateOr(creatorUser?.commissionRateOverride, cfg.creatorPct),
        publisherPct: userRateOr(publisherUser?.commissionRateOverride, cfg.publisherPct),
      });

      /**
       * Persist what the brand owes. The split was previously computed, echoed
       * in this response, and discarded — there was no row anywhere to invoice
       * from. This is an accounts-receivable entry, NOT a payment: Materialized
       * is not in the payment path for a sale on the brand's own store, so
       * nothing here collects money. See server/feeAccruals.ts.
       */
      const accrual = await recordFeeAccrual(storage, {
        storeConnectionId: connection.id,
        brandUserId: connection.userId,
        externalOrderId: attribution.externalOrderId,
        videoId: resolved.videoId,
        currency: getPlatformCurrency(),
        saleAmount: attribution.amount,
        attributionState: "attributed",
        split: result.split,
      });

      res.json({ ok: true, split: result.split, feeAccrued: accrual.feeCents });
    } catch (error) {
      console.error(`${platform} webhook error:`, error);
      res.status(500).json({ error: "Webhook processing failed" });
    }
  };

  app.post("/api/webhooks/shopify/:connectionId", (req, res) =>
    handleStoreOrderWebhook(req, res, "shopify", "X-Shopify-Hmac-Sha256", extractShopifyAttribution));

  app.post("/api/webhooks/woocommerce/:connectionId", (req, res) =>
    handleStoreOrderWebhook(req, res, "woocommerce", "X-WC-Webhook-Signature", extractWooAttribution));

  // Signed store REFUND webhook — the automated commission-clawback path. When a store
  // reports an order was refunded (Shopify `orders/refunded`, Woo `order.refunded`), we
  // verify the same HMAC as the order webhook, then reverse the commission rows recorded
  // for that order id so the affiliate's earnings ledger stops counting them and the
  // payout engine (which pays only "approved" rows) skips them. Idempotent: a retried
  // refund delivery, or a refund for an order we never attributed, is acked as a no-op.
  const handleStoreRefundWebhook = async (
    req: any,
    res: any,
    platform: "shopify" | "woocommerce",
    hmacHeader: string,
    extract: (order: any) => OrderAttribution,
  ) => {
    try {
      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq } = await import("drizzle-orm");
      const [connection] = await db.select().from(storeConnections).where(eq(storeConnections.id, req.params.connectionId));
      if (!connection || connection.platform !== platform) {
        return res.status(404).json({ error: "Store connection not found" });
      }

      // Same per-store secret + verification as the order webhook (see handleStoreOrderWebhook).
      const secret = connection.webhookSecret
        ? decryptSecret(connection.webhookSecret)
        : (platform === "shopify" ? process.env.SHOPIFY_WEBHOOK_SECRET : process.env.WC_WEBHOOK_SECRET);
      if (!verifyStoreHmac(req.rawBody, req.get(hmacHeader) || undefined, secret || undefined)) {
        return res.status(401).json({ error: "Invalid signature" });
      }

      // Both refund payloads are full order objects, so the same extractor yields the
      // order id we stored on the sale. We only need externalOrderId here (ref/amount
      // are irrelevant to a clawback).
      const attribution = extract(req.body);
      if (!attribution.externalOrderId) return res.status(400).json({ error: "Missing order id" });

      const result = await clawbackSaleCommissions(storage, attribution.externalOrderId, connection.id);

      // Void the fee accrual too, or the brand gets invoiced for a refunded sale.
      // `wasInvoiced` means the bill already went out and a credit is owed — said
      // out loud rather than left to be discovered on a statement.
      const voided = await voidFeeAccrual(storage, connection.id, attribution.externalOrderId);
      if (voided.wasInvoiced) {
        console.warn(
          `[FeeAccrual] Order ${attribution.externalOrderId} (store ${connection.id}) was refunded ` +
          `AFTER its marketplace fee was invoiced. Brand ${connection.userId} is owed a credit.`,
        );
      }

      res.json({
        ok: true,
        reversed: result.reversed,
        alreadyReversed: result.alreadyReversed,
        feeVoided: voided.voided,
        creditOwed: voided.wasInvoiced,
      });
    } catch (error) {
      console.error(`${platform} refund webhook error:`, error);
      res.status(500).json({ error: "Refund webhook processing failed" });
    }
  };

  app.post("/api/webhooks/shopify/:connectionId/refund", (req, res) =>
    handleStoreRefundWebhook(req, res, "shopify", "X-Shopify-Hmac-Sha256", extractShopifyAttribution));

  app.post("/api/webhooks/woocommerce/:connectionId/refund", (req, res) =>
    handleStoreRefundWebhook(req, res, "woocommerce", "X-WC-Webhook-Signature", extractWooAttribution));

  // Delete a store connection
  app.delete("/api/integrations/stores/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const { eq, and } = await import("drizzle-orm");

      await db.delete(storeConnections)
        .where(and(eq(storeConnections.id, req.params.id), eq(storeConnections.userId, sessionUserId)));

      res.json({ deleted: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to delete store connection" });
    }
  });

  // ==================== BRAND DASHBOARD ROUTES ====================

  // Get brand stats (real data from database)
  app.get("/api/brands/stats", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { db } = await import("./db");
      const { videos, analyticsEvents, campaigns, campaignAffiliates, brands, creatorInvitations } = await import("@shared/schema");
      const { sql, eq, count, sum, and } = await import("drizzle-orm");

      // Get user's brand
      const userBrands = await db.select().from(brands).where(eq(brands.ownerId, sessionUserId));
      const brandId = userBrands[0]?.id;

      // Aggregate from analytics events for videos associated with user's brands
      const [viewStats] = await db.select({
        totalViews: sql<number>`COALESCE(COUNT(CASE WHEN ${analyticsEvents.eventType} = 'view' THEN 1 END), 0)::int`,
        totalClicks: sql<number>`COALESCE(COUNT(CASE WHEN ${analyticsEvents.eventType} = 'click' THEN 1 END), 0)::int`,
        totalConversions: sql<number>`COALESCE(COUNT(CASE WHEN ${analyticsEvents.eventType} = 'purchase' THEN 1 END), 0)::int`,
        totalRevenue: sql<number>`COALESCE(SUM(CASE WHEN ${analyticsEvents.eventType} = 'purchase' THEN ${analyticsEvents.revenue}::numeric ELSE 0 END), 0)::float`,
      }).from(analyticsEvents);

      // Count active creators (affiliates assigned to campaigns for this brand)
      let activeCreators = 0;
      if (brandId) {
        const brandCampaigns = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.brandId, brandId));
        // Count distinct affiliates across all brand campaigns
        if (brandCampaigns.length > 0) {
          const [creatorCount] = await db.select({
            count: sql<number>`COUNT(DISTINCT ${campaignAffiliates.affiliateId})::int`,
          }).from(campaignAffiliates);
          activeCreators = creatorCount?.count ?? 0;
        }
      }

      res.json({
        totalViews: viewStats?.totalViews ?? 0,
        totalClicks: viewStats?.totalClicks ?? 0,
        totalConversions: viewStats?.totalConversions ?? 0,
        totalRevenue: viewStats?.totalRevenue ?? 0,
        activeCreators,
      });
    } catch (error) {
      console.error("Brand stats error:", error);
      res.status(500).json({ error: "Failed to get brand stats" });
    }
  });

  // Invite creator (brand to creator invitation)
  app.post("/api/brands/invite-creator", async (req, res) => {
    try {
      // Sends an email — must be gated so it can't be used to spam invitations
      // from a brand the caller doesn't own.
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const { creatorName, creatorEmail, contentCategory, message, brandId } = req.body;

      if (!creatorName || !creatorEmail) {
        return res.status(400).json({ error: "Creator name and email are required" });
      }

      // Resolve to a brand the caller actually owns (or any brand for an admin).
      const brands = await storage.getBrands();
      const actor = await storage.getUser(sessionUserId);
      const useBrandId = brandId || brands.find(b => b.ownerId === sessionUserId)?.id;
      if (!useBrandId) {
        return res.status(400).json({ error: "No brand available" });
      }
      const targetBrand = brands.find(b => b.id === useBrandId);
      if (!targetBrand) return res.status(404).json({ error: "Brand not found" });
      if (!actor?.isAdmin && targetBrand.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const invitation = await storage.createCreatorInvitation({
        brandId: useBrandId,
        creatorName,
        email: creatorEmail,
        category: contentCategory || null,
        message: message || null,
      });

      // Notify the invited creator. There is no per-invite token/accept flow for
      // creator invitations yet, so we link to the generic signup page.
      if (isEmailConfigured()) {
        try {
          const brandName = brands.find(b => b.id === useBrandId)?.name || "A brand";
          const acceptUrl = `${req.protocol}://${req.get("host")}/register`;
          await sendCreatorInvitationEmail({
            creatorName,
            creatorEmail,
            brandName,
            category: contentCategory || null,
            message: message || null,
            acceptUrl,
          });
        } catch (emailErr) {
          console.error("Creator invitation email failed:", emailErr);
        }
      }

      res.status(201).json(invitation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to send creator invitation" });
    }
  });

  // Bulk invite creators (CSV import)
  app.post("/api/brands/invite-creators/bulk", async (req, res) => {
    try {
      // Sends up to 200 emails — must be gated so it can't be used to email-bomb
      // from a brand the caller doesn't own.
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const { invitations, brandId } = req.body;

      if (!Array.isArray(invitations) || invitations.length === 0) {
        return res.status(400).json({ error: "Invitations array is required" });
      }

      if (invitations.length > 200) {
        return res.status(400).json({ error: "Maximum 200 invitations per bulk upload" });
      }

      // Resolve to a brand the caller actually owns (or any brand for an admin).
      const brands = await storage.getBrands();
      const actor = await storage.getUser(sessionUserId);
      const useBrandId = brandId || brands.find(b => b.ownerId === sessionUserId)?.id;
      if (!useBrandId) {
        return res.status(400).json({ error: "No brand available" });
      }
      const targetBrand = brands.find(b => b.id === useBrandId);
      if (!targetBrand) return res.status(404).json({ error: "Brand not found" });
      if (!actor?.isAdmin && targetBrand.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Validate each invitation using the shared insert schema
      const validInvitations: Array<{ brandId: string; creatorName: string; email: string; category: string | null; message: string | null }> = [];
      const errors: Array<{ index: number; error: string }> = [];

      // Create a schema for validating invitation rows (matches insertCreatorInvitationSchema)
      const invitationRowSchema = insertCreatorInvitationSchema.omit({ brandId: true });

      invitations.forEach((inv: unknown, index: number) => {
        const parsed = invitationRowSchema.safeParse(inv);
        if (!parsed.success) {
          const errorMessage = parsed.error.errors.map(e => e.message).join(", ");
          errors.push({ index, error: errorMessage });
          return;
        }

        validInvitations.push({
          brandId: useBrandId,
          creatorName: parsed.data.creatorName,
          email: parsed.data.email,
          category: parsed.data.category || null,
          message: parsed.data.message || null,
        });
      });

      const created = await storage.createCreatorInvitationsBulk(validInvitations);

      // Notify each invited creator (best-effort; a failed send never fails the row).
      if (isEmailConfigured()) {
        const brandName = brands.find(b => b.id === useBrandId)?.name || "A brand";
        const acceptUrl = `${req.protocol}://${req.get("host")}/register`;
        for (const inv of created) {
          try {
            await sendCreatorInvitationEmail({
              creatorName: inv.creatorName,
              creatorEmail: inv.email,
              brandName,
              category: inv.category,
              message: inv.message,
              acceptUrl,
            });
          } catch (emailErr) {
            console.error(`Creator invitation email failed for ${inv.email}:`, emailErr);
          }
        }
      }

      res.status(201).json({
        success: true,
        created: created.length,
        errors: errors.length > 0 ? errors : undefined,
        invitations: created,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to process bulk invitations" });
    }
  });

  // Get creator invitations sent by brand
  app.get("/api/brands/creator-invites", async (req, res) => {
    try {
      // Get a demo brand ID
      const brands = await storage.getBrands();
      const brandId = req.query.brandId as string || brands[0]?.id;
      
      if (!brandId) {
        return res.json([]);
      }

      const invitations = await storage.getCreatorInvitations(brandId);
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ error: "Failed to get creator invitations" });
    }
  });

  // Update invitation status (owner brand or admin only)
  app.patch("/api/brands/creator-invites/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const { status } = req.body;
      if (!["pending", "sent", "accepted", "declined"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }
      const invitation = await storage.getCreatorInvitation(req.params.id);
      if (!invitation) return res.status(404).json({ error: "Invitation not found" });
      const actor = await storage.getUser(sessionUserId);
      const brand = await storage.getBrand(invitation.brandId);
      if (!actor?.isAdmin && brand?.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const updated = await storage.updateCreatorInvitationStatus(req.params.id, status, invitation.brandId);
      if (!updated) {
        return res.status(404).json({ error: "Invitation not found" });
      }
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to update invitation" });
    }
  });

  // ==================== BRAND KIT ROUTES ====================

  // Get brand kit for current user
  app.get("/api/brand-kit", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const brandKit = await storage.getBrandKit(user.id);
      res.json(brandKit || null);
    } catch (error) {
      res.status(500).json({ error: "Failed to get brand kit" });
    }
  });

  // Create or update brand kit
  app.post("/api/brand-kit", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const existingKit = await storage.getBrandKit(user.id);
      
      if (existingKit) {
        const updated = await storage.updateBrandKit(existingKit.id, req.body);
        return res.json(updated);
      }

      const newKit = await storage.createBrandKit({
        userId: user.id,
        ...req.body,
      });
      res.status(201).json(newKit);
    } catch (error) {
      res.status(500).json({ error: "Failed to save brand kit" });
    }
  });

  // ==================== CAROUSEL OVERRIDE ROUTES ====================

  // Get carousel override for a video (includes manual products mapped to DetectedProduct shape)
  app.get("/api/videos/:id/carousel", async (req, res) => {
    try {
      const override = await storage.getVideoCarouselOverride(req.params.id);
      if (!override) return res.json(null);

      let rawProducts: any[] = [];
      if (override.manualProducts) {
        try { rawProducts = JSON.parse(override.manualProducts); } catch {}
      }

      const products = rawProducts.map((p: any) => ({
        id: p.id,
        productId: p.id,
        confidence: 1.0,
        startTime: p.startTime ?? 0,
        endTime: p.endTime ?? 999999,
        product: {
          id: p.id,
          name: p.name,
          productUrl: p.buyUrl,
          buyUrl: p.buyUrl,
          price: p.price ?? null,
          imageUrl: p.imageUrl ?? null,
          brandId: null,
          description: null,
          sku: null,
          category: null,
          productType: null,
          thumbnailType: null,
          isActive: true,
        },
      }));

      const { manualProducts: _, ...settings } = override;
      res.json({ ...settings, products });
    } catch (error) {
      res.status(500).json({ error: "Failed to get carousel settings" });
    }
  });

  // Create or update carousel override for a video
  app.post("/api/videos/:id/carousel", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const video = await storage.getVideo(req.params.id);
      if (!video) return res.status(404).json({ error: "Video not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && video.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { manualProducts, ...settings } = req.body;
      const body: any = { ...settings };
      if (manualProducts !== undefined) {
        body.manualProducts = JSON.stringify(manualProducts);
      }
      const existingOverride = await storage.getVideoCarouselOverride(req.params.id);
      if (existingOverride) {
        const updated = await storage.updateVideoCarouselOverride(req.params.id, body);
        return res.json(updated);
      }
      const newOverride = await storage.createVideoCarouselOverride({
        videoId: req.params.id,
        ...body,
      });
      res.status(201).json(newOverride);
    } catch (error) {
      res.status(500).json({ error: "Failed to save carousel settings" });
    }
  });

  // Add a manual product URL to a video's carousel
  app.post("/api/videos/:id/carousel/products", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const video = await storage.getVideo(req.params.id);
      if (!video) return res.status(404).json({ error: "Video not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && video.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const { name, buyUrl, price, imageUrl, startTime, endTime } = req.body;
      if (!name || !buyUrl) {
        return res.status(400).json({ error: "name and buyUrl are required" });
      }
      const newProduct = {
        id: Math.random().toString(36).slice(2),
        name,
        buyUrl,
        price: price ?? null,
        imageUrl: imageUrl ?? null,
        startTime: startTime ?? 0,
        endTime: endTime ?? 999999,
      };
      let override = await storage.getVideoCarouselOverride(req.params.id);
      let existing: any[] = [];
      if (override?.manualProducts) {
        try { existing = JSON.parse(override.manualProducts); } catch {}
      }
      const updated = [...existing, newProduct];
      if (override) {
        await storage.updateVideoCarouselOverride(req.params.id, { manualProducts: JSON.stringify(updated) });
      } else {
        await storage.createVideoCarouselOverride({ videoId: req.params.id, manualProducts: JSON.stringify(updated) });
      }
      res.status(201).json(newProduct);
    } catch (error) {
      res.status(500).json({ error: "Failed to add product" });
    }
  });

  // Remove a manual product from a video's carousel
  app.delete("/api/videos/:id/carousel/products/:productId", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const video = await storage.getVideo(req.params.id);
      if (!video) return res.status(404).json({ error: "Video not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && video.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const override = await storage.getVideoCarouselOverride(req.params.id);
      if (!override) return res.status(404).json({ error: "No carousel found" });
      let existing: any[] = [];
      if (override.manualProducts) {
        try { existing = JSON.parse(override.manualProducts); } catch {}
      }
      const filtered = existing.filter((p: any) => p.id !== req.params.productId);
      await storage.updateVideoCarouselOverride(req.params.id, { manualProducts: JSON.stringify(filtered) });
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to remove product" });
    }
  });

  // ==================== CAMPAIGN ROUTES ====================

  // Get all campaigns for a brand
  app.get("/api/campaigns", async (req, res) => {
    try {
      const { brandId } = req.query;
      if (!brandId || typeof brandId !== "string") {
        return res.status(400).json({ error: "Brand ID required" });
      }
      const campaigns = await storage.getCampaigns(brandId);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ error: "Failed to get campaigns" });
    }
  });

  // Get campaign stats for a brand
  app.get("/api/campaigns/stats", async (req, res) => {
    try {
      const { brandId } = req.query;
      if (!brandId || typeof brandId !== "string") {
        return res.status(400).json({ error: "Brand ID required" });
      }
      const stats = await storage.getCampaignStats(brandId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to get campaign stats" });
    }
  });

  // Get a single campaign
  app.get("/api/campaigns/:id", async (req, res) => {
    try {
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      res.json(campaign);
    } catch (error) {
      res.status(500).json({ error: "Failed to get campaign" });
    }
  });

  // Campaign detail with publisher list
  app.get("/api/campaigns/:id/detail", async (req, res) => {
    try {
      const detail = await storage.getCampaignDetail(req.params.id);
      if (!detail) return res.status(404).json({ error: "Campaign not found" });
      res.json(detail);
    } catch (error) {
      res.status(500).json({ error: "Failed to get campaign detail" });
    }
  });

  // Disable a publisher from a campaign (owner brand or admin only)
  app.post("/api/campaigns/:id/publishers/:caId/disable", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const actor = await storage.getUser(sessionUserId);
      const brand = await storage.getBrand(campaign.brandId);
      if (!actor?.isAdmin && brand?.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const updated = await storage.disableCampaignPublisher(req.params.caId);
      if (!updated) return res.status(404).json({ error: "Publisher link not found" });
      // Create notification for the publisher
      const { message, campaignName } = req.body;
      await storage.createPublisherNotification({
        affiliateId: updated.affiliateId,
        campaignAffiliateId: updated.id,
        campaignName: campaignName || req.params.id,
        type: "deactivation",
        message: message || "Your publishing access for this campaign has been paused.",
        isRead: false,
        actionTaken: null,
      });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to disable publisher" });
    }
  });

  // Grant 48-hour grace extension to a publisher (owner brand or admin only)
  app.post("/api/campaigns/:id/publishers/:caId/extend", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const campaign = await storage.getCampaign(req.params.id);
      if (!campaign) return res.status(404).json({ error: "Campaign not found" });
      const actor = await storage.getUser(sessionUserId);
      const brand = await storage.getBrand(campaign.brandId);
      if (!actor?.isAdmin && brand?.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const updated = await storage.extendCampaignPublisher(req.params.caId, 48);
      if (!updated) return res.status(404).json({ error: "Publisher link not found" });
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: "Failed to extend publisher" });
    }
  });

  // Publisher Notification routes
  app.get("/api/publisher/notifications", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const notes = await storage.getPublisherNotifications(sessionUserId);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });
  app.get("/api/publisher/notifications/unread-count", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const count = await storage.getUnreadNotificationCount(sessionUserId);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get count" });
    }
  });
  app.patch("/api/publisher/notifications/:id/read", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const notification = await storage.getPublisherNotification(Number(req.params.id));
      if (!notification) return res.status(404).json({ error: "Notification not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && notification.affiliateId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await storage.markPublisherNotificationRead(Number(req.params.id));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark read" });
    }
  });
  app.post("/api/publisher/notifications/:id/extend", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const notification = await storage.getPublisherNotification(Number(req.params.id));
      if (!notification) return res.status(404).json({ error: "Notification not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && notification.affiliateId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      await storage.markPublisherNotificationRead(Number(req.params.id));
      // Extend the associated campaign publisher link, if any.
      if (notification.campaignAffiliateId) {
        await storage.extendCampaignPublisher(notification.campaignAffiliateId, 48);
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to request extension" });
    }
  });

  // Create a new campaign (owner of the target brand or admin only)
  app.post("/api/campaigns", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const brandId = req.body?.brandId;
      if (!brandId) return res.status(400).json({ error: "brandId is required" });
      const brand = await storage.getBrand(brandId);
      if (!brand) return res.status(404).json({ error: "Brand not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && brand.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const campaign = await storage.createCampaign(req.body);
      res.status(201).json(campaign);
    } catch (error) {
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  // Update a campaign (owner brand or admin only)
  app.patch("/api/campaigns/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const existing = await storage.getCampaign(req.params.id);
      if (!existing) return res.status(404).json({ error: "Campaign not found" });
      const actor = await storage.getUser(sessionUserId);
      const brand = await storage.getBrand(existing.brandId);
      if (!actor?.isAdmin && brand?.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const campaign = await storage.updateCampaign(req.params.id, req.body, existing.brandId);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      res.json(campaign);
    } catch (error) {
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  // Delete a campaign (owner brand or admin only)
  app.delete("/api/campaigns/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const existing = await storage.getCampaign(req.params.id);
      if (!existing) return res.status(404).json({ error: "Campaign not found" });
      const actor = await storage.getUser(sessionUserId);
      const brand = await storage.getBrand(existing.brandId);
      if (!actor?.isAdmin && brand?.ownerId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      const deleted = await storage.deleteCampaign(req.params.id, existing.brandId);
      if (!deleted) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ error: "Failed to delete campaign" });
    }
  });

  // ==================== DETECTION JOB ROUTES ====================

  // Get detection job for a video
  app.get("/api/videos/:id/detections", async (req, res) => {
    try {
      const job = await storage.getDetectionJobByVideoId(req.params.id);
      if (!job) {
        return res.json({ status: "none", results: [] });
      }
      
      const results = await storage.getDetectionResults(job.id);
      res.json({ ...job, results });
    } catch (error) {
      res.status(500).json({ error: "Failed to get detection status" });
    }
  });

  // Create detection job for a video — runs Gemini AI product detection.
  // Gated: detection triggers paid Gemini vision calls, so only the video's
  // creator (or an admin) may start it. Unauthenticated/foreign callers are
  // rejected before any job is created, and a missing video is a clean 404
  // (not a 500 from the createDetectionJob FK).
  app.post("/api/videos/:id/detections", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const video = await storage.getVideo(req.params.id);
      if (!video) return res.status(404).json({ error: "Video not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && video.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { brandIds, videoTitle, videoDescription } = req.body;

      const job = await storage.createDetectionJob({
        videoId: req.params.id,
        selectedBrandIds: JSON.stringify(brandIds || []),
        frameSamplingRate: 1,
      });

      // Return immediately so the client can start polling
      res.status(201).json(job);

      // Run Gemini detection asynchronously
      (async () => {
        try {
          await storage.updateDetectionJob(job.id, {
            status: "processing",
            startedAt: new Date(),
          });

          // Gather product catalog from selected brands. An UNSUBSCRIBED brand can
          // still be tagged — that is how it gets pulled onto the platform — but its
          // inventory is not discoverable, so detection has nothing to match against
          // and the video simply is not shoppable until the brand subscribes.
          const allProducts: ProductInfo[] = [];
          for (const brandId of (brandIds || [])) {
            const brand = await storage.getBrand(brandId);
            if (!(await isBrandInventoryDiscoverable(brandId))) {
              console.log(
                `[Detection] Skipping catalogue for brand ${brandId} (${brand?.name ?? "unknown"}) — not subscribed`,
              );
              continue;
            }
            const products = await storage.getProducts(brandId);
            for (const product of products) {
              allProducts.push({
                id: product.id,
                name: product.name,
                description: product.description || null,
                category: product.category || null,
                brandId: product.brandId || brandId,
                brandName: brand?.name || "Unknown Brand",
              });
            }
          }

          // Fallback path — today's metadata-only "text guess". Behaviour is
          // byte-for-byte identical to before: same prompt, same parsing, same
          // zeroed timestamps. `note` records why we ended up here for the badge.
          const runTextGuess = async (note?: string) => {
            let detectedProducts: Array<{ productId: string; confidence: number }> = [];

            if (allProducts.length > 0) {
              const catalogJson = JSON.stringify(allProducts.map(p => ({
                id: p.id, name: p.name, category: p.category, description: p.description, brand: p.brandName,
              })));
              const prompt = `You are a video product placement analyst. Given a video with the following metadata:
Title: "${videoTitle || "Untitled Video"}"
Description: "${videoDescription || "No description provided"}"

And the following product catalog:
${catalogJson}

Identify which products from the catalog are most likely to appear or be featured in this video. Return a JSON array with objects like: { "productId": "<id>", "confidence": <0.0-1.0> }. Only include products with confidence > 0.5. Return ONLY valid JSON, no explanation.`;

              const result = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: [{ role: "user", parts: [{ text: prompt }] }],
              });

              const rawText = result.candidates?.[0]?.content?.parts?.[0]?.text ?? "[]";
              const jsonMatch = rawText.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                detectedProducts = JSON.parse(jsonMatch[0]);
              }
            }

            // Store detection results
            for (const det of detectedProducts) {
              const product = allProducts.find(p => p.id === det.productId);
              if (product) {
                await storage.createDetectionResult({
                  jobId: job.id,
                  videoId: req.params.id,
                  productId: det.productId,
                  brandId: product.brandId,
                  confidence: det.confidence.toString(),
                  frameTimestamp: "0",
                  startTime: "0",
                  endTime: "0",
                  boundingBox: null,
                });
              }
            }

            await storage.updateDetectionJob(job.id, {
              status: "completed",
              completedAt: new Date(),
              totalFrames: 30,
              processedFrames: 30,
              ...(note ? { error: note } : {}),
            });
          };

          // Real path — frame-based vision. Runs only when the Gemini key is set
          // AND we can actually sample frames from the stored video; otherwise we
          // degrade to the text guess above so behaviour matches today exactly.
          const hasGeminiKey = !!process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

          if (!hasGeminiKey) {
            await runTextGuess();
            return;
          }

          const video = await storage.getVideo(req.params.id);
          const frames = video?.videoUrl
            ? await sampleVideoFrames(video.videoUrl, {
                count: 4,
                durationSeconds: video.durationSeconds ?? null,
              })
            : [];

          if (frames.length === 0) {
            // Key present but no frames (unconfigured Cloudinary, non-Cloudinary
            // URL, or every frame fetch failed). Fall back — never fail the job.
            await runTextGuess("Frame sampling unavailable — used metadata heuristic");
            return;
          }

          await storage.updateDetectionJob(job.id, {
            totalFrames: frames.length,
            processedFrames: 0,
          });

          // Real per-frame product detection with true timestamps/bounding boxes.
          const frameData = frames.map((f) => ({
            base64: f.base64!,
            mimeType: f.mimeType,
            timestamp: f.timestamp,
          }));

          const frameAnalyses = await batchAnalyzeFrames(
            frameData,
            allProducts,
            (completed) => {
              storage.updateDetectionJob(job.id, { processedFrames: completed }).catch(() => {});
            }
          );
          const consolidated = consolidateDetections(frameAnalyses, 0.5, 1);

          for (const result of consolidated) {
            await storage.createDetectionResult({
              jobId: job.id,
              videoId: req.params.id,
              productId: result.productId,
              brandId: result.brandId,
              confidence: result.avgConfidence.toString(),
              frameTimestamp: result.startTime.toString(),
              startTime: result.startTime.toString(),
              endTime: result.endTime.toString(),
              boundingBox: null,
            });
          }

          // Real AI-generated-content judgment across the same sampled frames.
          const aiVerdict = await detectAiGeneratedContent(frames);
          const note = aiVerdict
            ? `AI-content: ${aiVerdict.label} (score ${aiVerdict.score.toFixed(2)}, confidence ${aiVerdict.confidence.toFixed(2)}) — ${aiVerdict.reason}`
            : undefined;

          await storage.updateDetectionJob(job.id, {
            status: "completed",
            completedAt: new Date(),
            totalFrames: frames.length,
            processedFrames: frames.length,
            ...(note ? { error: note } : {}),
          });
        } catch (err) {
          console.error("Gemini detection error:", err);
          await storage.updateDetectionJob(job.id, { status: "failed" } as any).catch(() => {});
        }
      })();
    } catch (error) {
      res.status(500).json({ error: "Failed to start detection" });
    }
  });

  // ==================== VIDEO PRODUCT OVERLAYS ====================

  app.get("/api/videos/:id/overlays", async (req, res) => {
    try {
      const overlays = await storage.getVideoProductOverlays(req.params.id);
      res.json(overlays);
    } catch {
      res.status(500).json({ error: "Failed to get overlays" });
    }
  });

  app.post("/api/videos/:id/overlays", async (req, res) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not authenticated" });
    const ownerVideo = await storage.getVideo(req.params.id);
    if (!ownerVideo) return res.status(404).json({ error: "Video not found" });
    const overlayActor = await storage.getUser(uid);
    if (!overlayActor?.isAdmin && ownerVideo.creatorId !== uid) return res.status(403).json({ error: "Forbidden" });
    try {
      const { name, productUrl, imageUrl, price, brandName, position, startTime, endTime, source, productId } = req.body;
      if (!name) return res.status(400).json({ error: "name is required" });
      const overlay = await storage.createVideoProductOverlay({
        videoId: req.params.id,
        productId: productId ?? null,
        name,
        productUrl: productUrl ?? null,
        imageUrl: imageUrl ?? null,
        price: price ?? null,
        // Derived, not asked for. The typed price stays the display label; this
        // is the chargeable amount, and parsePriceToCents refuses anything that
        // is not unambiguously one number — see server/inVideoCheckout.ts.
        priceCents: parsePriceToCents(price),
        currency: getPlatformCurrency(),
        brandName: brandName ?? null,
        position: position ?? "bottom",
        startTime: String(startTime ?? "0"),
        endTime: endTime != null ? String(endTime) : null,
        source: source ?? "manual",
      });
      res.status(201).json(overlay);
    } catch {
      res.status(500).json({ error: "Failed to create overlay" });
    }
  });

  app.patch("/api/videos/:id/overlays/:overlayId", async (req, res) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not authenticated" });
    const ownerVideo = await storage.getVideo(req.params.id);
    if (!ownerVideo) return res.status(404).json({ error: "Video not found" });
    const overlayActor = await storage.getUser(uid);
    if (!overlayActor?.isAdmin && ownerVideo.creatorId !== uid) return res.status(403).json({ error: "Forbidden" });
    try {
      const id = parseInt(req.params.overlayId, 10);
      const { position, startTime, endTime, name, productUrl, imageUrl, price, brandName } = req.body;
      const update: Record<string, unknown> = {};
      if (position !== undefined) update.position = position;
      if (startTime !== undefined) update.startTime = String(startTime);
      if (endTime !== undefined) update.endTime = endTime != null ? String(endTime) : null;
      if (name !== undefined) update.name = name;
      if (productUrl !== undefined) update.productUrl = productUrl;
      if (imageUrl !== undefined) update.imageUrl = imageUrl;
      if (price !== undefined) update.price = price;
      if (brandName !== undefined) update.brandName = brandName;
      const updated = await storage.updateVideoProductOverlay(id, update as any);
      if (!updated) return res.status(404).json({ error: "Overlay not found" });
      res.json(updated);
    } catch {
      res.status(500).json({ error: "Failed to update overlay" });
    }
  });

  app.delete("/api/videos/:id/overlays/:overlayId", async (req, res) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not authenticated" });
    const ownerVideo = await storage.getVideo(req.params.id);
    if (!ownerVideo) return res.status(404).json({ error: "Video not found" });
    const overlayActor = await storage.getUser(uid);
    if (!overlayActor?.isAdmin && ownerVideo.creatorId !== uid) return res.status(403).json({ error: "Forbidden" });
    try {
      const id = parseInt(req.params.overlayId, 10);
      await storage.deleteVideoProductOverlay(id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete overlay" });
    }
  });

  // Import AI-detected products as overlays for a video
  app.post("/api/videos/:id/overlays/import-detections", async (req, res) => {
    const uid = (req.session as any)?.userId;
    if (!uid) return res.status(401).json({ error: "Not authenticated" });
    const ownerVideo = await storage.getVideo(req.params.id);
    if (!ownerVideo) return res.status(404).json({ error: "Video not found" });
    const overlayActor = await storage.getUser(uid);
    if (!overlayActor?.isAdmin && ownerVideo.creatorId !== uid) return res.status(403).json({ error: "Forbidden" });
    try {
      const results = await storage.getDetectionResultsByVideo(req.params.id);
      const created = [];
      for (const r of results) {
        const product = r.productId ? await storage.getProduct(r.productId) : null;
        const brand = product?.brandId ? await storage.getBrand(product.brandId) : null;
        const overlay = await storage.createVideoProductOverlay({
          videoId: req.params.id,
          productId: r.productId,
          name: product?.name ?? "Detected Product",
          productUrl: product?.productUrl ?? null,
          imageUrl: product?.imageUrl ?? null,
          price: product?.price ?? null,
          // Same derivation as the manual path, so an AI-detected product is
          // buyable on the same terms — and refused on the same terms.
          priceCents: parsePriceToCents(product?.price ?? null),
          currency: getPlatformCurrency(),
          brandName: brand?.name ?? null,
          position: (req.body.position ?? "bottom") as any,
          startTime: r.startTime ?? "0",
          endTime: r.endTime ?? null,
          source: "ai",
        });
        created.push(overlay);
      }
      res.json(created);
    } catch {
      res.status(500).json({ error: "Failed to import detections" });
    }
  });

  // ==================== VIDEO PUBLISH ROUTES ====================

  // Publish a video and generate embed code
  app.post("/api/videos/:id/publish", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const video = await storage.getVideo(req.params.id);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && video.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const { widgetConfig } = req.body;
      
      // Generate embed code with UTM tracking
      const baseUrl = process.env.APP_URL || req.headers.origin || `${req.protocol}://${req.headers.host}`;
      const embedCode = generateEmbedCode(video.id, baseUrl, widgetConfig);

      // Create publish record
      const publishRecord = await storage.createVideoPublishRecord({
        videoId: video.id,
        embedCode,
        widgetConfig: widgetConfig ? JSON.stringify(widgetConfig) : null,
      });

      // Update video status
      await storage.updateVideo(video.id, { status: "published" });

      res.json({
        embedCode: publishRecord.embedCode,
        embedCodeMinified: publishRecord.embedCodeMinified,
        utmCode: publishRecord.baseUtmCode,
        publishedAt: publishRecord.publishedAt,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to publish video" });
    }
  });

  // Get published video embed info
  app.get("/api/videos/:id/publish", async (req, res) => {
    try {
      const publishRecord = await storage.getVideoPublishRecord(req.params.id);
      if (!publishRecord) {
        return res.json({ published: false });
      }
      res.json({ published: true, ...publishRecord });
    } catch (error) {
      res.status(500).json({ error: "Failed to get publish info" });
    }
  });

  // ==================== AFFILIATE INVITATION ROUTES ====================

  // Get affiliate invitations sent by current user
  app.get("/api/affiliates/invitations", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const invitations = await storage.getAffiliateInvitations(user.id);
      res.json(invitations);
    } catch (error) {
      res.status(500).json({ error: "Failed to get affiliate invitations" });
    }
  });

  // Send affiliate invitation
  app.post("/api/affiliates/invite", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      
      const validatedData = insertAffiliateInvitationSchema.omit({ inviterId: true }).parse(req.body);
      const invitation = await storage.createAffiliateInvitation({
        ...validatedData,
        inviterId: user.id,
      });

      // Email the invitee with their accept link (carries the invite token so
      // they can accept via POST /api/affiliates/accept/:token), then mark "sent".
      if (isEmailConfigured()) {
        try {
          const acceptUrl = `${req.protocol}://${req.get("host")}/affiliate/accept/${invitation.inviteToken}`;
          await sendAffiliateInvitationEmail({
            affiliateName: invitation.affiliateName,
            affiliateEmail: invitation.email,
            inviterName: user.displayName,
            commissionRate: invitation.commissionRate,
            message: invitation.message,
            acceptUrl,
          });
          await storage.updateAffiliateInvitationStatus(invitation.id, "sent");
        } catch (emailErr) {
          console.error("Affiliate invitation email failed:", emailErr);
        }
      }

      res.status(201).json(invitation);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create affiliate invitation" });
    }
  });

  // Bulk invite affiliates via CSV
  app.post("/api/affiliates/invite/bulk", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const { invitations } = req.body;
      if (!Array.isArray(invitations) || invitations.length === 0) {
        return res.status(400).json({ error: "No invitations provided" });
      }

      if (invitations.length > 200) {
        return res.status(400).json({ error: "Maximum 200 invitations per batch" });
      }

      const validatedInvitations = invitations.map((inv: any) => ({
        inviterId: user.id,
        affiliateName: inv.affiliateName,
        email: inv.email,
        commissionRate: inv.commissionRate || "10.00",
        message: inv.message,
      }));

      const created = await storage.createAffiliateInvitationsBulk(validatedInvitations);

      // Email each invitee with their own accept link (best-effort per row).
      if (isEmailConfigured()) {
        for (const inv of created) {
          try {
            const acceptUrl = `${req.protocol}://${req.get("host")}/affiliate/accept/${inv.inviteToken}`;
            await sendAffiliateInvitationEmail({
              affiliateName: inv.affiliateName,
              affiliateEmail: inv.email,
              inviterName: user.displayName,
              commissionRate: inv.commissionRate,
              message: inv.message,
              acceptUrl,
            });
            await storage.updateAffiliateInvitationStatus(inv.id, "sent");
          } catch (emailErr) {
            console.error(`Affiliate invitation email failed for ${inv.email}:`, emailErr);
          }
        }
      }

      res.status(201).json({ created: created.length, invitations: created });
    } catch (error) {
      res.status(500).json({ error: "Failed to bulk create affiliate invitations" });
    }
  });

  // Accept affiliate invitation (for affiliate login)
  app.post("/api/affiliates/accept/:token", async (req, res) => {
    try {
      const invitation = await storage.getAffiliateInvitationByToken(req.params.token);
      if (!invitation) {
        return res.status(404).json({ error: "Invitation not found" });
      }

      if (invitation.status !== "pending" && invitation.status !== "sent") {
        return res.status(400).json({ error: "Invitation already processed" });
      }

      // The invitee sets their own password (arriving via a valid invite token
      // means the email is verified). No more hardcoded/unhashed passwords.
      const { password } = req.body ?? {};
      if (!password || String(password).length < 6) {
        return res.status(400).json({ error: "A password of at least 6 characters is required" });
      }
      const existing = await storage.getUserByEmail(invitation.email);
      if (existing) {
        return res.status(409).json({ error: "An account with this email already exists — please sign in." });
      }

      const affiliateUser = await storage.createUser({
        username: `affiliate_${invitation.email.split("@")[0]}_${Date.now()}`,
        password: await hashPassword(password),
        email: invitation.email,
        displayName: invitation.affiliateName,
        role: "affiliate",
        emailVerified: true,
      } as any);

      await storage.updateAffiliateInvitationStatus(invitation.id, "accepted", affiliateUser.id);

      res.json({ success: true, user: sanitizeUser(affiliateUser) });
    } catch (error) {
      console.error("Affiliate accept error:", error);
      res.status(500).json({ error: "Failed to accept invitation" });
    }
  });

  // ==================== CAMPAIGN AFFILIATES ROUTES ====================

  // Get affiliates for a video campaign
  app.get("/api/videos/:id/affiliates", async (req, res) => {
    try {
      const affiliates = await storage.getCampaignAffiliates(req.params.id);
      res.json(affiliates);
    } catch (error) {
      res.status(500).json({ error: "Failed to get campaign affiliates" });
    }
  });

  // Add affiliate to video campaign
  app.post("/api/videos/:id/affiliates", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const validatedData = insertCampaignAffiliateSchema.parse({
        videoId: req.params.id,
        ...req.body,
      });

      const video = await storage.getVideo(req.params.id);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
      }
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && video.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      const assignment = await storage.createCampaignAffiliate(validatedData);

      // Generate personalized embed code for affiliate
      const baseUrl = process.env.APP_URL || req.headers.origin || `${req.protocol}://${req.headers.host}`;
      const embedCode = generateAffiliateEmbedCode(video.id, assignment.utmCode!, baseUrl);
      await storage.updateCampaignAffiliateStats(assignment.id, { embedCode });

      res.status(201).json({ ...assignment, embedCode });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to add affiliate to campaign" });
    }
  });

  // Get campaigns for affiliate user
  app.get("/api/affiliates/campaigns", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const campaigns = await storage.getCampaignAffiliatesByUser(user.id);
      res.json(campaigns);
    } catch (error) {
      res.status(500).json({ error: "Failed to get affiliate campaigns" });
    }
  });

  // ==================== GLOBAL VIDEO LIBRARY ROUTES ====================

  // Get all published listings in global library
  app.get("/api/library", async (req, res) => {
    try {
      const category = req.query.category as string | undefined;
      const listings = await storage.getGlobalVideoListings(category);
      
      // Enrich with video details
      const enrichedListings = await Promise.all(
        listings.map(async (listing) => {
          const video = await storage.getVideo(listing.videoId);
          const creator = await storage.getUser(listing.creatorId);
          return {
            ...listing,
            video,
            creator: creator ? { displayName: creator.displayName, avatarUrl: creator.avatarUrl } : null,
          };
        })
      );
      
      res.json(enrichedListings);
    } catch (error) {
      res.status(500).json({ error: "Failed to get library listings" });
    }
  });

  // Add video to global library (creator pays listing fee)
  app.post("/api/library/list", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const validatedData = insertGlobalVideoLibrarySchema.parse({
        ...req.body,
        creatorId: user.id,
      });

      const video = await storage.getVideo(validatedData.videoId);
      if (!video || video.creatorId !== user.id) {
        return res.status(404).json({ error: "Video not found or not owned by user" });
      }

      // Check if already listed
      const existingListing = await storage.getGlobalVideoListingByVideo(validatedData.videoId);
      if (existingListing) {
        return res.status(400).json({ error: "Video already listed in library" });
      }

      // ── Pay with wallet tokens ────────────────────────────────────────────
      // Balance is pre-checked BEFORE the listing row is created so the common
      // "not enough tokens" case doesn't leave an orphan listing behind (which
      // would then block a retry via the "already listed" check above). The
      // pre-check is advisory only — the authoritative check is inside the
      // transaction in spendTokens(); losing that race just means the listing
      // exists unpublished and can be retried via /api/library/:id/pay-with-tokens.
      const payWithTokens = req.body?.payWith === "tokens";
      if (payWithTokens) {
        const required = tokensForFee(LICENSE_FEE);
        if (required === null) {
          return res.status(409).json({
            error: "This listing fee cannot be paid with tokens",
            detail: `Fee of ${LICENSE_FEE} is not a whole multiple of the token value`,
          });
        }
        const balance = await storage.getTokenBalance(user.id);
        if (balance < required) {
          return res.status(402).json({ error: "Insufficient tokens", balance, required });
        }

        const tokenListing = await storage.createGlobalVideoListing(validatedData);
        const spend = await spendTokens(storage, {
          userId: user.id,
          tokens: required,
          reason: "spend_library_listing",
          spendRefType: "global_video_listing",
          spendRefId: tokenListing.id,
          description: "Global Video Library listing fee",
        });
        if (!spend.ok) {
          return res.status(402).json({
            error: "Token payment failed",
            reason: spend.error,
            listingId: tokenListing.id,
            detail: "The listing was saved unpublished — retry with POST /api/library/:id/pay-with-tokens",
          });
        }

        const published = await storage.updateGlobalVideoListing(tokenListing.id, {
          publishStatus: "published",
          listedAt: new Date(),
        });
        // No paymentIntent key: a token listing has no PaymentIntent and must NOT
        // be routed through /confirm-payment, which would 402 on the Stripe check.
        return res.status(201).json({
          listing: published ?? tokenListing,
          paidWith: "tokens",
          tokensSpent: required,
          balanceAfter: spend.balanceAfter,
        });
      }

      const listing = await storage.createGlobalVideoListing(validatedData);

      // Create Stripe payment intent for listing fee.
      // Currency omitted on purpose → falls back to getPlatformCurrency() ("usd").
      const paymentIntent = await stripeService.createPaymentIntent(
        LICENSE_FEE,
        undefined,
        { listingId: listing.id, userId: user.id, type: "library_listing" }
      );

      await storage.updateGlobalVideoListing(listing.id, {
        stripePaymentIntentId: paymentIntent.id,
        publishStatus: "pending_payment",
      });

      res.status(201).json({
        listing,
        paymentIntent: {
          clientSecret: paymentIntent.client_secret,
          amount: paymentIntent.amount,
        },
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      console.error("Failed to create library listing:", error);
      res.status(500).json({ error: "Failed to create library listing" });
    }
  });

  // Confirm library listing payment. Must be the listing's owner, and the payment
  // is verified against Stripe — never trust the client to say it paid.
  app.post("/api/library/:id/confirm-payment", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const listing = await storage.getGlobalVideoListing(req.params.id);
      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
      }
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && listing.creatorId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // The listing's PaymentIntent was recorded when the listing was created;
      // confirm with Stripe that it actually succeeded before publishing.
      if (!listing.stripePaymentIntentId) {
        return res.status(400).json({ error: "No payment on record for this listing" });
      }
      const intent = await stripeService.retrievePaymentIntent(listing.stripePaymentIntentId);
      if (!intent || intent.status !== "succeeded") {
        return res.status(402).json({ error: "Payment not completed" });
      }

      await storage.updateGlobalVideoListing(listing.id, {
        publishStatus: "published",
        listedAt: new Date(),
      });

      res.json({ success: true, listing: await storage.getGlobalVideoListing(listing.id) });
    } catch (error) {
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  // Pay an EXISTING unpublished listing with wallet tokens. Owner only — the
  // wallet debited is always the session user's, never a client-supplied id.
  // Exists so a token payment that failed midway through /api/library/list is
  // retryable instead of leaving the listing permanently stuck.
  app.post("/api/library/:id/pay-with-tokens", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const listing = await storage.getGlobalVideoListing(req.params.id);
      if (!listing) return res.status(404).json({ error: "Listing not found" });
      // Deliberately NOT admin-overridable: an admin must not spend someone
      // else's tokens. Owner only.
      if (listing.creatorId !== sessionUserId) return res.status(403).json({ error: "Forbidden" });
      if (listing.publishStatus === "published") {
        return res.status(400).json({ error: "Listing already published" });
      }

      const required = tokensForFee(LICENSE_FEE);
      if (required === null) {
        return res.status(409).json({ error: "This listing fee cannot be paid with tokens" });
      }

      const spend = await spendTokens(storage, {
        userId: sessionUserId,
        tokens: required,
        reason: "spend_library_listing",
        spendRefType: "global_video_listing",
        spendRefId: listing.id,
        description: "Global Video Library listing fee",
      });

      if (!spend.ok && spend.error === "duplicate_spend") {
        // Already paid for on a previous attempt — publish and report success.
        const published = await storage.updateGlobalVideoListing(listing.id, {
          publishStatus: "published",
          listedAt: listing.listedAt ?? new Date(),
        });
        return res.json({ success: true, listing: published, paidWith: "tokens", alreadyPaid: true });
      }
      if (!spend.ok) {
        return res.status(402).json({
          error: "Token payment failed",
          reason: spend.error,
          ...(spend.error === "insufficient_tokens"
            ? { balance: spend.balance, required: spend.required }
            : {}),
        });
      }

      const published = await storage.updateGlobalVideoListing(listing.id, {
        publishStatus: "published",
        listedAt: new Date(),
      });
      res.json({
        success: true,
        listing: published,
        paidWith: "tokens",
        tokensSpent: required,
        balanceAfter: spend.balanceAfter,
      });
    } catch (error) {
      console.error("Library token payment error:", error);
      res.status(500).json({ error: "Failed to pay with tokens" });
    }
  });

  // ==================== PLAYLIST ROUTES ====================

  // Get current user's playlists (with item count)
  app.get("/api/playlists", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const userPlaylists = await storage.getUserPlaylists(user.id);
      // Attach item counts
      const withCounts = await Promise.all(userPlaylists.map(async (pl) => {
        const items = await storage.getPlaylistItems(pl.id);
        return { ...pl, itemCount: items.length };
      }));
      res.json(withCounts);
    } catch {
      res.status(500).json({ error: "Failed to get playlists" });
    }
  });

  // Create a new playlist
  app.post("/api/playlists", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const validated = insertPlaylistSchema.parse({ ...req.body, userId: user.id });
      const pl = await storage.createPlaylist(validated);
      res.status(201).json(pl);
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      res.status(500).json({ error: "Failed to create playlist" });
    }
  });

  // Get a playlist with enriched items
  app.get("/api/playlists/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const pl = await storage.getPlaylist(Number(req.params.id));
      if (!pl || pl.userId !== user.id) return res.status(404).json({ error: "Playlist not found" });
      const items = await storage.getPlaylistItems(pl.id);
      const enriched = await Promise.all(items.map(async (item) => {
        const listing = await storage.getGlobalVideoListing(item.listingId);
        const video = listing ? await storage.getVideo(listing.videoId) : null;
        const creator = listing ? await storage.getUser(listing.creatorId) : null;
        return {
          ...item,
          listing: listing ? { ...listing, video, creator: creator ? { displayName: creator.displayName, avatarUrl: creator.avatarUrl } : null } : null,
        };
      }));
      res.json({ ...pl, items: enriched });
    } catch {
      res.status(500).json({ error: "Failed to get playlist" });
    }
  });

  // Add videos to a playlist
  app.post("/api/playlists/:id/items", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      const pl = await storage.getPlaylist(Number(req.params.id));
      if (!pl || pl.userId !== user.id) return res.status(404).json({ error: "Playlist not found" });
      // A playlist is priced PER VIDEO, and it is priced ONCE. Adding videos after
      // it has been paid for is buying 100 licences for the price of 1: the token
      // path debits at /checkout and the card path sizes its PaymentIntent there
      // too, and neither can be re-run afterwards (checkout 400s on a published
      // playlist), so the extra videos would simply be free. The contents are
      // frozen from the moment money is committed.
      if (isPlaylistLocked(pl.status)) {
        return res.status(409).json({ error: playlistLockedMessage(pl.status), status: pl.status });
      }
      const { listingIds, utmSource, utmMedium, utmCampaign, utmContent } = req.body;
      if (!Array.isArray(listingIds) || listingIds.length === 0) {
        return res.status(400).json({ error: "listingIds must be a non-empty array" });
      }
      const items = listingIds.map((listingId: string) => ({
        playlistId: pl.id,
        listingId,
        utmSource: utmSource || null,
        utmMedium: utmMedium || "video",
        utmCampaign: utmCampaign || pl.name,
        utmContent: utmContent || null,
      }));
      const created = await storage.addPlaylistItems(items);
      res.status(201).json(created);
    } catch {
      res.status(500).json({ error: "Failed to add items to playlist" });
    }
  });

  // Delete a playlist
  app.delete("/api/playlists/:id", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      await storage.deletePlaylist(Number(req.params.id), user.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete playlist" });
    }
  });

  // Remove a single item from a playlist (owner or admin only)
  app.delete("/api/playlists/:id/items/:itemId", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const playlistId = Number(req.params.id);
      const playlist = await storage.getPlaylist(playlistId);
      if (!playlist) return res.status(404).json({ error: "Playlist not found" });
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && playlist.userId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }
      // Symmetrical with the add guard. Removing a video from a paid playlist would
      // shrink it below what was charged, and — because /checkout is keyed on the
      // playlist id and cannot be re-run — leave a permanent add/remove channel for
      // swapping the published contents after payment. Admins are exempt: a takedown
      // of infringing content must not be blocked by a billing rule.
      if (!actor?.isAdmin && isPlaylistLocked(playlist.status)) {
        return res.status(409).json({ error: playlistLockedMessage(playlist.status), status: playlist.status });
      }
      await storage.removePlaylistItem(Number(req.params.itemId), playlistId, playlist.userId);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to remove item" });
    }
  });

  // ── Playlist checkout (create Stripe payment intent) ──────────────────
  app.post("/api/playlists/:id/checkout", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const playlistId = Number(req.params.id);
      const playlist = await storage.getPlaylist(playlistId);
      if (!playlist) return res.status(404).json({ error: "Playlist not found" });
      if (playlist.userId !== user.id) return res.status(403).json({ error: "Forbidden" });
      if (playlist.status === "published") return res.status(400).json({ error: "Playlist already published" });

      const items = await storage.getPlaylistItems(playlistId);
      if (items.length === 0) return res.status(400).json({ error: "Playlist has no videos" });

      // createPaymentIntent takes MAJOR UNITS (it multiplies by 100 internally).
      // This previously passed cents, which billed 100x — 4,500 for one video.
      // Playlist curation is charged per video at LICENSE_FEE_PER_VIDEO ($49).
      const totalAmount = items.length * LICENSE_FEE_PER_VIDEO;

      // ── Pay with wallet tokens ────────────────────────────────────────────
      // Curation is PER VIDEO, so a 5-video playlist costs 5 tokens. There is no
      // partial-token spend: the wallet deals in whole $49 units.
      if (req.body?.payWith === "tokens") {
        const perVideo = tokensForFee(LICENSE_FEE_PER_VIDEO);
        if (perVideo === null) {
          return res.status(409).json({
            error: "This curation fee cannot be paid with tokens",
            detail: `Per-video fee of ${LICENSE_FEE_PER_VIDEO} is not a whole multiple of the token value`,
          });
        }
        const required = perVideo * items.length;

        const spend = await spendTokens(storage, {
          userId: user.id,
          tokens: required,
          reason: "spend_playlist",
          spendRefType: "playlist",
          spendRefId: String(playlistId),
          description: `Playlist curation — ${items.length} video(s)`,
        });

        if (!spend.ok && spend.error === "insufficient_tokens") {
          return res.status(402).json({
            error: "Insufficient tokens",
            balance: spend.balance,
            required: spend.required,
            videoCount: items.length,
          });
        }
        if (!spend.ok && spend.error !== "duplicate_spend") {
          return res.status(400).json({ error: "Token payment failed", reason: spend.error });
        }
        if (!spend.ok && spend.error === "duplicate_spend") {
          // Already paid for on a previous attempt — but re-verify the playlist
          // hasn't GROWN since. If updatePlaylist failed after the debit committed
          // the playlist stays "draft" (and therefore unlocked), so videos could be
          // added and this path re-run to publish them all for the original price.
          // The card path guards exactly this by comparing the PaymentIntent amount.
          const paidEntry = await storage.getTokenLedgerEntryBySpendRef("playlist", String(playlistId));
          const paidFor = paidEntry ? Math.abs(paidEntry.deltaTokens) : 0;
          if (required > paidFor) {
            return res.status(409).json({
              error: "Playlist has more videos than were paid for",
              paidForTokens: paidFor,
              requiredTokens: required,
              videoCount: items.length,
            });
          }
        }
        // Safe to fall through: either we just debited, or the existing debit
        // covers the current video count. Publishing is idempotent.

        const tokenEmbedCode = buildPlaylistEmbedCode(playlistId, user.id);
        const publishedPlaylist = await storage.updatePlaylist(playlistId, {
          status: "published",
          embedCode: tokenEmbedCode,
          publishedAt: new Date(),
          licenseFeeTotal: totalAmount.toFixed(2),
        });

        return res.json({
          playlist: publishedPlaylist,
          embedCode: tokenEmbedCode,
          paidWith: "tokens",
          tokensSpent: spend.ok ? required : 0,
          alreadyPaid: !spend.ok,
          videoCount: items.length,
          // No clientSecret: nothing to confirm, the playlist is already published.
        });
      }

      // Currency omitted on purpose → falls back to getPlatformCurrency() ("usd").
      const paymentIntent = await stripeService.createPaymentIntent(totalAmount, undefined, {
        playlistId: String(playlistId),
        userId: user.id,
        videoCount: String(items.length),
      });

      const updated = await storage.updatePlaylist(playlistId, {
        status: "pending_payment",
        stripePaymentIntentId: paymentIntent.id,
        licenseFeeTotal: totalAmount.toFixed(2),
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        totalCents: Math.round(totalAmount * 100),
        // `total` is the platform-currency amount. Kept alongside the legacy
        // `totalEur` alias so any client still reading the old field keeps working.
        total: totalAmount.toFixed(2),
        totalEur: totalAmount.toFixed(2),
        videoCount: items.length,
        playlist: updated,
      });
    } catch (err) {
      console.error("Playlist checkout error:", err);
      res.status(500).json({ error: "Failed to create payment intent" });
    }
  });

  // ── Confirm playlist payment → publish + generate embed code ──────────
  app.post("/api/playlists/:id/confirm-payment", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const playlistId = Number(req.params.id);
      const playlist = await storage.getPlaylist(playlistId);
      if (!playlist) return res.status(404).json({ error: "Playlist not found" });
      if (playlist.userId !== user.id) return res.status(403).json({ error: "Forbidden" });
      if (playlist.status === "published") return res.status(400).json({ error: "Already published" });

      // PRE-EXISTING REVENUE BUG, fixed here alongside the token path: this
      // endpoint used to publish unconditionally — it never read
      // stripePaymentIntentId and never called Stripe — so any owner could POST
      // /checkout then /confirm-payment and publish for free. Adding a token gate
      // next to an already-open door would have been decoration, so the card
      // branch is verified the same way /api/library/:id/confirm-payment is
      // (routes.ts, retrievePaymentIntent + status === "succeeded").
      //
      // NOTE FOR THE CLIENT: playlists paid by CARD now require a real succeeded
      // PaymentIntent. There is no card UI in client/src today (nothing consumes
      // the returned clientSecret), so in practice the token path is the working
      // publish path until that UI lands.
      if (!playlist.stripePaymentIntentId) {
        return res.status(400).json({ error: "No payment on record for this playlist" });
      }
      const intent = await stripeService.retrievePaymentIntent(playlist.stripePaymentIntentId);
      if (!intent || intent.status !== "succeeded") {
        return res.status(402).json({ error: "Payment not completed" });
      }
      // Items can be added between /checkout and /confirm-payment. Without this,
      // an 8-video playlist could be published against a 1-video PaymentIntent.
      const confirmItems = await storage.getPlaylistItems(playlistId);
      const expectedCents = Math.round(confirmItems.length * LICENSE_FEE_PER_VIDEO * 100);
      if (intent.amount < expectedCents) {
        return res.status(402).json({
          error: "Payment does not cover the current playlist",
          paidCents: intent.amount,
          requiredCents: expectedCents,
          videoCount: confirmItems.length,
        });
      }

      const embedCode = buildPlaylistEmbedCode(playlistId, user.id);

      const updated = await storage.updatePlaylist(playlistId, {
        status: "published",
        embedCode,
        publishedAt: new Date(),
      });

      res.json({ playlist: updated, embedCode });
    } catch (err) {
      console.error("Confirm payment error:", err);
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  // ==================== VIDEO LICENSE PURCHASE ROUTES ====================

  // Purchase license for a video from global library
  app.post("/api/library/:id/purchase", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const listing = await storage.getGlobalVideoListing(req.params.id);
      if (!listing || listing.publishStatus !== "published") {
        return res.status(404).json({ error: "Listing not found or not available" });
      }

      const { commissionRate } = req.body;

      const purchase = await storage.createVideoLicensePurchase({
        globalListingId: listing.id,
        affiliateId: user.id,
        licenseFee: listing.licenseFee,
        commissionRate: commissionRate || "10.00",
      });

      // Create Stripe payment intent.
      // Currency omitted on purpose → falls back to getPlatformCurrency() ("usd").
      const paymentIntent = await stripeService.createPaymentIntent(
        Number(listing.licenseFee),
        undefined,
        { purchaseId: purchase.id, userId: user.id, type: "license_purchase" }
      );

      // PRE-EXISTING BUG, fixed here: the PaymentIntent id was never written back
      // onto the purchase (insertVideoLicensePurchaseSchema omits it), so
      // purchase.stripePaymentIntentId was always NULL and
      // /api/purchases/:id/confirm-payment hard-failed with "No payment on record
      // for this purchase" — i.e. a licence purchase could never complete.
      // /api/library/list already persisted its intent id; this path did not.
      await storage.updateVideoLicensePurchaseStatus(purchase.id, "pending", paymentIntent.id);

      res.status(201).json({
        purchase,
        paymentIntent: {
          clientSecret: paymentIntent.client_secret,
          amount: paymentIntent.amount,
        },
      });
    } catch (error) {
      console.error("Failed to create license purchase:", error);
      res.status(500).json({ error: "Failed to create license purchase" });
    }
  });

  // Confirm license purchase payment. Must be the buyer, and the payment is
  // verified against Stripe — previously any anonymous caller could mark any
  // purchase "paid" with a client-supplied id, i.e. free licences.
  app.post("/api/purchases/:id/confirm-payment", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const purchase = await storage.getVideoLicensePurchase(req.params.id);
      if (!purchase) {
        return res.status(404).json({ error: "Purchase not found" });
      }
      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && purchase.affiliateId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      // Verify against Stripe using the intent recorded on the purchase, not
      // whatever id the client sent.
      if (!purchase.stripePaymentIntentId) {
        return res.status(400).json({ error: "No payment on record for this purchase" });
      }
      const intent = await stripeService.retrievePaymentIntent(purchase.stripePaymentIntentId);
      if (!intent || intent.status !== "succeeded") {
        return res.status(402).json({ error: "Payment not completed" });
      }

      await storage.updateVideoLicensePurchaseStatus(purchase.id, "paid", purchase.stripePaymentIntentId);

      // Get listing and video for embed code generation
      const listing = await storage.getGlobalVideoListing(purchase.globalListingId);
      if (listing) {
        const baseUrl = process.env.APP_URL || req.headers.origin || `${req.protocol}://${req.headers.host}`;
        const embedCode = generateAffiliateEmbedCode(listing.videoId, purchase.utmCode!, baseUrl);
        
        // Update purchase with embed code
        const updatedPurchase = await storage.getVideoLicensePurchase(purchase.id);
        if (updatedPurchase) {
          // Also increment license count
          await storage.updateGlobalVideoListing(listing.id, {
            totalLicenses: (listing.totalLicenses || 0) + 1,
          });
        }
        
        res.json({ 
          success: true, 
          purchase: updatedPurchase,
          embedCode,
          utmCode: purchase.utmCode,
        });
      } else {
        res.json({ success: true, purchase: await storage.getVideoLicensePurchase(purchase.id) });
      }
    } catch (error) {
      res.status(500).json({ error: "Failed to confirm payment" });
    }
  });

  // Get affiliate's purchased licenses
  app.get("/api/affiliates/licenses", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const purchases = await storage.getVideoLicensePurchases(user.id);
      res.json(purchases);
    } catch (error) {
      res.status(500).json({ error: "Failed to get licenses" });
    }
  });

  // ==================== STRIPE ROUTES ====================

  // Get Stripe publishable key
  app.get("/api/stripe/config", async (req, res) => {
    try {
      const publishableKey = await getStripePublishableKey();
      res.json({ publishableKey });
    } catch (error) {
      res.status(500).json({ error: "Failed to get Stripe config" });
    }
  });

  // Create Stripe Connect account for affiliate payouts
  app.post("/api/stripe/connect/create", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (user.stripeConnectAccountId) {
        return res.json({ accountId: user.stripeConnectAccountId });
      }

      // A brand connects in order to SELL through in-video checkout, which needs
      // the `card_payments` capability as well as `transfers`. Publishers only
      // ever receive money, so they stay transfers-only and are asked for less
      // verification. Requested at creation because adding a capability later
      // means a second round of onboarding for the brand.
      const forSelling = user.role === "brand" || req.body?.forSelling === true;
      const account = await stripeService.createConnectAccount(user.email, user.id, forSelling);
      await storage.updateUser(user.id, { stripeConnectAccountId: account.id } as any);

      res.json({ accountId: account.id, forSelling });
    } catch (error) {
      res.status(500).json({ error: "Failed to create connect account" });
    }
  });

  // Create onboarding link for Stripe Connect
  app.post("/api/stripe/connect/onboarding", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) {
        return res.status(401).json({ error: "Unauthorized" });
      }
      const user = await storage.getUser(sessionUserId);
      if (!user || !user.stripeConnectAccountId) {
        return res.status(400).json({ error: "No connect account found" });
      }

      // REPLIT_DOMAINS was the only reference to it left in the codebase and it is
      // not set on this deployment (Vercel front end, Railway API), so this
      // produced "https://undefined/affiliate/settings" — Stripe's hosted
      // onboarding then had nowhere to return the creator to, and nobody could
      // finish connecting an account. Use the same convention as every other
      // redirect in this file.
      const baseUrl =
        process.env.APP_URL || req.headers.origin || `${req.protocol}://${req.headers.host}`;
      const accountLink = await stripeService.createConnectAccountLink(
        user.stripeConnectAccountId,
        `${baseUrl}/affiliate/settings`,
        `${baseUrl}/affiliate/settings?onboarded=true`
      );

      res.json({ url: accountLink.url });
    } catch (error) {
      res.status(500).json({ error: "Failed to create onboarding link" });
    }
  });

  // Get Stripe Connect account status
  app.get("/api/stripe/connect/status", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "Not authenticated" });
      }

      if (!user.stripeConnectAccountId) {
        return res.json({ connected: false, onboarded: false });
      }

      const account = await stripeService.getConnectAccount(user.stripeConnectAccountId);
      // Same gate as the account.updated webhook (handleAccountUpdated) so the
      // status endpoint and the webhook agree on when an account is onboarded.
      //
      // `charges_enabled` is deliberately NOT required, and requiring it was a bug
      // that made this unsatisfiable. createConnectAccount requests the `transfers`
      // capability only — correctly, because money flows platform -> creator and a
      // creator never accepts card payments through us. charges_enabled reflects
      // whether the account can PROCESS charges, which needs `card_payments`, so on
      // a transfers-only account it stays false forever. Every affiliate therefore
      // stayed un-onboarded and executePayouts skipped all of them.
      //
      // What actually matters for being paid: Stripe will accept a transfer and
      // the creator can be paid out to their bank.
      const isOnboarded = account.payouts_enabled && account.details_submitted;

      // Selling readiness is separate: accepting a card needs `card_payments`,
      // which Stripe verifies on its own schedule. Read here as well as in the
      // webhook so a brand that never received the webhook can still see the
      // truth by opening the page.
      const canSell = !!account.charges_enabled;

      if (isOnboarded && !user.stripeConnectOnboarded) {
        await storage.updateUser(user.id, { stripeConnectOnboarded: true } as any);
      }
      if (canSell !== !!user.stripeConnectChargesEnabled) {
        await storage.updateUser(user.id, { stripeConnectChargesEnabled: canSell } as any);
      }

      res.json({
        connected: true,
        onboarded: isOnboarded,
        /** Can this account ACCEPT payments — required for in-video checkout. */
        canSell,
        accountId: user.stripeConnectAccountId,
      });
    } catch (error) {
      res.status(500).json({ error: "Failed to get connect status" });
    }
  });

  // ==================== USER PROFILE ROUTES ====================

  // Get user profile
  app.get("/api/profile", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const profile = await storage.getUserProfile(user.id);
      res.json(profile || { userId: user.id });
    } catch (error) {
      res.status(500).json({ error: "Failed to get profile" });
    }
  });

  // Update user profile
  app.put("/api/profile", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const validated = insertUserProfileSchema.partial().parse(req.body);
      const profile = await storage.updateUserProfile(user.id, validated);
      res.json(profile);
    } catch (error) {
      res.status(500).json({ error: "Failed to update profile" });
    }
  });

  // ==================== TOKEN WALLET ROUTES ====================
  //
  // 1 token = $49 of PREPAID PLATFORM CREDIT. TOKENS ARE NEVER CASHABLE — see the
  // module doc at the top of server/wallet.ts for the full statement and for the
  // cash path (commissions → payouts → Stripe transfers) these routes do not touch.
  //
  // Every route below is session-authenticated and scoped to the CALLER'S OWN
  // wallet: the userId passed to the wallet is always `req.session.userId`, never
  // anything from the request body, params or query. Admin overrides are the only
  // exception and they live behind requireAdmin.

  // Wallet balance + full ledger history for the signed-in user.
  app.get("/api/wallet", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const entries = await storage.getTokenLedger(sessionUserId);
      const summary = summarizeLedger(entries);
      // Exact per-row value from ONE FIFO replay: a credit is worth its own grant
      // price, a debit is worth the lots it retired. Derived rather than read off
      // usd_value_cents so the rows sum to `balanceUsdCents` to the cent, even
      // when a spend straddled a reprice and its unit price had to be rounded.
      const rowValues = ledgerRowValues(entries);
      res.json({
        ...summary,
        // Per-row USD value is the row's OWN captured value, never today's price.
        entries: entries.map((e) => ({
          id: e.id,
          deltaTokens: e.deltaTokens,
          reason: e.reason,
          usdValueCents: e.usdValueCents,
          rowUsdCents: rowValues.get(e.id) ?? Math.abs(e.deltaTokens) * e.usdValueCents,
          description: e.description,
          attributionMethod: e.attributionMethod,
          sourceBrandId: e.sourceBrandId,
          attributedVideoId: e.attributedVideoId,
          spendRefType: e.spendRefType,
          spendRefId: e.spendRefId,
          createdAt: e.createdAt,
        })),
      });
    } catch (error) {
      console.error("Wallet read error:", error);
      res.status(500).json({ error: "Failed to get wallet" });
    }
  });

  // Balance-only view, for badges and dashboard tiles.
  app.get("/api/wallet/summary", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const entries = await storage.getTokenLedger(sessionUserId);
      res.json(summarizeLedger(entries));
    } catch (error) {
      res.status(500).json({ error: "Failed to get wallet summary" });
    }
  });

  /**
   * Subsidise the caller's own monthly subscription fee with tokens.
   *
   * Mechanism: a NEGATIVE Stripe customer balance transaction — a credit Stripe
   * drains automatically at the next invoice finalization. Not a coupon (recurs,
   * needs promo-code plumbing) and not a discounted price (forks the price
   * catalogue). See stripeService.applyCustomerCreditCents for the sign warning.
   *
   * THIS HANDLER IS A THIN ADAPTER ON PURPOSE. All of the money logic — the
   * debit-then-Stripe ordering, the idempotency reuse rules and the compensating
   * refund that used to be an unbounded mint — lives in
   * server/subscriptionSubsidy.ts, behind injected dependencies, so the
   * Stripe-failure branch is reachable from a unit test instead of only from a
   * live Stripe outage. See tests/unit/wallet-subsidy-refund.test.ts.
   *
   * `idempotencyKey` is REQUIRED: (spend_ref_type, spend_ref_id) is UNIQUE, so a
   * double-submit with the same key returns the original result instead of
   * debiting twice. It is namespaced by user id so keys cannot collide across
   * accounts.
   */
  app.post("/api/wallet/subsidise-subscription", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const body = z.object({
        tokens: z.number().int().positive().max(50),
        idempotencyKey: z.string().min(8).max(128),
      }).parse(req.body);

      if (!user.stripeCustomerId) {
        return res.status(400).json({
          error: "No billing account on file. Please subscribe first.",
        });
      }

      const result = await applyTokenSubsidy(
        {
          store: storage,
          applyCustomerCredit: (customerId, cents, description, key, metadata) =>
            stripeService.applyCustomerCreditCents(customerId, cents, description, key, metadata),
        },
        {
          // ALWAYS the session user — never anything from the body.
          userId: sessionUserId,
          stripeCustomerId: user.stripeCustomerId,
          tokens: body.tokens,
          idempotencyKey: body.idempotencyKey,
        },
      );

      switch (result.outcome) {
        case "applied":
          return res.json({
            success: true,
            tokensSpent: result.tokensSpent,
            creditCents: result.creditCents,
            balanceAfter: result.balanceAfter,
            stripeBalanceTxnId: result.stripeBalanceTxnId,
          });
        case "already_applied":
          return res.json({
            success: true,
            alreadyApplied: true,
            tokensSpent: result.tokensSpent,
            creditCents: result.creditCents,
            stripeBalanceTxnId: result.stripeBalanceTxnId,
          });
        case "already_refunded":
          // 409, not 200: this key is spent. The client rotates its key on this
          // code, which turns the refusal back into a retry the user can make.
          return res.status(409).json({
            error: "That attempt failed and your tokens were already refunded. Please try again — it will start a fresh application.",
            code: "spend_already_refunded",
            walletEntryId: result.walletEntryId,
            tokensRefunded: result.tokensRefunded,
          });
        case "key_conflict":
          return res.status(409).json({
            error: "This idempotency key was already used for a different number of tokens.",
            code: "idempotency_key_conflict",
            tokensOnRecord: result.tokensOnRecord,
          });
        case "insufficient_tokens":
          return res.status(402).json({
            error: "Insufficient tokens",
            balance: result.balance,
            required: result.required,
          });
        case "spend_failed":
          return res.status(400).json({ error: "Token spend failed", reason: result.reason });
        case "stripe_failed":
          return res.status(502).json({
            error: "Could not apply the credit with Stripe",
            tokensRefunded: result.tokensRefunded,
            walletEntryId: result.walletEntryId,
          });
      }
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      console.error("Wallet subsidy error:", error);
      res.status(500).json({ error: "Failed to apply tokens" });
    }
  });

  // ==================== CREATOR REWARDS ROUTES (RETIRED) ====================
  //
  // creator_rewards is superseded by the token wallet above. Nothing has ever
  // written to it (createCreatorReward had zero callers), so these two readers
  // return [] / zeroes and exist only so the legacy client page keeps rendering
  // while it is repointed at /api/wallet.
  //
  // POST /api/rewards/:id/redeem HAS BEEN DELETED. It called
  // storage.redeemCreatorReward, an `UPDATE ... SET status = 'redeemed'` whose
  // WHERE clause had no predicate on the current status — so two concurrent
  // redeems of the same reward both "succeeded". That is exactly the double-spend
  // this wallet exists to prevent, and it had no client caller. Spending now
  // happens at the point of purchase, not as a standalone redeem.

  // Get creator rewards
  app.get("/api/rewards", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const rewards = await storage.getCreatorRewards(user.id);
      res.json(rewards);
    } catch (error) {
      res.status(500).json({ error: "Failed to get rewards" });
    }
  });

  // Get creator rewards summary
  app.get("/api/rewards/summary", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }
      const summary = await storage.getCreatorRewardsSummary(user.id);
      res.json(summary);
    } catch (error) {
      res.status(500).json({ error: "Failed to get rewards summary" });
    }
  });

  // POST /api/rewards/:id/redeem intentionally REMOVED — see the note above.

  // ==================== PUBLIC CONTACT FORM ====================

  app.post("/api/contact", async (req, res) => {
    try {
      const schema = z.object({
        firstName: z.string().min(1).max(100),
        surname: z.string().min(1).max(100),
        email: z.string().email(),
        role: z.enum(["creator", "brand", "publisher"]),
        igHandle: z.string().min(1).max(60),
        message: z.string().min(1).max(200),
      });
      const data = schema.parse(req.body);
      if (isEmailConfigured()) {
        await sendContactEnquiryEmail(data);
      }
      res.json({ success: true });
    } catch (err: any) {
      if (err?.name === "ZodError") {
        return res.status(400).json({ error: "Invalid form data", details: err.errors });
      }
      console.error("Contact form error:", err);
      res.status(500).json({ error: "Failed to send enquiry" });
    }
  });

  // ==================== ADMIN ROUTES ====================

  async function requireAdmin(req: any, res: any, next: any) {
    const userId = req.session?.userId;
    if (!userId) return res.status(401).json({ error: "Authentication required" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ error: "User not found" });
    if (!user.isAdmin) return res.status(403).json({ error: "Admin access required" });
    req.user = user;
    next();
  }

  // Guard user-scoped resources (payouts, commission ledgers): the caller must be
  // authenticated and either the owner (session user === the :param user id) or an
  // admin. `paramName` is the route param holding the target user/affiliate id.
  function requireSelfOrAdmin(paramName: string) {
    return async (req: any, res: any, next: any) => {
      const userId = req.session?.userId;
      if (!userId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(userId);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (!canAccessUserResource(user, req.params[paramName])) {
        return res.status(403).json({ error: "Forbidden" });
      }
      req.user = user;
      next();
    };
  }

  // ==================== MAILBOX ====================

  // Fetch the raw source rows for a user's role and build the role-aware,
  // time-sorted mailbox feed. Shared by the notifications + unread-count routes
  // so the badge and the page always agree.
  async function loadMailboxNotifications(user: { id: string; role: string }) {
    const sources: MailboxSources = {};

    if (user.role === "affiliate") {
      sources.pubNotifs = await storage.getPublisherNotifications(user.id);
    } else if (user.role === "creator") {
      sources.outreaches = await storage.getBrandOutreachesByCreator(user.id) as any;
    } else if (user.role === "brand") {
      const { db } = await import("./db");
      const { creatorInvitations, brands: brandsTable } = await import("@shared/schema");
      const { eq, desc } = await import("drizzle-orm");
      const userBrands = await db.select().from(brandsTable).where(eq(brandsTable.ownerId, user.id));
      if (userBrands.length > 0) {
        const rows = await db.select().from(creatorInvitations)
          .where(eq(creatorInvitations.brandId, userBrands[0].id))
          .orderBy(desc(creatorInvitations.invitedAt))
          .limit(10);
        // `creator_invitations` timestamps its rows as `invitedAt`; expose it as
        // `createdAt` for the shared mailbox mapper.
        sources.invites = rows.map((inv) => ({ ...inv, createdAt: inv.invitedAt })) as any;
      }
    }

    return buildNotifications(user.role, sources);
  }

  // Get notifications from real platform activity
  app.get("/api/mailbox/notifications", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const notifications = await loadMailboxNotifications(user);
      res.json(notifications);
    } catch (error) {
      console.error("Mailbox error:", error);
      res.json([]);
    }
  });

  // Unread count for the nav badge — mirrors the aggregate feed exactly so the
  // badge and the page never disagree across roles.
  app.get("/api/mailbox/unread-count", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const notifications = await loadMailboxNotifications(user);
      res.json({ count: countUnread(notifications) });
    } catch (error) {
      console.error("Mailbox unread-count error:", error);
      res.json({ count: 0 });
    }
  });

  // Mark a single mailbox item read. Only `pub-<n>` (publisher_notifications)
  // has a persistable read flag; `outreach-`/`invite-` items are computed from
  // business state, so marking them is a no-op the client can safely fire.
  app.patch("/api/mailbox/notifications/:id/read", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const parsed = parseMailboxId(req.params.id);
      if (!parsed) return res.status(400).json({ error: "Invalid notification id" });

      if (parsed.source !== "pub" || parsed.numericId === undefined) {
        // Computed read-state (outreach/invitation) — nothing persistable.
        return res.json({ ok: true, persisted: false });
      }

      const notification = await storage.getPublisherNotification(parsed.numericId);
      if (!notification) return res.status(404).json({ error: "Notification not found" });

      const actor = await storage.getUser(sessionUserId);
      if (!actor?.isAdmin && notification.affiliateId !== sessionUserId) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await storage.markPublisherNotificationRead(parsed.numericId);
      res.json({ ok: true, persisted: true });
    } catch (error) {
      console.error("Mailbox mark-read error:", error);
      res.status(500).json({ error: "Failed to mark read" });
    }
  });

  // Mark all of the current user's persistable notifications read. Only the
  // affiliate publisher_notifications source has a real read flag; for other
  // roles this is a harmless no-op so the client can always call it.
  app.post("/api/mailbox/read-all", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      let updated = 0;
      if (user.role === "affiliate") {
        const pubNotifs = await storage.getPublisherNotifications(user.id);
        for (const pn of pubNotifs) {
          if (!(pn.isRead ?? false)) {
            await storage.markPublisherNotificationRead(pn.id);
            updated++;
          }
        }
      }
      res.json({ ok: true, updated });
    } catch (error) {
      console.error("Mailbox read-all error:", error);
      res.status(500).json({ error: "Failed to mark all read" });
    }
  });

  // ==================== ADMIN ROUTES ====================

  // ── Admin: token wallet override ──────────────────────────────────────────
  //
  // First-touch attribution (server/wallet.ts) is OUR rule, not the client's, and
  // it is a business call — so it has to be correctable by a human. Correcting it
  // means APPENDING two rows, never editing the original:
  //
  //     POST /api/admin/wallet/revoke  { userId: <wrong creator>, tokens: 1, note }
  //     POST /api/admin/wallet/grant   { userId: <right creator>, tokens: 1, note }
  //
  // Both go through the same locked, balance-re-verified path as a user spend, so
  // an override can never drive a balance negative. The one-token-per-brand unique
  // index only constrains `brand_conversion` rows, so the corrective pair inserts
  // cleanly beside the original mint and the audit trail stays intact.

  // Read any user's wallet (admin, read-only).
  app.get("/api/admin/wallet/:userId", requireAdmin, async (req, res) => {
    try {
      const entries = await storage.getTokenLedger(req.params.userId);
      res.json({ userId: req.params.userId, ...summarizeLedger(entries), entries });
    } catch (error) {
      res.status(500).json({ error: "Failed to read wallet" });
    }
  });

  app.post("/api/admin/wallet/grant", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        userId: z.string().min(1),
        tokens: z.number().int().positive().max(50),
        // Required, not optional: an unexplained grant of platform credit is not
        // something the ledger should be able to represent.
        note: z.string().min(3).max(500),
      }).parse(req.body);

      const target = await storage.getUser(body.userId);
      if (!target) return res.status(404).json({ error: "User not found" });

      const result = await creditTokens(storage, {
        userId: body.userId,
        tokens: body.tokens,
        reason: "admin_grant",
        description: "Admin grant / attribution override",
        adminNote: `${body.note} (by admin ${(req as any).user?.id})`,
      });
      if (!result.ok) return res.status(400).json({ error: "Grant failed", reason: result.error });

      console.log(`[Wallet] Admin ${(req as any).user?.id} granted ${body.tokens} token(s) to ${body.userId}`);
      res.json({ success: true, entry: result.entry, balanceAfter: result.balanceAfter });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      console.error("Admin wallet grant error:", error);
      res.status(500).json({ error: "Failed to grant tokens" });
    }
  });

  app.post("/api/admin/wallet/revoke", requireAdmin, async (req, res) => {
    try {
      const body = z.object({
        userId: z.string().min(1),
        tokens: z.number().int().positive().max(50),
        note: z.string().min(3).max(500),
      }).parse(req.body);

      const result = await revokeTokens(storage, {
        userId: body.userId,
        tokens: body.tokens,
        description: "Admin revoke / attribution override",
        adminNote: `${body.note} (by admin ${(req as any).user?.id})`,
      });

      if (!result.ok) {
        if (result.error === "insufficient_tokens") {
          // The wrongly-credited user already spent it. The non-negative balance
          // invariant is absolute, so this is refused rather than forced through —
          // recovering already-consumed value is a business action, not a ledger edit.
          return res.status(409).json({
            error: "Cannot revoke — balance would go negative (tokens already spent)",
            balance: result.balance,
            required: result.required,
          });
        }
        return res.status(400).json({ error: "Revoke failed", reason: result.error });
      }

      console.log(`[Wallet] Admin ${(req as any).user?.id} revoked ${body.tokens} token(s) from ${body.userId}`);
      res.json({ success: true, entry: result.entry, balanceAfter: result.balanceAfter });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: error.errors });
      console.error("Admin wallet revoke error:", error);
      res.status(500).json({ error: "Failed to revoke tokens" });
    }
  });

  // Admin dashboard overview stats
  app.get("/api/admin/dashboard", requireAdmin, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { users, videos, brands, campaigns, brandSubscriptions } = await import("@shared/schema");
      const { sql, count } = await import("drizzle-orm");

      const [userCount] = await db.select({ count: count() }).from(users);
      const [videoCount] = await db.select({ count: count() }).from(videos);
      const [brandCount] = await db.select({ count: count() }).from(brands);
      const [campaignCount] = await db.select({ count: count() }).from(campaigns);

      // Count by role
      const roleCounts = await db.select({
        role: users.role,
        count: count(),
      }).from(users).groupBy(users.role);

      // Active subscriptions
      const [activeSubCount] = await db.select({ count: count() })
        .from(brandSubscriptions)
        .where(sql`${brandSubscriptions.status} = 'active'`);

      res.json({
        totalUsers: userCount?.count ?? 0,
        totalVideos: videoCount?.count ?? 0,
        totalBrands: brandCount?.count ?? 0,
        totalCampaigns: campaignCount?.count ?? 0,
        activeSubscriptions: activeSubCount?.count ?? 0,
        usersByRole: Object.fromEntries(roleCounts.map(r => [r.role, r.count])),
      });
    } catch (error) {
      console.error("Admin dashboard error:", error);
      res.status(500).json({ error: "Failed to load dashboard stats" });
    }
  });

  // Admin user list
  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { users } = await import("@shared/schema");
      const { desc } = await import("drizzle-orm");

      const allUsers = await db.select({
        id: users.id,
        username: users.username,
        email: users.email,
        displayName: users.displayName,
        role: users.role,
        isAdmin: users.isAdmin,
        freeAccess: users.freeAccess,
        emailVerified: users.emailVerified,
        createdAt: users.createdAt,
        commissionRateOverride: users.commissionRateOverride,
        stripeConnectAccountId: users.stripeConnectAccountId,
        stripeConnectOnboarded: users.stripeConnectOnboarded,
      }).from(users).orderBy(desc(users.createdAt));

      res.json(allUsers);
    } catch (error) {
      console.error("Admin users error:", error);
      res.status(500).json({ error: "Failed to load users" });
    }
  });

  // Admin: view/adjust platform fee & commission defaults
  app.get("/api/admin/settings/fees", requireAdmin, async (_req, res) => {
    try {
      res.json(resolveFeeConfig(await storage.getPlatformSettings()));
    } catch (error) {
      console.error("Get fee settings error:", error);
      res.status(500).json({ error: "Failed to load fee settings" });
    }
  });

  app.patch("/api/admin/settings/fees", requireAdmin, async (req, res) => {
    try {
      const patch: Record<string, string | null> = {};
      for (const key of ["marketplaceFeePct", "creatorPct", "publisherPct"] as const) {
        if (!(key in (req.body ?? {}))) continue;
        const raw = req.body[key];
        if (raw === null || raw === "") { patch[key] = null; continue; }
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0 || n > 100) {
          return res.status(400).json({ error: `Invalid ${key}: must be 0–100` });
        }
        patch[key] = n.toFixed(2);
      }
      const saved = await storage.updatePlatformSettings(patch);
      res.json(resolveFeeConfig(saved));
    } catch (error) {
      console.error("Update fee settings error:", error);
      res.status(500).json({ error: "Failed to update fee settings" });
    }
  });

  // Admin: approve a pending commission (makes it eligible for payout)
  app.post("/api/admin/commissions/:id/approve", requireAdmin, async (req, res) => {
    try {
      // Only pending -> approved is allowed. Without this guard a reversed/paid/rejected row
      // could be flipped back to approved and re-paid by the payout engine.
      const existing = await storage.getCommissionTransaction(req.params.id);
      if (!existing) return res.status(404).json({ error: "Commission not found" });
      if (existing.status !== "pending") {
        return res.status(409).json({ error: `Commission is ${existing.status} and cannot be approved` });
      }

      const updated = await storage.updateCommissionTransactionStatus(req.params.id, "approved");
      if (!updated) return res.status(404).json({ error: "Commission not found" });

      // Notify the affiliate that their commission was approved (best-effort).
      if (isEmailConfigured()) {
        try {
          const affiliate = await storage.getUser(updated.affiliateId);
          if (affiliate?.email) {
            await sendCommissionApprovedEmail({
              affiliateName: affiliate.displayName,
              affiliateEmail: affiliate.email,
              commissionAmount: formatMoney(updated.commissionAmount),
              saleAmount: formatMoney(updated.saleAmount),
              commissionRate: updated.commissionRate,
            });
          }
        } catch (emailErr) {
          console.error("Commission approved email failed:", emailErr);
        }
      }

      res.json(updated);
    } catch (error) {
      console.error("Approve commission error:", error);
      res.status(500).json({ error: "Failed to approve commission" });
    }
  });

  // Admin: list commissions by status (default "pending"), enriched with the
  // affiliate's name/email and sorted newest-first — drives the Money Ops
  // commissions table and the payout-run preview.
  app.get("/api/admin/commissions", requireAdmin, async (req, res) => {
    try {
      const status = String(req.query.status ?? "pending");
      const rows = await storage.getCommissionsByStatus(status);

      // Enrich each row with the affiliate's display name/email (batched lookups).
      const affiliateIds = Array.from(new Set(rows.map(r => r.affiliateId)));
      const affiliates = new Map<string, { displayName: string; email: string }>();
      await Promise.all(affiliateIds.map(async (id) => {
        const u = await storage.getUser(id);
        if (u) affiliates.set(id, { displayName: u.displayName, email: u.email });
      }));

      const enriched = rows
        .map(r => ({
          ...r,
          affiliateName: affiliates.get(r.affiliateId)?.displayName ?? "Unknown affiliate",
          affiliateEmail: affiliates.get(r.affiliateId)?.email ?? "",
        }))
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });

      res.json(enriched);
    } catch (error) {
      console.error("Admin commissions error:", error);
      res.status(500).json({ error: "Failed to load commissions" });
    }
  });

  /**
   * Admin: what each brand owes in marketplace fees, ready to invoice.
   *
   * The fee is recorded per verified store order (server/feeAccruals.ts) rather
   * than collected automatically, because Materialized is not in the payment
   * path for a sale on a brand's own storefront — there is no Stripe
   * application fee to take. This endpoint is what turns that record into a
   * bill: pick a period, read the total per brand, raise the invoice.
   *
   * `?from=`/`?to=` are ISO dates. Voided (refunded) rows are already excluded.
   * Results are grouped per currency as well as per brand — summing cents
   * across currencies would be meaningless.
   */
  app.get("/api/admin/fee-accruals/summary", requireAdmin, async (req, res) => {
    try {
      const parseDate = (v: unknown): Date | undefined => {
        if (typeof v !== "string" || !v) return undefined;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? undefined : d;
      };

      const rows = await storage.getFeeAccrualSummary({
        brandUserId: typeof req.query.brandUserId === "string" ? req.query.brandUserId : undefined,
        from: parseDate(req.query.from),
        to: parseDate(req.query.to),
      });

      res.json({
        rows,
        totals: rows.reduce((acc, r) => ({
          orders: acc.orders + r.orders,
          attributedOrders: acc.attributedOrders + r.attributedOrders,
          grossSalesCents: acc.grossSalesCents + r.grossSalesCents,
          marketplaceFeeCents: acc.marketplaceFeeCents + r.marketplaceFeeCents,
          platformCents: acc.platformCents + r.platformCents,
        }), { orders: 0, attributedOrders: 0, grossSalesCents: 0, marketplaceFeeCents: 0, platformCents: 0 }),
      });
    } catch (error) {
      console.error("Fee accrual summary error:", error);
      res.status(500).json({ error: "Failed to load fee accruals" });
    }
  });

  /**
   * Admin: raise a marketplace-fee invoice for one brand and period.
   *
   * Creates a DRAFT by default — nothing is billed until it is finalised, which
   * is a separate call, so the first invoices a brand receives get a human look
   * first. Pass `finalize: true` to issue it immediately.
   *
   * Safe to retry. The accruals are claimed before Stripe is called, so a second
   * concurrent request finds nothing to bill, and a run interrupted mid-flight
   * resumes onto the SAME Stripe invoice rather than creating a second one.
   */
  app.post("/api/admin/fee-invoices", requireAdmin, async (req, res) => {
    try {
      const { brandUserId, from, to, finalize, currency, daysUntilDue } = req.body ?? {};
      if (typeof brandUserId !== "string" || !brandUserId) {
        return res.status(400).json({ error: "brandUserId is required" });
      }
      const periodStart = new Date(from);
      const periodEnd = new Date(to);
      if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
        return res.status(400).json({ error: "from and to must be valid dates" });
      }
      if (periodEnd <= periodStart) {
        return res.status(400).json({ error: "to must be after from" });
      }

      const result = await generateFeeInvoice(storage, feeInvoiceStripeAdapter, {
        brandUserId,
        currency: typeof currency === "string" && currency ? currency : getPlatformCurrency(),
        periodStart,
        periodEnd,
        daysUntilDue: Number(daysUntilDue) || 14,
      });

      // Finalising is a SEPARATE call on purpose. It used to sit inside
      // generateFeeInvoice's try/catch, where any failure after the invoice was
      // sent released the accruals and let the next run bill them again.
      if (result.status === "invoiced" && finalize === true && result.stripeInvoiceId) {
        const fin = await finalizeFeeInvoice(storage, feeInvoiceStripeAdapter, result.feeInvoiceId!, result.stripeInvoiceId);
        if (!fin.ok) {
          // 207: the draft exists and may well have been SENT. Never reported as
          // a clean success, and never as a plain failure that invites a re-run.
          return res.status(207).json({ ...result, finalized: fin.finalized, needsAttention: fin.needsAttention, error: fin.error });
        }
        result.finalized = true;
        result.hostedInvoiceUrl = fin.hostedInvoiceUrl ?? result.hostedInvoiceUrl;
      }

      // A failed Stripe call is reported as 502, not 200 — the claim has been
      // released and the accruals are billable again, but the caller must not
      // read this as "invoiced".
      if (result.status === "failed") return res.status(502).json(result);
      res.json(result);
    } catch (error) {
      console.error("Fee invoice generation error:", error);
      res.status(500).json({ error: "Failed to generate fee invoice" });
    }
  });

  /** Admin: finalise a draft fee invoice, which is what actually sends it. */
  app.post("/api/admin/fee-invoices/:id/finalize", requireAdmin, async (req, res) => {
    try {
      const invoice = await storage.getFeeInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Fee invoice not found" });
      if (!invoice.stripeInvoiceId) {
        return res.status(409).json({ error: "This invoice has no Stripe invoice yet" });
      }
      if (invoice.finalized) return res.json({ ok: true, alreadyFinalized: true });

      const final = await stripeService.finalizeFeeInvoice(invoice.stripeInvoiceId);
      if (!final.total) {
        // The zero-total trap: a finalised invoice with no lines is auto-marked
        // paid, so this would otherwise report success while nobody is billed.
        return res.status(500).json({
          error: `Invoice ${final.id} finalised with a zero total — the line item did not attach.`,
        });
      }
      await storage.markInvoiceFinalized(invoice.id, final.hosted_invoice_url ?? null);
      res.json({ ok: true, stripeInvoiceId: final.id, total: final.total, hostedInvoiceUrl: final.hosted_invoice_url });
    } catch (error) {
      console.error("Fee invoice finalize error:", error);
      res.status(500).json({ error: "Failed to finalize invoice" });
    }
  });

  /**
   * Admin: cancel a fee invoice and release its accruals.
   *
   * Needed because a draft voided in the Stripe dashboard would otherwise leave
   * its accruals permanently marked invoiced — a receivable stuck behind an
   * invoice that no longer exists.
   */
  app.post("/api/admin/fee-invoices/:id/release", requireAdmin, async (req, res) => {
    try {
      const invoice = await storage.getFeeInvoice(req.params.id);
      if (!invoice) return res.status(404).json({ error: "Fee invoice not found" });
      if (invoice.finalized) {
        return res.status(409).json({
          error: "This invoice has been finalised and sent. Void it in Stripe and credit the brand there.",
        });
      }
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "released by admin";
      await storage.releaseInvoiceClaim(invoice.id, reason, "void");
      res.json({ ok: true, released: invoice.lineCount });
    } catch (error) {
      console.error("Fee invoice release error:", error);
      res.status(500).json({ error: "Failed to release invoice" });
    }
  });

  /** Admin: fee invoices raised, newest first. */
  app.get("/api/admin/fee-invoices", requireAdmin, async (req, res) => {
    try {
      const rows = await storage.listFeeInvoices(
        typeof req.query.brandUserId === "string" ? req.query.brandUserId : undefined,
      );
      res.json(rows);
    } catch (error) {
      console.error("Fee invoice list error:", error);
      res.status(500).json({ error: "Failed to load fee invoices" });
    }
  });

  /** Admin: the individual accrual rows, for reconciling a summary line. */
  app.get("/api/admin/fee-accruals", requireAdmin, async (req, res) => {
    try {
      const rows = await storage.listFeeAccruals({
        brandUserId: typeof req.query.brandUserId === "string" ? req.query.brandUserId : undefined,
        status: typeof req.query.status === "string" ? req.query.status : undefined,
        limit: Number(req.query.limit) || 200,
      });
      res.json(rows);
    } catch (error) {
      console.error("Fee accrual list error:", error);
      res.status(500).json({ error: "Failed to load fee accruals" });
    }
  });



  // ==================== CARD ON FILE (no subscription needed) ================
  //
  // A card could previously only be captured as a side effect of subscribing,
  // so an account on permanent free access had no payment method and overage
  // could never be charged to it. A free account is not a no-payment-method
  // account — the two got conflated because subscribing was the only path.

  /** Start Stripe Checkout in setup mode to vault a card. */
  app.post("/api/billing/payment-method/setup", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      // Reuse the customer if there is one; a second customer for the same
      // person splits their cards and invoices across two records.
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user.email, user.id, user.displayName);
        customerId = customer.id;
        await storage.updateUser(user.id, { stripeCustomerId: customerId } as any);
      }

      const baseUrl = process.env.APP_URL || req.headers.origin || `${req.protocol}://${req.get("host")}`;
      const session = await stripeService.createCardSetupCheckout(
        customerId,
        `${baseUrl}/creator/more?card=saved`,
        `${baseUrl}/creator/more?card=cancelled`,
        { userId: user.id },
      );
      res.json({ url: session.url });
    } catch (error) {
      console.error("Card setup error:", error);
      res.status(500).json({ error: "Could not start card setup" });
    }
  });

  /** What card is on file, if any. */
  app.get("/api/billing/payment-method", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });
      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });
      if (!user.stripeCustomerId) return res.json({ card: null });

      const card = await stripeService.getDefaultPaymentMethod(user.stripeCustomerId);
      res.json({ card });
    } catch (error) {
      console.error("Payment method read error:", error);
      res.status(500).json({ error: "Could not read payment method" });
    }
  });

  // ==================== VOUCHERS ====================
  //
  // Replaces one shared string in an env var that was the same for everyone,
  // uncapped, never expired, and revocable only by rotating it for everybody.

  /** Admin: mint a voucher. The code is generated unless one is supplied. */
  app.post("/api/admin/vouchers", requireAdmin, async (req, res) => {
    try {
      const {
        code, label, grantType, brandUserId, roleRestriction, maxRedemptions, expiresAt,
      } = req.body ?? {};

      // Who the whole batch is being handed to. Set once at mint time so 80
      // codes do not have to be labelled one at a time afterwards.
      const assignedTo =
        typeof req.body?.assignedTo === "string" && req.body.assignedTo.trim()
          ? req.body.assignedTo.trim().slice(0, 200)
          : null;

      if (grantType && !["free_access", "waive_setup_fee"].includes(grantType)) {
        return res.status(400).json({ error: "grantType must be free_access or waive_setup_fee" });
      }
      if (roleRestriction && !["creator", "brand", "affiliate"].includes(roleRestriction)) {
        return res.status(400).json({ error: "roleRestriction must be a valid role" });
      }
      const cap = maxRedemptions == null || maxRedemptions === "" ? null : Number(maxRedemptions);
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) {
        return res.status(400).json({ error: "maxRedemptions must be a whole number of 1 or more" });
      }
      const expiry = expiresAt ? new Date(expiresAt) : null;
      if (expiry && Number.isNaN(expiry.getTime())) {
        return res.status(400).json({ error: "expiresAt must be a valid date" });
      }

      /**
       * `quantity` mints N DISTINCT codes in one batch.
       *
       * The client's actual case: hand a partner 80 codes to distribute to their
       * network. That is not one code redeemable 80 times — a shared code cannot
       * be traced to a recipient or revoked for one of them, and once forwarded
       * it is forwarded everywhere. Both shapes are supported; maxRedemptions
       * still covers the shared-code case.
       */
      const quantity = Math.max(1, Math.min(Number(req.body?.quantity) || 1, MAX_BATCH));
      const custom = typeof code === "string" && code.trim() ? normaliseCode(code) : null;

      if (quantity > 1 && custom) {
        return res.status(400).json({
          error: "A custom code can only be used when minting one voucher.",
        });
      }

      let codes: string[];
      if (custom) {
        if (await storage.getVoucherByCode(custom)) {
          return res.status(409).json({ error: "That code already exists" });
        }
        codes = [custom];
      } else {
        try {
          codes = await mintCodes(quantity, async (c) => !!(await storage.getVoucherByCode(c)));
        } catch {
          return res.status(500).json({ error: "Could not generate a unique code" });
        }
      }

      const batchId = quantity > 1 ? crypto.randomUUID() : null;
      const created = [];

      for (const finalCode of codes) {
        created.push(await storage.createVoucher({
          code: finalCode,
          label: typeof label === "string" && label.trim() ? label.trim() : null,
          grantType: grantType ?? "free_access",
          brandUserId: typeof brandUserId === "string" && brandUserId ? brandUserId : null,
          roleRestriction: roleRestriction ?? null,
          maxRedemptions: cap,
          expiresAt: expiry,
          createdBy: (req.session as any)?.userId ?? null,
          batchId,
          assignedTo,
        }));
      }

      res.status(201).json({ count: created.length, batchId, vouchers: created });
    } catch (error) {
      console.error("Voucher create error:", error);
      res.status(500).json({ error: "Failed to create voucher" });
    }
  });

  /** Admin: every voucher with how many of its seats are gone. */
  app.get("/api/admin/vouchers", requireAdmin, async (_req, res) => {
    try {
      const rows = await storage.listVouchers();
      res.json(rows.map((v) => ({
        ...v,
        seatsRemaining: v.maxRedemptions == null ? null : Math.max(0, v.maxRedemptions - v.redemptionCount),
      })));
    } catch (error) {
      console.error("Voucher list error:", error);
      res.status(500).json({ error: "Failed to load vouchers" });
    }
  });

  /** Admin: note who a code was handed to. Free text — most recipients have no account yet. */
  app.patch("/api/admin/vouchers/:id/assignee", requireAdmin, async (req, res) => {
    try {
      const raw = req.body?.assignedTo;
      const value = typeof raw === "string" && raw.trim() ? raw.trim().slice(0, 200) : null;
      const ok = await storage.setVoucherAssignee(req.params.id, value);
      if (!ok) return res.status(404).json({ error: "Voucher not found" });
      res.json({ ok: true, assignedTo: value });
    } catch (error) {
      console.error("Voucher assignee error:", error);
      res.status(500).json({ error: "Failed to save" });
    }
  });

  /**
   * Admin: revoke. Sets a timestamp rather than deleting — the accounts already
   * created under this voucher keep their access and stay explicable.
   */
  app.post("/api/admin/vouchers/:id/revoke", requireAdmin, async (req, res) => {
    try {
      const done = await storage.revokeVoucher(req.params.id);
      if (!done) return res.status(409).json({ error: "Voucher not found, or already revoked" });
      res.json({ ok: true });
    } catch (error) {
      console.error("Voucher revoke error:", error);
      res.status(500).json({ error: "Failed to revoke voucher" });
    }
  });

  /**
   * Public: check a code before submitting the signup form.
   *
   * Deliberately says only whether it is usable and what it grants — never who
   * it belongs to or how it was issued, since anyone can call this.
   */
  app.post("/api/vouchers/check", async (req, res) => {
    try {
      const raw = typeof req.body?.code === "string" ? req.body.code : "";
      if (!raw.trim()) return res.status(400).json({ error: "A code is required" });
      const role = typeof req.body?.role === "string" ? req.body.role : "creator";

      const voucher = await storage.getVoucherByCode(normaliseCode(raw));
      const check = checkRedeemable(voucher, { role, redemptionCount: 0 });
      if (!check.ok) return res.status(404).json({ valid: false, message: check.message, reason: check.reason });

      const grants = grantsOf(check.voucher);
      res.json({
        valid: true,
        message: grants.freeAccess
          ? "Voucher accepted — this account will have free access."
          : "Voucher accepted — your setup fee will be waived.",
      });
    } catch (error) {
      console.error("Voucher check error:", error);
      res.status(500).json({ error: "Could not check that code" });
    }
  });

  // Admin: full payout history, newest-first, enriched with the affiliate's name.
  app.get("/api/admin/payouts", requireAdmin, async (_req, res) => {
    try {
      const rows = await storage.getAllPayouts();

      const userIds = Array.from(new Set(rows.map(r => r.userId)));
      const names = new Map<string, string>();
      await Promise.all(userIds.map(async (id) => {
        const u = await storage.getUser(id);
        if (u) names.set(id, u.displayName);
      }));

      const enriched = rows.map(r => ({
        ...r,
        affiliateName: names.get(r.userId) ?? "Unknown affiliate",
      }));

      res.json(enriched);
    } catch (error) {
      console.error("Admin payouts error:", error);
      res.status(500).json({ error: "Failed to load payouts" });
    }
  });

  // Admin: run affiliate payouts — batch approved commissions per affiliate and
  // transfer to their Stripe Connect account (idempotent, min €0.50, onboarded only).
  app.post("/api/admin/payouts/run", requireAdmin, async (_req, res) => {
    try {
      // Same code path the scheduler uses — see server/payoutRunner.ts. Two
      // separate implementations of "move the money" would drift, and the one
      // that drifts is the unattended one nobody is watching.
      const summary = await runPayouts();

      // needsReconciliation means money LEFT but the ledger did not record it.
      // Reported as 207 so it cannot be mistaken for a clean run in a dashboard
      // or a log filter — it is the one outcome that needs a human before the
      // next run.
      if (summary.needsReconciliation.length) return res.status(207).json(summary);
      res.json(summary);
    } catch (error) {
      console.error("Payout run error:", error);
      res.status(500).json({ error: "Failed to run payouts" });
    }
  });

  /** Admin: the scheduled-run ledger — what ran, when, and what it did. */
  app.get("/api/admin/scheduled-runs", requireAdmin, async (req, res) => {
    try {
      const runs = await storage.listScheduledRuns(Number(req.query.limit) || 50);
      res.json({ enabled: schedulerEnabled(), runs });
    } catch (error) {
      console.error("Scheduled runs error:", error);
      res.status(500).json({ error: "Failed to load scheduled runs" });
    }
  });

  // Admin update user
  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { role, isAdmin, freeAccess, commissionRateOverride } = req.body;
      const patch: any = { role, isAdmin, freeAccess };
      if ("commissionRateOverride" in (req.body ?? {})) {
        if (commissionRateOverride === null || commissionRateOverride === "") {
          patch.commissionRateOverride = null;
        } else {
          const n = Number(commissionRateOverride);
          if (!Number.isFinite(n) || n < 0 || n > 100) {
            return res.status(400).json({ error: "Invalid commissionRateOverride: must be 0–100" });
          }
          patch.commissionRateOverride = n.toFixed(2);
        }
      }
      const updated = await storage.updateUser(id, patch as any);
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json(sanitizeUser(updated));
    } catch (error) {
      res.status(500).json({ error: "Failed to update user" });
    }
  });

  // Admin list all videos
  app.get("/api/admin/videos", requireAdmin, async (req, res) => {
    try {
      const { db } = await import("./db");
      const { videos, users } = await import("@shared/schema");
      const { desc, eq } = await import("drizzle-orm");

      const allVideos = await db.select({
        id: videos.id,
        title: videos.title,
        status: videos.status,
        totalViews: videos.totalViews,
        totalClicks: videos.totalClicks,
        totalRevenue: videos.totalRevenue,
        createdAt: videos.createdAt,
        creatorId: videos.creatorId,
      }).from(videos).orderBy(desc(videos.createdAt));

      // Enrich with creator names
      const enriched = await Promise.all(allVideos.map(async (v) => {
        const creator = await storage.getUser(v.creatorId);
        return { ...v, creatorName: creator?.displayName ?? "Unknown" };
      }));

      res.json(enriched);
    } catch (error) {
      res.status(500).json({ error: "Failed to load videos" });
    }
  });

  // Admin list all brands
  app.get("/api/admin/brands", requireAdmin, async (req, res) => {
    try {
      const allBrands = await storage.getBrands();
      res.json(allBrands);
    } catch (error) {
      res.status(500).json({ error: "Failed to load brands" });
    }
  });

  /**
   * Switch a brand's inventory on (or off) without a subscription.
   *
   * This is the admin-operated form of the client's "$29 admin fee, 30-day
   * window, no subscription" rule. The admin verifies the brand and settles the
   * $29 out of band, then grants the window here. The self-serve version was cut
   * after review found a creator could take ownership of another brand's
   * catalogue through it — see the migration header and the git stash.
   *
   * Body: { days?: number }  — omit or pass 0/negative to REVOKE immediately.
   *       { note?: string }  — free text, e.g. the invoice reference.
   */
  app.put("/api/admin/brands/:id/inventory-access", requireAdmin, async (req, res) => {
    try {
      const brand = await storage.getBrand(req.params.id);
      if (!brand) return res.status(404).json({ error: "Brand not found" });

      const rawDays = req.body?.days;
      const days = rawDays === undefined || rawDays === null ? 0 : Number(rawDays);
      if (!Number.isFinite(days) || days > 365) {
        return res.status(400).json({ error: "days must be a number no greater than 365" });
      }

      // days <= 0 revokes. Writing a past timestamp rather than NULL keeps the
      // grant history readable ("was on until X") instead of erasing it.
      const until = days > 0
        ? new Date(Date.now() + days * 24 * 60 * 60 * 1000)
        : new Date(Date.now() - 1000);

      const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 500) : null;
      const adminId = (req.session as any)?.userId ?? null;

      const updated = await storage.updateBrand(brand.id, {
        inventoryAccessUntil: until,
        inventoryAccessGrantedBy: adminId,
        inventoryAccessNote: note,
      } as any);

      console.log(
        `[Admin] Inventory access for brand ${brand.id} (${brand.name}) ` +
        `${days > 0 ? `granted ${days}d until ${until.toISOString()}` : "REVOKED"} by ${adminId}`,
      );
      res.json({
        brand: updated,
        inventoryAccessUntil: until,
        active: days > 0,
        note,
      });
    } catch (error) {
      console.error("[Admin] inventory-access update failed:", error);
      res.status(500).json({ error: "Failed to update inventory access" });
    }
  });

  // GET all outreach requests (admin pipeline view)
  app.get("/api/admin/pipeline", requireAdmin, async (req, res) => {
    try {
      const all = await storage.getAllBrandOutreaches();
      const enriched = await Promise.all(all.map(async (o) => {
        const creator = o.creatorId ? await storage.getUser(o.creatorId) : null;
        let videoViews = 0;
        let videoClicks = 0;
        if (o.videoId) {
          const events = await storage.getAnalyticsEvents(o.videoId);
          videoViews = events.filter(e => e.eventType === "view").length;
          videoClicks = events.filter(e => e.eventType === "click").length;
        }
        return {
          ...o,
          creatorName: creator?.displayName ?? "Unknown Creator",
          creatorEmail: creator?.email ?? null,
          videoViews,
          videoClicks,
        };
      }));
      res.json(enriched);
    } catch (err) {
      console.error("Admin pipeline error:", err);
      res.status(500).json({ error: "Failed to fetch pipeline" });
    }
  });

  // PATCH admin updates (notes, agreement status, subscription)
  app.patch("/api/admin/pipeline/:id", requireAdmin, async (req, res) => {
    try {
      const { adminNotes, agreementStartedAt, agreementSignedAt, brandSubscribedAt, status } = req.body;
      const updates: any = {};
      if (adminNotes !== undefined) updates.adminNotes = adminNotes;
      if (agreementStartedAt !== undefined) updates.agreementStartedAt = agreementStartedAt ? new Date(agreementStartedAt) : null;
      if (agreementSignedAt !== undefined) updates.agreementSignedAt = agreementSignedAt ? new Date(agreementSignedAt) : null;
      if (brandSubscribedAt !== undefined) updates.brandSubscribedAt = brandSubscribedAt ? new Date(brandSubscribedAt) : null;
      if (status !== undefined) updates.status = status;
      const updated = await storage.updateBrandOutreachAdmin(req.params.id, updates);
      if (!updated) return res.status(404).json({ error: "Outreach not found" });
      res.json(updated);
    } catch (err) {
      console.error("Admin patch error:", err);
      res.status(500).json({ error: "Failed to update outreach" });
    }
  });

  // POST send automated follow-up email
  app.post("/api/admin/pipeline/:id/follow-up", requireAdmin, async (req, res) => {
    try {
      const { followUpType } = req.body;
      const outreach = await storage.getBrandOutreach(req.params.id);
      if (!outreach) return res.status(404).json({ error: "Outreach not found" });

      const baseUrl = process.env.BASE_URL ?? req.get("host") ?? "join.materialized.com";
      const subscribeUrl = `https://${baseUrl}/brand`;
      // When DOCUSIGN_* is unset this returns the exact static fallback
      // (process.env.DOCUSIGN_SIGNING_URL ?? "https://app.docusign.com/templates");
      // when configured it mints a real embedded-signing envelope URL. Never throws.
      const signCompleteUrl = `https://${baseUrl}/brand-outreach/signed/${outreach.id}`;
      const docuSignUrl = await resolveSigningUrl(outreach, signCompleteUrl);

      const events = outreach.videoId ? await storage.getAnalyticsEvents(outreach.videoId) : [];
      const videoViews = events.filter(e => e.eventType === "view").length;
      const videoClicks = events.filter(e => e.eventType === "click").length;

      if (!isEmailConfigured()) {
        await storage.recordOutreachFollowUp(outreach.id, followUpType);
        return res.json({ success: true, emailSent: false, message: "Follow-up recorded (email not configured)" });
      }

      switch (followUpType) {
        case "docusign_reminder":
          await sendDocuSignReminderEmail({
            prContactName: outreach.prContactName,
            prContactEmail: outreach.prContactEmail,
            brandName: outreach.brandName,
            videoTitle: outreach.videoTitle ?? "Your shoppable video",
            docuSignUrl,
          });
          break;
        case "results_excitement":
          await sendVideoResultsExcitementEmail({
            prContactName: outreach.prContactName,
            prContactEmail: outreach.prContactEmail,
            brandName: outreach.brandName,
            videoTitle: outreach.videoTitle ?? "Your shoppable video",
            videoViews,
            videoClicks,
            subscribeUrl,
          });
          break;
        case "global_pitch":
          await sendGlobalPitchEmail({
            prContactName: outreach.prContactName,
            prContactEmail: outreach.prContactEmail,
            brandName: outreach.brandName,
            subscribeUrl,
          });
          break;
        case "subscription_nudge":
          await sendSubscriptionNudgeEmail({
            prContactName: outreach.prContactName,
            prContactEmail: outreach.prContactEmail,
            brandName: outreach.brandName,
            subscribeUrl,
          });
          break;
        default:
          return res.status(400).json({ error: "Unknown follow-up type" });
      }

      await storage.recordOutreachFollowUp(outreach.id, followUpType);
      res.json({ success: true, emailSent: true });
    } catch (err) {
      console.error("Follow-up email error:", err);
      res.status(500).json({ error: "Failed to send follow-up" });
    }
  });

  // POST make a user admin (for bootstrapping — protected by a secret header)
  app.post("/api/admin/make-admin", async (req, res) => {
    const bootstrapSecret = process.env.ADMIN_BOOTSTRAP_SECRET;
    if (!bootstrapSecret) {
      return res.status(403).json({ error: "Bootstrap not configured" });
    }
    const secret = req.headers["x-admin-secret"];
    if (!secret || secret !== bootstrapSecret) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: "userId required" });
    try {
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });
      const [updated] = await (await import("./db")).db
        .update((await import("@shared/schema")).users)
        .set({ isAdmin: true })
        .where((await import("drizzle-orm")).eq((await import("@shared/schema")).users.id, userId))
        .returning();
      res.json({ success: true, user: sanitizeUser(updated) });
    } catch (err) {
      res.status(500).json({ error: "Failed to make admin" });
    }
  });

  // ==================== VIDEO CATEGORIES ROUTES ====================

  // Get available video categories
  app.get("/api/video-categories", async (req, res) => {
    res.json(VIDEO_CATEGORY_OPTIONS);
  });

  // ─── Brand Billing & Account Routes ─────────────────────────────────────────

  // Subscription
  app.get("/api/brand/subscription", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const sub = await storage.getBrandSubscription(userId);
      res.json(sub || null);
    } catch (e) { res.status(500).json({ error: "Failed to fetch subscription" }); }
  });

  /**
   * ADMIN ONLY — grant/adjust a subscription without payment.
   *
   * This used to take the SESSION user and a client-supplied body, so any logged-in
   * user could PUT {plan:"pro", status:"active"} and hand themselves a free
   * subscription: entitlement keys off subscription STATUS, so that is full paid
   * access for nothing. No client ever called it (the app only ever GETs this
   * path), so it was pure attack surface.
   *
   * Kept rather than deleted because a manual grant is genuinely needed — comping
   * an account, restoring after a billing incident, or switching on a demo brand
   * so its inventory is discoverable. `userId` names the target; omit it to act on
   * yourself.
   */
  app.put("/api/brand/subscription", requireAdmin, async (req, res) => {
    try {
      const targetUserId = (req.body?.userId as string | undefined) ?? (req.session as any)?.userId;
      if (!targetUserId) return res.status(400).json({ error: "userId is required" });
      const target = await storage.getUser(targetUserId);
      if (!target) return res.status(404).json({ error: "User not found" });
      const parsed = insertBrandSubscriptionSchema.parse({ ...req.body, userId: targetUserId });
      const sub = await storage.upsertBrandSubscription(parsed);
      console.log(`[Admin] Subscription for ${targetUserId} set to ${parsed.plan}/${parsed.status}`);
      res.json(sub);
    } catch (e) { res.status(400).json({ error: "Invalid data" }); }
  });

  // Subscription → Stripe Checkout (creates recurring plan)
  app.post("/api/brand/subscription/checkout", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { plan } = req.body;
      // Must NOT accept 'creator' — a brand buying the $149 tier would receive the
      // full Brand/Publisher feature set (entitlement keys off status, not tier).
      if (!isAllowedPlan(plan, BRAND_PLANS)) {
        return res.status(400).json({ error: `Plan must be one of: ${BRAND_PLANS.join(", ")}` });
      }

      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: "User not found" });

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user.email ?? "", userId, user.name ?? undefined);
        customerId = customer.id;
        await storage.updateUser(userId, { stripeCustomerId: customerId });
      }

      const origin = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
      const session = await stripeService.createSubscriptionCheckout(
        customerId,
        plan,
        `${origin}/brand/settings/subscription?checkout=success`,
        `${origin}/brand/settings/subscription?checkout=cancelled`,
        { userId, plan },
      );

      res.json({ url: session.url, sessionId: session.id });
    } catch (e: any) {
      console.error("Subscription checkout error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to create checkout session" });
    }
  });

  // Subscription → Stripe Customer Portal (manage / cancel)
  app.post("/api/brand/subscription/portal", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const user = await storage.getUser(userId);
      if (!user?.stripeCustomerId) {
        return res.status(400).json({ error: "No billing account on file. Please subscribe first." });
      }

      const origin = req.headers.origin ?? `${req.protocol}://${req.headers.host}`;
      const portal = await stripeService.createBillingPortal(
        user.stripeCustomerId,
        `${origin}/brand/settings/subscription`,
      );

      res.json({ url: portal.url });
    } catch (e: any) {
      console.error("Billing portal error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to open billing portal" });
    }
  });

  // Subscription → Surplus invoice (one-time overage charge)

  // Billing records (history + transactions)
  app.get("/api/brand/billing-records", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const type = req.query.type as string | undefined;
      const records = await storage.getBrandBillingRecords(userId, type);
      res.json(records);
    } catch (e) { res.status(500).json({ error: "Failed to fetch billing records" }); }
  });

  app.post("/api/brand/billing-records", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const parsed = insertBrandBillingRecordSchema.parse({ ...req.body, userId });
      const record = await storage.createBrandBillingRecord(parsed);
      res.json(record);
    } catch (e) { res.status(400).json({ error: "Invalid data" }); }
  });

  // Resolve the hosted Stripe invoice URL for a billing record (owner only)
  app.get("/api/brand/billing-records/:id/invoice-url", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid record id" });

      const record = await storage.getBrandBillingRecord(id);
      if (!record) return res.status(404).json({ error: "Billing record not found" });
      if (record.userId !== userId) return res.status(403).json({ error: "Forbidden" });

      // Prefer a cached hosted URL, then fall back to resolving it from Stripe.
      if (record.hostedInvoiceUrl) {
        return res.json({ url: record.hostedInvoiceUrl });
      }
      if (!record.stripeInvoiceId) {
        return res.status(404).json({ error: "No downloadable invoice for this record" });
      }

      const stripe = await getUncachableStripeClient();
      const invoice = await stripe.invoices.retrieve(record.stripeInvoiceId);
      if (!invoice.hosted_invoice_url) {
        return res.status(404).json({ error: "Invoice has no hosted URL" });
      }
      res.json({ url: invoice.hosted_invoice_url });
    } catch (e: any) {
      console.error("Resolve invoice URL error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to resolve invoice URL" });
    }
  });

  // Payout method
  app.get("/api/brand/payout-method", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const method = await storage.getBrandPayoutMethod(userId);
      res.json(method || null);
    } catch (e) { res.status(500).json({ error: "Failed to fetch payout method" }); }
  });

  app.put("/api/brand/payout-method", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const parsed = insertBrandPayoutMethodSchema.parse({ ...req.body, userId });
      const method = await storage.upsertBrandPayoutMethod(parsed);
      res.json(method);
    } catch (e) { res.status(400).json({ error: "Invalid data" }); }
  });

  // Billing profile (address + business info)
  app.get("/api/brand/billing-profile", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const profile = await storage.getBrandBillingProfile(userId);
      res.json(profile || null);
    } catch (e) { res.status(500).json({ error: "Failed to fetch billing profile" }); }
  });

  app.put("/api/brand/billing-profile", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const parsed = insertBrandBillingProfileSchema.parse({ ...req.body, userId });
      const profile = await storage.upsertBrandBillingProfile(parsed);
      res.json(profile);
    } catch (e) { res.status(400).json({ error: "Invalid data" }); }
  });

  // API Keys
  app.get("/api/brand/api-keys", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const keys = await storage.getBrandApiKeys(userId);
      res.json(keys);
    } catch (e) { res.status(500).json({ error: "Failed to fetch API keys" }); }
  });

  app.post("/api/brand/api-keys", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { name } = req.body;
      if (!name) return res.status(400).json({ error: "Key name required" });
      const rawKey = `mat_${crypto.randomUUID().replace(/-/g, "")}`;
      const prefix = rawKey.slice(0, 12);
      const encoder = new TextEncoder();
      const data = encoder.encode(rawKey);
      const hashBuffer = await crypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const keyHash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
      const key = await storage.createBrandApiKey({ userId, name, keyPrefix: prefix, keyHash, isActive: true });
      res.json({ ...key, rawKey });
    } catch (e) { res.status(400).json({ error: "Failed to create API key" }); }
  });

  app.delete("/api/brand/api-keys/:id", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      await storage.revokeBrandApiKey(Number(req.params.id), userId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to revoke key" }); }
  });

  // ==================== WISHLIST ROUTES ====================

  app.get("/api/wishlist", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const items = await storage.getUserWishlist(userId);
      const allListings = await storage.getGlobalVideoListings();
      const listingMap = new Map(allListings.map(l => [l.id, l]));
      const enriched = await Promise.all(items.map(async (item) => {
        const listing = listingMap.get(item.globalListingId);
        if (!listing) return null;
        const video = listing.videoId ? await storage.getVideo(listing.videoId) : null;
        const creator = listing.creatorId ? await storage.getUser(listing.creatorId) : null;
        return {
          wishlistId: item.id,
          globalListingId: item.globalListingId,
          addedAt: item.createdAt,
          listing: {
            ...listing,
            video: video ? { id: video.id, title: video.title, thumbnailUrl: video.thumbnailUrl } : null,
            creator: creator ? { displayName: creator.displayName, avatarUrl: creator.avatarUrl } : null,
          },
        };
      }));
      res.json(enriched.filter(Boolean));
    } catch (e) { res.status(500).json({ error: "Failed to get wishlist" }); }
  });

  app.post("/api/wishlist/:listingId", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const { listingId } = req.params;
      const already = await storage.isInWishlist(userId, listingId);
      if (already) return res.json({ wishlisted: true });
      const entry = await storage.addToWishlist({ userId, globalListingId: listingId });
      res.status(201).json(entry);
    } catch (e) { res.status(500).json({ error: "Failed to add to wishlist" }); }
  });

  app.delete("/api/wishlist/:listingId", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      await storage.removeFromWishlist(userId, req.params.listingId);
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: "Failed to remove from wishlist" }); }
  });

  // ─────────────────────────────────────────────────────────────────────────────

  // Dev/test-only: retrieve Stripe plan price configs for integration tests
  if (process.env.NODE_ENV !== "production") {
    /**
     * Shared admin auth guard for all /api/dev/* endpoints.
     * Requires a valid session with isAdmin=true.
     * In automated CI/integration tests, supply cookie from login response.
     */
    const requireDevAdmin = async (req: Request, res: Response): Promise<boolean> => {
      const sessionUserId = (req.session as any)?.userId as string | undefined;
      if (!sessionUserId) {
        res.status(401).json({ error: "Authentication required for dev endpoints" });
        return false;
      }
      const adminUser = await storage.getUser(sessionUserId);
      if (!adminUser?.isAdmin) {
        res.status(403).json({ error: "Admin access required for dev endpoints" });
        return false;
      }
      return true;
    }

    app.post("/api/dev/stripe/ensure-plans", async (req, res) => {
      if (!await requireDevAdmin(req, res)) return;
      try {
        const priceIds = await Promise.all(
          PLAN_KEYS.map(async (planKey) => [planKey, await stripeService.findOrCreateSubscriptionPrice(planKey)] as const),
        );
        res.json(Object.fromEntries(priceIds));
      } catch (e: any) {
        res.status(500).json({ error: e?.message ?? "Failed to ensure plans" });
      }
    });

    app.get("/api/dev/stripe/plans", async (req, res) => {
      if (!await requireDevAdmin(req, res)) return;
      try {
        const stripe = await getUncachableStripeClient();
        const allPrices = await stripe.prices.list({ active: true, limit: 100, expand: ["data.product"] });
        const plans: Record<string, unknown>[] = [];
        for (const price of allPrices.data) {
          const planName =
            (price.metadata as Record<string, string>)?.plan ||
            ((price.product as Stripe.Product)?.metadata as Record<string, string>)?.plan;
          if (!isPlanKey(planName)) continue;
          plans.push({
            id: price.id,
            plan: planName,
            unit_amount: price.unit_amount,
            currency: price.currency,
            recurring: price.recurring,
            metadata: price.metadata,
            product_id: typeof price.product === "string" ? price.product : (price.product as Stripe.Product).id,
          });
        }
        res.json({ plans });
      } catch (e: any) {
        res.status(500).json({ error: e?.message ?? "Failed to retrieve plans" });
      }
    });

    function makeEvent(type: string, obj: Record<string, unknown>): Stripe.Event {
      return {
        id: `evt_sim_${Date.now()}`,
        object: "event",
        type: type as Stripe.Event["type"],
        data: { object: obj as unknown as Stripe.Event.Data["object"] },
        livemode: false,
        created: Math.floor(Date.now() / 1000),
        api_version: "2024-06-20",
        pending_webhooks: 0,
        request: null,
      } as unknown as Stripe.Event;
    }

    /**
     * Webhook simulation harness — fires Stripe events through dispatchStripeEvent and
     * returns the resulting DB subscription row so tests can assert state transitions.
     * Requires admin session. Non-production only.
     *
     * POST /api/dev/stripe/simulate-webhook
     * Body:
     *   { userId, plan?, eventType? }
     *
     * eventType defaults to "checkout.session.completed" which creates a real Stripe
     * subscription via tok_visa and fires the event.
     *
     * For lifecycle transition events the user must already have an active subscription
     * in the DB (run checkout.session.completed first):
     *   - "invoice.payment_failed"        → status becomes past_due
     *   - "customer.subscription.deleted" → status becomes cancelled
     *   - "invoice.payment_succeeded"     → re-activates (status active)
     */
    app.post("/api/dev/stripe/simulate-webhook", async (req, res) => {
      if (!await requireDevAdmin(req, res)) return;
      try {
        const { userId, plan = "starter", eventType = "checkout.session.completed" } = req.body as {
          userId: string;
          plan?: PlanKey;
          eventType?: string;
        };
        if (!userId) return res.status(400).json({ error: "userId is required" });
        if (!isPlanKey(plan)) {
          return res.status(400).json({ error: `Plan must be one of: ${PLAN_KEYS.join(", ")}` });
        }

        const user = await storage.getUser(userId);
        if (!user) return res.status(404).json({ error: "User not found" });

        const stripe = await getUncachableStripeClient();

        let customerId = user.stripeCustomerId;
        if (!customerId) {
          const customer = await stripe.customers.create({ email: user.email ?? "", metadata: { userId } });
          customerId = customer.id;
          await storage.updateUser(userId, { stripeCustomerId: customerId });
        }

        if (eventType === "checkout.session.completed") {
          const allPrices = await stripe.prices.list({ active: true, limit: 100 });
          const price = allPrices.data.find(
            (p) => (p.metadata as Record<string, string>)?.plan === plan
          );
          if (!price) return res.status(404).json({ error: `No Stripe price found for plan: ${plan}` });

          const pm = await stripe.paymentMethods.create({ type: "card", card: { token: "tok_visa" } });
          await stripe.paymentMethods.attach(pm.id, { customer: customerId });
          await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pm.id } });

          const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{ price: price.id }],
            metadata: { userId, plan },
            expand: ["latest_invoice.payment_intent"],
          });
          const periodEnd = (subscription.items.data[0] as Stripe.SubscriptionItem).current_period_end;

          await dispatchStripeEvent(makeEvent("checkout.session.completed", {
            id: `cs_sim_${Date.now()}`,
            object: "checkout.session",
            mode: "subscription",
            customer: customerId,
            subscription: subscription.id,
            metadata: { userId, plan },
            status: "complete",
          }));

          const sub = await storage.getBrandSubscription(userId);
          return res.json({ dispatched: true, stripeSubscriptionId: subscription.id, periodEnd, subscription: sub });
        }

        const existingSub = await storage.getBrandSubscription(userId);
        const subscriptionId = existingSub?.stripeSubscriptionId;

        if (eventType === "invoice.payment_failed") {
          await dispatchStripeEvent(makeEvent("invoice.payment_failed", {
            object: "invoice",
            customer: customerId,
            subscription: subscriptionId ?? null,
          }));
        } else if (eventType === "customer.subscription.deleted") {
          await dispatchStripeEvent(makeEvent("customer.subscription.deleted", {
            object: "subscription",
            id: subscriptionId ?? `sub_sim_${Date.now()}`,
            customer: customerId,
            status: "canceled",
            items: { data: [{ price: { metadata: { plan: existingSub?.plan ?? plan } } }] },
          }));
        } else if (eventType === "invoice.payment_succeeded") {
          await dispatchStripeEvent(makeEvent("invoice.payment_succeeded", {
            object: "invoice",
            customer: customerId,
            subscription: subscriptionId ?? null,
          }));
        } else if (eventType === "customer.subscription.updated") {
          if (!subscriptionId) return res.status(400).json({ error: "No existing subscription to update" });
          const allPrices = await stripe.prices.list({ active: true, limit: 100 });
          const targetPrice = allPrices.data.find(
            (p) => (p.metadata as Record<string, string>)?.plan === plan
          );
          if (targetPrice && subscriptionId) {
            const stripeSub = await stripe.subscriptions.retrieve(subscriptionId, { expand: ["items.data.price"] });
            const existingItem = stripeSub.items.data[0];
            if (existingItem.price.id !== targetPrice.id) {
              await stripe.subscriptions.update(subscriptionId, {
                items: [{ id: existingItem.id, price: targetPrice.id }],
                metadata: { userId, plan },
              });
            }
          }
          const updatedStripeSub = await stripe.subscriptions.retrieve(subscriptionId!, {
            expand: ["items.data.price.product"],
          });
          await dispatchStripeEvent(makeEvent("customer.subscription.updated", {
            object: "subscription",
            id: subscriptionId,
            customer: customerId,
            status: updatedStripeSub.status,
            metadata: { userId, plan },
            items: {
              data: [{
                price: {
                  metadata: { plan },
                  product: { name: PLAN_CONFIG[plan].name },
                },
              }],
            },
          }));
        } else {
          return res.status(400).json({ error: `Unsupported eventType: ${eventType}` });
        }

        const sub = await storage.getBrandSubscription(userId);
        return res.json({ dispatched: true, stripeSubscriptionId: subscriptionId ?? null, subscription: sub });
      } catch (e: any) {
        console.error("[Dev] simulate-webhook error:", e?.message);
        res.status(500).json({ error: e?.message ?? "Failed to simulate webhook" });
      }
    });

    app.get("/api/dev/stripe/checkout-session/:sessionId", async (req, res) => {
      if (!await requireDevAdmin(req, res)) return;
      try {
        const stripe = await getUncachableStripeClient();
        const session = await stripe.checkout.sessions.retrieve(req.params.sessionId, {
          expand: ["line_items", "line_items.data.price.product"],
        });
        res.json({
          id: session.id,
          mode: session.mode,
          status: session.status,
          currency: session.currency,
          metadata: session.metadata,
          line_items: session.line_items?.data.map((item) => ({
            amount_total: item.amount_total,
            currency: item.currency,
            quantity: item.quantity,
            price: {
              id: item.price?.id,
              unit_amount: item.price?.unit_amount,
              currency: item.price?.currency,
              recurring: item.price?.recurring,
              metadata: item.price?.metadata,
            },
          })),
        });
      } catch (e: any) {
        res.status(500).json({ error: e?.message ?? "Failed to retrieve session" });
      }
    });
  }


  // ==================== IN-VIDEO CHECKOUT (public, no auth) ==================
  //
  // The shopper buys from the video overlay. This is the path where the 15% is
  // genuinely RETAINED: the platform creates the charge on the brand's connected
  // account, Stripe routes the brand their share and withholds our fee in the
  // same movement, and the brand stays merchant of record.
  //
  // Public because the embed runs on the brand's own site with no session. That
  // is why the PRICE IS READ FROM THE DATABASE and never from the request — a
  // public endpoint that trusts a client-supplied amount is one where the
  // shopper decides what to pay.
  app.post("/api/embed/:videoId/checkout", async (req, res) => {
    try {
      const { videoId } = req.params;
      const overlayId = Number(req.body?.overlayId);
      if (!Number.isInteger(overlayId)) {
        return res.status(400).json({ error: "overlayId is required" });
      }

      const video = await storage.getVideo(videoId);
      if (!video) return res.status(404).json({ error: "Video not found" });

      const overlays = await storage.getVideoProductOverlays(videoId);
      const overlay = overlays.find((o) => o.id === overlayId);
      if (!overlay) return res.status(404).json({ error: "Product not found" });

      // The brand being paid is the overlay's product owner. Resolved from the
      // product, not from the request.
      const product = overlay.productId ? await storage.getProduct(overlay.productId) : null;
      const brandId = product?.brandId ?? null;
      const brand = brandId ? await storage.getBrand(brandId) : null;
      const brandUser = brand?.ownerId ? await storage.getUser(brand.ownerId) : null;

      if (!brandUser) {
        return res.status(409).json({
          error: "This product is not linked to a brand that can take payments.",
          reason: "brand_not_ready",
        });
      }

      const ref = typeof req.body?.ref === "string" ? req.body.ref : (video.utmCode ?? null);
      const resolved = ref ? await storage.resolveUtmToAffiliate(ref) : null;
      const hasPublisher = !!(resolved?.affiliateId && resolved.affiliateId !== video.creatorId);

      const cfg = resolveFeeConfig(await storage.getPlatformSettings());
      const quote = quoteCheckout(
        {
          overlayId: overlay.id,
          videoId,
          name: overlay.name,
          imageUrl: overlay.imageUrl,
          priceCents: overlay.priceCents ?? null,
          currency: overlay.currency ?? getPlatformCurrency(),
        },
        {
          brandUserId: brandUser.id,
          stripeAccountId: brandUser.stripeConnectAccountId ?? null,
          chargesEnabled: !!brandUser.stripeConnectChargesEnabled,
        },
        {
          marketplaceFeePct: cfg.marketplaceFeePct,
          creatorPct: cfg.creatorPct,
          publisherPct: cfg.publisherPct,
        },
        { hasPublisher },
      );

      if (!quote.ok) {
        return res.status(409).json({ error: quote.message, reason: quote.reason });
      }

      const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get("host")}`;
      const nonce = crypto.randomUUID();
      const session = await stripeService.createInVideoCheckout({
        brandAccountId: brandUser.stripeConnectAccountId!,
        productName: overlay.name,
        imageUrl: overlay.imageUrl,
        amountCents: quote.amountCents,
        applicationFeeCents: quote.applicationFeeCents,
        currency: quote.currency,
        returnUrl: `${baseUrl}/embed/${videoId}/order-complete?session_id={CHECKOUT_SESSION_ID}`,
        metadata: {
          kind: "in_video_order",
          videoId,
          overlayId: String(overlay.id),
          brandUserId: brandUser.id,
          ...(video.creatorId ? { creatorId: video.creatorId } : {}),
          ...(resolved?.affiliateId ? { affiliateId: resolved.affiliateId } : {}),
          ...(ref ? { ref } : {}),
        },
        idempotencyKey: checkoutIdempotencyKey(videoId, overlay.id, nonce),
      });

      // Recorded as pending BEFORE the shopper pays, so the webhook has a row to
      // flip and cannot race ahead of us.
      await storage.createVideoOrder({
        videoId,
        overlayId: overlay.id,
        brandUserId: brandUser.id,
        creatorId: video.creatorId ?? null,
        affiliateId: resolved?.affiliateId ?? null,
        attributionRef: ref,
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: null,
        currency: quote.currency,
        amountCents: quote.amountCents,
        applicationFeeCents: quote.applicationFeeCents,
      } as any);

      res.json({ clientSecret: session.client_secret, sessionId: session.id });
    } catch (error) {
      console.error("In-video checkout error:", error);
      res.status(500).json({ error: "Could not start checkout" });
    }
  });

  // ==================== EMBED ROUTES (public, no auth) ====================

  // Serve embed iframe page
  app.get("/embed/:videoId", async (req, res) => {
    try {
      const video = await storage.getVideo(req.params.videoId);
      if (!video) return res.status(404).send("Video not found");

      const utm = (req.query.utm as string) || video.utmCode || "";
      const overlays = await storage.getVideoProductOverlays(video.id);
      const products = overlays.map(o => ({
        name: (o.name || "").replace(/[<>"'&]/g, ""),
        imageUrl: o.imageUrl,
        price: o.price,
        productUrl: appendUtm(o.productUrl, utm),
        brandName: (o.brandName || "").replace(/[<>"'&]/g, ""),
        // For the in-video buy button. `buyable` is decided here, from the
        // stored price — never from anything the page can influence. The
        // AMOUNT is deliberately not sent: the checkout endpoint re-reads it
        // from the database, so nothing on this page can change what is charged.
        overlayId: o.id,
        buyable: o.priceCents != null && o.priceCents > 0,
      }));

      const apiBase = `${req.protocol}://${req.get("host")}`;

      res.set("Content-Type", "text/html");
      res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${(video.title || "Materialized Video").replace(/[<>"'&]/g, "")}</title>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{background:#000;overflow:hidden;font-family:-apple-system,sans-serif}
    #player{width:100vw;height:100vh;position:relative;display:flex;align-items:center;justify-content:center}
    video{width:100%;height:100%;object-fit:contain}
    #loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10}
    .spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.2);border-top-color:#677A67;border-radius:50%;animation:spin 0.8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    #carousel{position:absolute;bottom:clamp(8px,2vw,16px);left:clamp(8px,2vw,16px);right:clamp(8px,2vw,16px);display:flex;gap:clamp(4px,1vw,8px);overflow-x:auto;padding:4px 0;scrollbar-width:none;z-index:5}
    #carousel::-webkit-scrollbar{display:none}
    .product-card{flex:0 0 auto;background:rgba(255,255,255,0.95);border-radius:clamp(6px,1.5vw,12px);padding:clamp(4px,1vw,8px);width:clamp(72px,18vw,120px);cursor:pointer;transition:transform .2s;text-decoration:none;backdrop-filter:blur(8px)}
    .product-card:hover{transform:scale(1.05)}
    .product-card img{width:100%;height:clamp(40px,10vw,80px);object-fit:cover;border-radius:clamp(4px,1vw,8px)}
    .product-name{font-size:clamp(8px,2vw,11px);font-weight:600;margin-top:clamp(2px,0.5vw,4px);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333}
    .product-price{font-size:clamp(7px,1.8vw,10px);color:#677A67;font-weight:700;margin-top:1px}
    .buy-btn{margin-top:3px;width:100%;border:0;border-radius:999px;background:#1351aa;color:#fff;font-size:clamp(7px,1.7vw,10px);font-weight:700;padding:3px 0;cursor:pointer;font-family:inherit}
    .buy-btn:hover{background:#0f4189}
    /* The checkout sits OVER the video, inside the same frame — the shopper
       never leaves the brand's page. */
    #pay{position:absolute;inset:0;background:rgba(12,14,16,.92);z-index:20;display:none;overflow-y:auto;padding:12px}
    #pay.open{display:block}
    #pay-close{position:absolute;top:8px;right:10px;z-index:21;border:0;background:rgba(255,255,255,.9);border-radius:999px;width:26px;height:26px;font-size:15px;line-height:1;cursor:pointer}
    #pay-inner{background:#fff;border-radius:10px;max-width:460px;margin:26px auto;overflow:hidden}
    #pay-err{color:#fff;text-align:center;font-size:12px;padding:18px;font-family:-apple-system,sans-serif}
  </style>
</head>
<body>
  <div id="player">
    <div id="loader"><div class="spinner"></div></div>
    <div id="playbtn" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:11;cursor:pointer;width:72px;height:72px;background:rgba(255,255,255,.9);border-radius:50%;align-items:center;justify-content:center" onclick="document.getElementById('vid').play();this.style.display='none'">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="#333" style="margin-left:4px"><polygon points="5,3 19,12 5,21"/></svg>
    </div>
    <video id="vid" muted loop playsinline preload="auto"></video>
    <div id="carousel"></div>
    <div id="pay">
      <button id="pay-close" onclick="closePay()" aria-label="Close">&times;</button>
      <div id="pay-inner"><div id="checkout"></div></div>
      <div id="pay-err" style="display:none"></div>
    </div>
  </div>
  <script>
    var utm="${utm.replace(/[<>"'\\]/g, "")}",videoId="${video.id}",apiBase="${apiBase}",CURRENCY_SYMBOL="${embedCurrencySymbol()}",PK="${process.env.STRIPE_PUBLISHABLE_KEY || ""}";
    var vid=document.getElementById("vid");
    // Transformed server-side by videoDeliveryUrl — the raw original is never
    // sent to the browser, and the embed and the widget can no longer drift to
    // different widths the way two hand-rolled string replaces did.
    var rawUrl="${videoDeliveryUrl(video.videoUrl, "embed").replace(/[<>"'\\]/g, "")}";
    vid.src=rawUrl;
    vid.addEventListener("playing",function(){
      document.getElementById("loader").style.display="none";
      document.getElementById("playbtn").style.display="none";
    });
    vid.addEventListener("canplay",function(){
      document.getElementById("loader").style.display="none";
      vid.play().catch(function(){
        document.getElementById("playbtn").style.display="flex";
      });
    });
    var products=${JSON.stringify(products)};
    var carousel=document.getElementById("carousel");
    products.forEach(function(p){
      var a=document.createElement("a");
      a.href=p.productUrl||"#";a.target="_blank";a.rel="noopener";a.className="product-card";
      if(p.imageUrl){var img=document.createElement("img");img.src=p.imageUrl;img.alt=p.name;a.appendChild(img);}
      var nameDiv=document.createElement("div");nameDiv.className="product-name";nameDiv.textContent=p.name;a.appendChild(nameDiv);
      if(p.price){var priceDiv=document.createElement("div");priceDiv.className="product-price";priceDiv.textContent=CURRENCY_SYMBOL+p.price;a.appendChild(priceDiv);}
      a.addEventListener("click",function(){track("click")});
      carousel.appendChild(a);

      // Buy in-video. Only rendered when the SERVER said this product has a
      // price; the amount itself is never sent from here.
      if(p.buyable){
        var b=document.createElement("button");
        b.className="buy-btn";b.type="button";b.textContent="Buy";
        b.addEventListener("click",function(ev){ev.preventDefault();ev.stopPropagation();openPay(p.overlayId);});
        a.appendChild(b);
      }
    });

    // ── In-video checkout ───────────────────────────────────────────────────
    // Stripe's embedded Checkout, mounted over the video. Stripe.js loads only
    // when someone actually presses Buy, so a video nobody buys from costs the
    // host page nothing.
    var _checkout=null;
    function payError(msg){
      document.getElementById("checkout").innerHTML="";
      var e=document.getElementById("pay-err");
      e.textContent=msg;e.style.display="block";
      document.getElementById("pay").classList.add("open");
    }
    function closePay(){
      document.getElementById("pay").classList.remove("open");
      document.getElementById("pay-err").style.display="none";
      if(_checkout){try{_checkout.destroy()}catch(e){}_checkout=null;}
      vid.play().catch(function(){});
    }
    function loadStripeJs(){
      return new Promise(function(res,rej){
        if(window.Stripe)return res();
        var sc=document.createElement("script");
        sc.src="https://js.stripe.com/v3/";sc.onload=res;sc.onerror=rej;
        document.head.appendChild(sc);
      });
    }
    function openPay(overlayId){
      if(!PK){return payError("Payments are not configured for this site yet.");}
      vid.pause();
      document.getElementById("pay").classList.add("open");
      track("checkout_open");
      fetch(apiBase+"/api/embed/"+videoId+"/checkout",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({overlayId:overlayId,ref:utm})
      })
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,body:j}})})
      .then(function(res){
        if(!res.ok||!res.body.clientSecret){
          // A refusal is a real condition — no price set, or the brand is not
          // approved by Stripe to accept payments. Say so rather than failing
          // silently with a spinner.
          throw new Error(res.body.error||"Checkout is unavailable for this product.");
        }
        return loadStripeJs().then(function(){
          return Stripe(PK).initEmbeddedCheckout({clientSecret:res.body.clientSecret});
        }).then(function(c){_checkout=c;c.mount("#checkout");});
      })
      .catch(function(e){payError(e.message||"Checkout is unavailable right now.");});
    }
    function track(type,extra){
      fetch(apiBase+"/api/analytics/events",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify(Object.assign({videoId:videoId,eventType:type,utmCode:utm,
          referrerDomain:document.referrer?new URL(document.referrer).hostname:""},extra||{}))
      }).catch(function(){});
    }
    track("view");
  </script>
</body>
</html>`);
    } catch (error) {
      res.status(500).send("Failed to load embed");
    }
  });

  // Serve embed widget JavaScript
  app.get("/embed/:videoId/widget.js", async (req, res) => {
    try {
      const video = await storage.getVideo(req.params.videoId);
      if (!video) {
        res.set("Content-Type", "application/javascript");
        return res.send("console.error('[Materialized] Video not found');");
      }

      const utm = (req.query.utm as string) || video.utmCode || "";
      const overlays = await storage.getVideoProductOverlays(video.id);
      const products = overlays.map(o => ({
        name: (o.name || "").replace(/"/g, '\\"'),
        imageUrl: o.imageUrl,
        price: o.price,
        productUrl: appendUtm(o.productUrl, utm),
      }));

      const apiBase = `${req.protocol}://${req.get("host")}`;
      const safeVideoUrl = (video.videoUrl || "").replace(/"/g, '\\"');

      res.set("Content-Type", "application/javascript");
      res.set("Cache-Control", "public, max-age=300");
      res.set("Access-Control-Allow-Origin", "*");
      res.send(`(function(){
  var videoId="${video.id}",utm="${utm.replace(/"/g, "")}",apiBase="${apiBase}",CURRENCY_SYMBOL="${embedCurrencySymbol()}";
  var el=document.getElementById("vc-widget-"+videoId);
  if(!el){console.error("[Materialized] Widget container not found");return;}
  el.style.position="relative";el.style.width="100%";el.style.maxWidth="640px";
  el.style.aspectRatio="16/9";el.style.background="#000";el.style.borderRadius="12px";
  el.style.overflow="hidden";
  var v=document.createElement("video");
  var vsrc="${videoDeliveryUrl(safeVideoUrl, "embed")}";
  v.src=vsrc;v.muted=true;v.loop=true;v.playsInline=true;v.preload="auto";
  v.style.cssText="width:100%;height:100%;object-fit:cover;";
  v.addEventListener("canplay",function(){v.play().catch(function(){});});
  el.appendChild(v);
  var products=${JSON.stringify(products)};
  if(products.length){
    var c=document.createElement("div");
    c.style.cssText="position:absolute;bottom:clamp(4px,2%,12px);left:clamp(4px,2%,12px);right:clamp(4px,2%,12px);display:flex;gap:clamp(3px,1%,6px);overflow-x:auto;z-index:5;scrollbar-width:none;";
    products.forEach(function(p){
      var a=document.createElement("a");
      a.href=p.productUrl||"#";a.target="_blank";a.rel="noopener";
      a.style.cssText="flex:0 0 auto;background:rgba(255,255,255,.95);border-radius:clamp(6px,1.5%,10px);padding:clamp(3px,1%,6px);width:clamp(60px,20%,100px);text-decoration:none;backdrop-filter:blur(8px);";
      if(p.imageUrl){var img=document.createElement("img");img.src=p.imageUrl;img.alt=p.name;img.style.cssText="width:100%;height:clamp(30px,8vw,60px);object-fit:cover;border-radius:clamp(4px,1%,6px)";a.appendChild(img);}
      var nd=document.createElement("div");nd.style.cssText="font-size:clamp(7px,2%,10px);font-weight:600;color:#333;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      nd.textContent=p.name||"";a.appendChild(nd);
      if(p.price){var pd=document.createElement("div");pd.style.cssText="font-size:9px;color:#677A67;font-weight:700";pd.textContent=CURRENCY_SYMBOL+p.price;a.appendChild(pd);}
      a.addEventListener("click",function(){track("click")});
      c.appendChild(a);
    });
    el.appendChild(c);
  }
  function track(type,extra){
    var body=JSON.stringify(Object.assign({videoId:videoId,eventType:type,utmCode:utm,
      referrerDomain:location.hostname},extra||{}));
    if(navigator.sendBeacon){navigator.sendBeacon(apiBase+"/api/analytics/events",new Blob([body],{type:"application/json"}));}
    else{fetch(apiBase+"/api/analytics/events",{method:"POST",headers:{"Content-Type":"application/json"},body:body}).catch(function(){});}
  }
  track("view");
})();`);
    } catch (error) {
      res.set("Content-Type", "application/javascript");
      res.send("console.error('[Materialized] Widget error');");
    }
  });

  return httpServer;
}

/**
 * Playlist embed snippet. Extracted so the card branch and the token branch of
 * playlist publishing emit byte-identical markup — two copies of this string
 * would silently drift.
 */
function buildPlaylistEmbedCode(playlistId: number, userId: string): string {
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://your-app.replit.dev";
  return `<div id="mat-playlist-${playlistId}" data-playlist="${playlistId}" data-user="${userId}"></div>\n<script src="${baseUrl}/embed/playlist.js" async></script>`;
}

// Helper function to generate embed code
function generateEmbedCode(videoId: string, baseUrl: string, config?: any): string {
  const cleanBase = baseUrl.replace(/\/$/, "");
  return `<!-- Materialized Video Commerce Widget -->
<div id="vc-widget-${videoId}" data-video-id="${videoId}"></div>
<script src="${cleanBase}/embed/${videoId}/widget.js" async></script>
<script>
  window.vcWidgetConfig = ${JSON.stringify(config || {})};
</script>`;
}

function generateAffiliateEmbedCode(videoId: string, utmCode: string, baseUrl: string): string {
  const cleanBase = baseUrl.replace(/\/$/, "");
  return `<!-- Materialized Video Commerce Widget - Affiliate -->
<div id="vc-widget-${videoId}" data-video-id="${videoId}" data-utm="${utmCode}"></div>
<script src="${cleanBase}/embed/${videoId}/widget.js?utm=${utmCode}" async></script>`;
}

// Classify a User-Agent string into a coarse device bucket for analytics.
// Tablets are checked before phones because tablet UAs (e.g. iPad, Android
// tablets) frequently also contain "mobile"-adjacent tokens.
function classifyDevice(userAgent: string | undefined): "Mobile" | "Desktop" | "Tablet" | null {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet|(android(?!.*mobile))|kindle|silk|playbook/.test(ua)) return "Tablet";
  if (/mobile|iphone|ipod|android|blackberry|iemobile|opera mini|windows phone/.test(ua)) return "Mobile";
  return "Desktop";
}

// Derive a 2-letter country code from CDN/proxy geo headers when the deployment
// target provides them (Cloudflare, Vercel, generic). Returns null when unknown
// so the column stays NULL rather than storing a placeholder.
/**
 * Currency symbol for prices rendered inside embed widgets.
 *
 * These overlays are what an end customer sees on a third-party site, and both
 * embed scripts hardcoded the euro sign while Stripe has always billed in
 * PLATFORM_CURRENCY (USD by default). Derived from the same setting rather than
 * written twice, so the shopper and the charge agree.
 */
function embedCurrencySymbol(): string {
  const symbols: Record<string, string> = { usd: "$", eur: "\u20AC", gbp: "\u00A3", aud: "A$", cad: "C$" };
  return symbols[getPlatformCurrency().toLowerCase()] ?? "$";
}

function deriveCountry(req: Request): string | null {
  const header =
    req.headers["cf-ipcountry"] ||
    req.headers["x-vercel-ip-country"] ||
    req.headers["x-country-code"];
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) return null;
  const trimmed = value.trim().toUpperCase();
  if (!trimmed || trimmed === "XX" || trimmed === "T1") return null;
  return trimmed;
}
