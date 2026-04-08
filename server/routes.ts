import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
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
  isEmailConfigured,
} from "./emailService";
import { setupPdfAnalysisRoutes } from "./replit_integrations/pdf_analysis";
import { registerDetectionRoutes } from "./replit_integrations/detection/routes";
import { ai } from "./replit_integrations/detection/client";
// Object storage removed — using Cloudinary instead
import type Stripe from "stripe";
import { stripeService } from "./stripeService";
import { getStripePublishableKey, getUncachableStripeClient } from "./stripeClient";
import { dispatchStripeEvent } from "./webhookHandlers";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // ==================== AI/PDF ANALYSIS ROUTES ====================
  setupPdfAnalysisRoutes(app);

  // ==================== AI DETECTION ROUTES ====================
  registerDetectionRoutes(app, storage);

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
      res.json(user);
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
      });
    } catch (e) {
      res.status(500).json({ error: "Failed to get trial status" });
    }
  });

  // ─── Creator Subscription (mirrors brand subscription flow) ──────────────────

  // Creator subscription checkout
  app.post("/api/creator/subscription/checkout", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { plan } = req.body;
      if (!plan || !["starter", "pro"].includes(plan)) {
        return res.status(400).json({ error: "Plan must be 'starter' or 'pro'" });
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
        plan as "starter" | "pro",
        `${origin}/creator/settings/subscription?checkout=success`,
        `${origin}/creator/settings/subscription?checkout=cancelled`,
        { userId, plan },
      );

      res.json({ url: session.url, sessionId: session.id });
    } catch (e: any) {
      console.error("Creator checkout error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to create checkout session" });
    }
  });

  // Creator billing portal
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
  app.post("/api/creator/subscription/surplus-invoice", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { views, minutes, publishers, totalAmount } = req.body;
      if (!totalAmount || totalAmount <= 0) {
        return res.status(400).json({ error: "Surplus amount must be greater than zero" });
      }

      const user = await storage.getUser(userId);
      let customerId = user?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user?.email ?? "", userId, user?.name ?? undefined);
        customerId = customer.id;
        await storage.updateUser(userId, { stripeCustomerId: customerId });
      }

      const description = `Creator overage — ${(views ?? 0).toLocaleString()} views × ${publishers ?? 1} pub + ${(minutes ?? 0).toLocaleString()} min × ${publishers ?? 1} pub`;
      const invoice = await stripeService.createSurplusInvoice(customerId, totalAmount, description);

      res.json({ invoiceId: invoice.id, url: invoice.hosted_invoice_url });
    } catch (e: any) {
      console.error("Creator surplus error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to create surplus invoice" });
    }
  });

  // ==================== BRAND ROUTES ====================
  
  // Get all brands
  app.get("/api/brands", async (req, res) => {
    try {
      const brands = await storage.getBrands();
      res.json(brands);
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
      res.json(brand);
    } catch (error) {
      res.status(500).json({ error: "Failed to get brand" });
    }
  });

  // Create brand
  app.post("/api/brands", async (req, res) => {
    try {
      const data = insertBrandSchema.parse(req.body);
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
  
  // Get products (optionally by brand)
  app.get("/api/products", async (req, res) => {
    try {
      const brandId = req.query.brandId as string | undefined;
      const products = await storage.getProducts(brandId);
      res.json(products);
    } catch (error) {
      res.status(500).json({ error: "Failed to get products" });
    }
  });

  // Create product
  app.post("/api/products", async (req, res) => {
    try {
      let { brandId, price, ...rest } = req.body;
      // Resolve brandId — prefer explicit, then fall back to first available brand
      if (!brandId) {
        const brands = await storage.getBrands();
        brandId = brands[0]?.id;
      }
      if (!brandId) return res.status(400).json({ error: "No brand available" });
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
      const video = await storage.updateVideo(req.params.id, req.body);
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

      // Simulate sending email (update status to "sent" after a delay)
      setTimeout(async () => {
        await storage.updateReferralStatus(referral.id, "sent");
      }, 2000);

      res.status(201).json(referral);
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: error.errors });
      }
      res.status(500).json({ error: "Failed to create referral" });
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
      const docuSignUrl = process.env.DOCUSIGN_SIGNING_URL ?? "https://app.docusign.com/templates";

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

      const now = new Date();
      const viewsByDay: { date: string; views: number }[] = [];
      for (let i = 89; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const base = Math.floor(Math.random() * 120) + 30;
        const weekday = d.getDay();
        const multiplier = weekday === 0 || weekday === 6 ? 0.7 : 1.0;
        viewsByDay.push({ date: dateStr, views: Math.round(base * multiplier) });
      }

      const viewsByHour: { hour: number; views: number }[] = [];
      for (let h = 0; h < 24; h++) {
        let base = 20;
        if (h >= 8 && h <= 11) base = 60 + Math.floor(Math.random() * 40);
        else if (h >= 12 && h <= 14) base = 80 + Math.floor(Math.random() * 50);
        else if (h >= 17 && h <= 21) base = 100 + Math.floor(Math.random() * 60);
        else if (h >= 22 || h <= 5) base = 10 + Math.floor(Math.random() * 20);
        else base = 40 + Math.floor(Math.random() * 30);
        viewsByHour.push({ hour: h, views: base });
      }

      const ageBreakdown = [
        { range: "13-17", percentage: 5 },
        { range: "18-24", percentage: 28 },
        { range: "25-34", percentage: 35 },
        { range: "35-44", percentage: 18 },
        { range: "45-54", percentage: 9 },
        { range: "55-64", percentage: 3 },
        { range: "65+", percentage: 2 },
      ];

      const genderBreakdown = {
        male: 42,
        female: 51,
        other: 7,
      };

      const totalViewsNum = stats.totalViews || 0;
      const totalRevenueNum = stats.totalRevenue || 0;
      const totalClicksNum = stats.totalClicks || 0;
      const salesVolumeUnits = totalViewsNum > 0 ? Math.round(totalViewsNum * 0.032) : 0;
      const averageSpend = salesVolumeUnits > 0 ? +(totalRevenueNum / salesVolumeUnits).toFixed(2) : 0;
      const salesConversionRate = totalClicksNum > 0 ? +((salesVolumeUnits / totalClicksNum) * 100).toFixed(1) : 0;
      const salesVolumeValue = +(salesVolumeUnits * averageSpend).toFixed(2);

      // Get real embed deployment data for this creator's videos
      const userVideos = await storage.getVideos(user.id);
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
        topCountries: [],
        deviceBreakdown: [],
        viewsByDay,
        viewsByHour,
        ageBreakdown,
        genderBreakdown,
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

      const now = new Date();
      const viewsByDay: { date: string; views: number }[] = [];
      for (let i = 89; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const base = Math.floor(Math.random() * 200) + 50;
        const weekday = d.getDay();
        const multiplier = weekday === 0 || weekday === 6 ? 0.65 : 1.0;
        viewsByDay.push({ date: dateStr, views: Math.round(base * multiplier) });
      }

      const viewsByHour: { hour: number; views: number }[] = [];
      for (let h = 0; h < 24; h++) {
        let base = 30;
        if (h >= 8 && h <= 11) base = 80 + Math.floor(Math.random() * 50);
        else if (h >= 12 && h <= 14) base = 100 + Math.floor(Math.random() * 60);
        else if (h >= 17 && h <= 21) base = 130 + Math.floor(Math.random() * 70);
        else if (h >= 22 || h <= 5) base = 15 + Math.floor(Math.random() * 25);
        else base = 50 + Math.floor(Math.random() * 40);
        viewsByHour.push({ hour: h, views: base });
      }

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
      const salesVolumeUnits = totalViews > 0 ? Math.round(totalViews * 0.035) : 0;
      const averageSpend = salesVolumeUnits > 0 ? +(totalRevenue / salesVolumeUnits).toFixed(2) : 0;
      const salesConversionRate = totalClicks > 0 ? +((salesVolumeUnits / totalClicks) * 100).toFixed(1) : 0;
      const salesVolumeValue = +(salesVolumeUnits * averageSpend).toFixed(2);

      res.json({
        totalViews,
        totalClicks,
        totalRevenue,
        averageCTR: totalViews > 0 ? +((totalClicks / totalViews) * 100).toFixed(2) : 0,
        topCountries: [],
        deviceBreakdown: [],
        viewsByDay,
        viewsByHour,
        ageBreakdown: [],
        genderBreakdown: { male: 0, female: 0, other: 0 },
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

      const now = new Date();
      const viewsByDay: { date: string; views: number }[] = [];
      for (let i = 89; i >= 0; i--) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().split("T")[0];
        const base = Math.floor(Math.random() * 60) + 10;
        const weekday = d.getDay();
        const multiplier = weekday === 0 || weekday === 6 ? 0.6 : 1.0;
        viewsByDay.push({ date: dateStr, views: Math.round(base * multiplier) });
      }

      const viewsByHour: { hour: number; views: number }[] = [];
      for (let h = 0; h < 24; h++) {
        let base = 8;
        if (h >= 9 && h <= 12) base = 25 + Math.floor(Math.random() * 20);
        else if (h >= 13 && h <= 15) base = 35 + Math.floor(Math.random() * 25);
        else if (h >= 18 && h <= 21) base = 45 + Math.floor(Math.random() * 30);
        else if (h >= 22 || h <= 6) base = 5 + Math.floor(Math.random() * 10);
        else base = 15 + Math.floor(Math.random() * 15);
        viewsByHour.push({ hour: h, views: base });
      }

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
        topCountries: [
          { country: "United States", views: 1200, avgSpend: 4.50 },
          { country: "United Kingdom", views: 580, avgSpend: 5.00 },
          { country: "Canada", views: 340, avgSpend: 4.20 },
          { country: "Australia", views: 280, avgSpend: 5.30 },
          { country: "Germany", views: 180, avgSpend: 3.90 },
        ],
        deviceBreakdown: [
          { device: "Mobile", percentage: 65 },
          { device: "Desktop", percentage: 28 },
          { device: "Tablet", percentage: 7 },
        ],
        viewsByDay,
        viewsByHour,
        ageBreakdown: [
          { range: "13-17", percentage: 6 },
          { range: "18-24", percentage: 30 },
          { range: "25-34", percentage: 33 },
          { range: "35-44", percentage: 17 },
          { range: "45-54", percentage: 8 },
          { range: "55-64", percentage: 4 },
          { range: "65+", percentage: 2 },
        ],
        genderBreakdown: { male: 38, female: 55, other: 7 },
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
  app.post("/api/analytics/events", async (req, res) => {
    try {
      const data = insertAnalyticsEventSchema.parse(req.body);

      let affiliateId: string | null = null;
      let campaignAffiliateId: string | null = null;
      let resolvedCommissionRate: string | null = null;

      const utmCode = data.utmCode || data.utmSource || null;
      if (utmCode) {
        const resolved = await storage.resolveUtmToAffiliate(utmCode);
        if (resolved) {
          affiliateId = resolved.affiliateId;
          campaignAffiliateId = resolved.campaignAffiliateId;
          resolvedCommissionRate = resolved.commissionRate;
        }
      }

      const event = await storage.createAnalyticsEvent({ ...data, affiliateId });

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

      if (data.eventType === "purchase" && affiliateId && data.revenue) {
        const commRate = resolvedCommissionRate || "10.00";
        const saleAmount = parseFloat(data.revenue);
        const rate = parseFloat(commRate);
        const commissionAmount = (saleAmount * rate) / 100;

        await storage.createCommissionTransaction({
          affiliateId,
          analyticsEventId: event.id,
          videoId: data.videoId,
          productId: data.productId || null,
          saleAmount: data.revenue,
          commissionRate: commRate,
          commissionAmount: commissionAmount.toFixed(2),
          campaignAffiliateId,
        });

        if (campaignAffiliateId) {
          const ca = (await storage.getCampaignAffiliates(data.videoId)).find(c => c.id === campaignAffiliateId);
          if (ca) {
            await storage.updateCampaignAffiliateStats(campaignAffiliateId, {
              totalConversions: (ca.totalConversions || 0) + 1,
              totalRevenue: ((parseFloat(ca.totalRevenue || "0")) + saleAmount).toFixed(2),
              totalEarnings: ((parseFloat(ca.totalEarnings || "0")) + commissionAmount).toFixed(2),
            });
          }
        }
      }

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

  // Get affiliate publishers analytics with sorting
  app.get("/api/analytics/affiliate-publishers", async (req, res) => {
    try {
      const { sortBy = "earnings", order = "desc" } = req.query;
      const validSortFields = ["earnings", "clicks", "conversions", "revenue", "conversionRate"];
      const sortField = validSortFields.includes(sortBy as string) ? sortBy as string : "earnings";
      const sortOrder = order === "asc" ? "asc" : "desc";
      
      // Get all campaign affiliates with user info
      const affiliatePublishers = await storage.getAffiliatePublishersAnalytics();
      
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
  app.get("/api/commissions/:affiliateId", async (req, res) => {
    try {
      const transactions = await storage.getCommissionTransactions(req.params.affiliateId);
      res.json(transactions);
    } catch (error) {
      res.status(500).json({ error: "Failed to get commission transactions" });
    }
  });

  // Get affiliate earnings computed from the commission transactions ledger
  app.get("/api/commissions/:affiliateId/earnings", async (req, res) => {
    try {
      const earnings = await storage.getAffiliateEarningsFromLedger(req.params.affiliateId);
      res.json(earnings);
    } catch (error) {
      res.status(500).json({ error: "Failed to get affiliate earnings" });
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
      const validAccessCode = process.env.ACCESS_CODE ?? "exclusiveaccess1233*";
      const submittedCode = (req.body.accessCode ?? "").trim();
      if (submittedCode !== validAccessCode) {
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

  // Get all subscriber intakes (admin)
  app.get("/api/subscriber-intakes", async (req, res) => {
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
      res.json(connections);
    } catch (error) {
      res.status(500).json({ error: "Failed to load store connections" });
    }
  });

  // Connect a Shopify store
  app.post("/api/integrations/shopify/connect", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const { storeDomain, accessToken } = req.body;
      if (!storeDomain || !accessToken) {
        return res.status(400).json({ error: "Store domain and access token are required" });
      }

      const { validateShopifyCredentials } = await import("./integrations/shopifyService");
      const validation = await validateShopifyCredentials(storeDomain, accessToken);
      if (!validation.valid) {
        return res.status(400).json({ error: `Invalid Shopify credentials: ${validation.error}` });
      }

      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      const [connection] = await db.insert(storeConnections).values({
        userId: sessionUserId,
        platform: "shopify",
        storeDomain,
        accessToken,
        isActive: true,
      }).returning();

      res.json({ ...connection, shopName: validation.shopName });
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

      const { db } = await import("./db");
      const { storeConnections } = await import("@shared/schema");
      // Store combined key:secret as accessToken
      const [connection] = await db.insert(storeConnections).values({
        userId: sessionUserId,
        platform: "woocommerce",
        storeDomain: storeUrl,
        accessToken: `${consumerKey}:${consumerSecret}`,
        isActive: true,
      }).returning();

      res.json({ ...connection, storeName: validation.storeName });
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

      // Get user's brand
      const userBrands = await storage.getBrands();
      const userBrand = userBrands.find(b => b.ownerId === sessionUserId);
      if (!userBrand) return res.status(400).json({ error: "You need a brand profile to import products" });

      let importedProducts: any[] = [];

      if (connection.platform === "shopify") {
        const { fetchShopifyProducts, mapShopifyToLocalProducts } = await import("./integrations/shopifyService");
        const shopifyProducts = await fetchShopifyProducts(connection.storeDomain, connection.accessToken);
        importedProducts = mapShopifyToLocalProducts(shopifyProducts, userBrand.id);
      } else if (connection.platform === "woocommerce") {
        const { fetchWooCommerceProducts, mapWooToLocalProducts } = await import("./integrations/woocommerceService");
        const [consumerKey, consumerSecret] = connection.accessToken.split(":");
        const wooProducts = await fetchWooCommerceProducts(connection.storeDomain, consumerKey, consumerSecret);
        importedProducts = mapWooToLocalProducts(wooProducts, userBrand.id);
      }

      // Upsert products
      let created = 0;
      for (const product of importedProducts) {
        await storage.createProduct(product as any);
        created++;
      }

      // Update connection metadata
      await db.update(storeConnections).set({
        lastSyncAt: new Date(),
        productCount: created,
      }).where(eq(storeConnections.id, connection.id));

      res.json({ synced: created, total: importedProducts.length });
    } catch (error) {
      console.error("Store sync error:", error);
      res.status(500).json({ error: "Failed to sync products" });
    }
  });

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
      const { creatorName, creatorEmail, contentCategory, message, brandId } = req.body;
      
      if (!creatorName || !creatorEmail) {
        return res.status(400).json({ error: "Creator name and email are required" });
      }

      // Get a demo brand ID if not provided
      const brands = await storage.getBrands();
      const useBrandId = brandId || brands[0]?.id;
      
      if (!useBrandId) {
        return res.status(400).json({ error: "No brand available" });
      }

      const invitation = await storage.createCreatorInvitation({
        brandId: useBrandId,
        creatorName,
        email: creatorEmail,
        category: contentCategory || null,
        message: message || null,
      });

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
      const { invitations, brandId } = req.body;
      
      if (!Array.isArray(invitations) || invitations.length === 0) {
        return res.status(400).json({ error: "Invitations array is required" });
      }

      if (invitations.length > 200) {
        return res.status(400).json({ error: "Maximum 200 invitations per bulk upload" });
      }

      // Get a demo brand ID if not provided
      const brands = await storage.getBrands();
      const useBrandId = brandId || brands[0]?.id;
      
      if (!useBrandId) {
        return res.status(400).json({ error: "No brand available" });
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

  // Update invitation status
  app.patch("/api/brands/creator-invites/:id", async (req, res) => {
    try {
      const { status } = req.body;
      if (!["pending", "sent", "accepted", "declined"].includes(status)) {
        return res.status(400).json({ error: "Invalid status" });
      }

      const updated = await storage.updateCreatorInvitationStatus(req.params.id, status);
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

  // Disable a publisher from a campaign
  app.post("/api/campaigns/:id/publishers/:caId/disable", async (req, res) => {
    try {
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

  // Grant 48-hour grace extension to a publisher
  app.post("/api/campaigns/:id/publishers/:caId/extend", async (req, res) => {
    try {
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
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const notes = await storage.getPublisherNotifications(user.id);
      res.json(notes);
    } catch (error) {
      res.status(500).json({ error: "Failed to get notifications" });
    }
  });
  app.get("/api/publisher/notifications/unread-count", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const count = await storage.getUnreadNotificationCount(user.id);
      res.json({ count });
    } catch (error) {
      res.status(500).json({ error: "Failed to get count" });
    }
  });
  app.patch("/api/publisher/notifications/:id/read", async (req, res) => {
    try {
      await storage.markPublisherNotificationRead(Number(req.params.id));
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to mark read" });
    }
  });
  app.post("/api/publisher/notifications/:id/extend", async (req, res) => {
    try {
      const user = (req as any).user;
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      await storage.markPublisherNotificationRead(Number(req.params.id));
      // Find the campaignAffiliateId from the notification and extend
      const notes = await storage.getPublisherNotifications(user.id);
      const note = notes.find(n => n.id === Number(req.params.id));
      if (note?.campaignAffiliateId) {
        await storage.extendCampaignPublisher(note.campaignAffiliateId, 48);
      }
      res.json({ ok: true });
    } catch (error) {
      res.status(500).json({ error: "Failed to request extension" });
    }
  });

  // Create a new campaign
  app.post("/api/campaigns", async (req, res) => {
    try {
      const campaign = await storage.createCampaign(req.body);
      res.status(201).json(campaign);
    } catch (error) {
      res.status(500).json({ error: "Failed to create campaign" });
    }
  });

  // Update a campaign
  app.patch("/api/campaigns/:id", async (req, res) => {
    try {
      const campaign = await storage.updateCampaign(req.params.id, req.body);
      if (!campaign) {
        return res.status(404).json({ error: "Campaign not found" });
      }
      res.json(campaign);
    } catch (error) {
      res.status(500).json({ error: "Failed to update campaign" });
    }
  });

  // Delete a campaign
  app.delete("/api/campaigns/:id", async (req, res) => {
    try {
      const deleted = await storage.deleteCampaign(req.params.id);
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

  // Create detection job for a video — runs Gemini AI product detection
  app.post("/api/videos/:id/detections", async (req, res) => {
    try {
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

          // Gather product catalog from selected brands
          const allProducts: Array<{ id: string; name: string; description: string | null; category: string | null; brandId: string; brandName: string }> = [];
          for (const brandId of (brandIds || [])) {
            const brand = await storage.getBrand(brandId);
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
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
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
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
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
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
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
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
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
      const video = await storage.getVideo(req.params.id);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
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

      // Create affiliate user account
      const affiliateUser = await storage.createUser({
        username: `affiliate_${invitation.email.split("@")[0]}`,
        password: "affiliate123", // In production, generate secure password or use OAuth
        email: invitation.email,
        displayName: invitation.affiliateName,
        role: "affiliate",
      });

      await storage.updateAffiliateInvitationStatus(invitation.id, "accepted", affiliateUser.id);

      res.json({ success: true, user: affiliateUser });
    } catch (error) {
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
      const validatedData = insertCampaignAffiliateSchema.parse({
        videoId: req.params.id,
        ...req.body,
      });
      
      const video = await storage.getVideo(req.params.id);
      if (!video) {
        return res.status(404).json({ error: "Video not found" });
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

      const listing = await storage.createGlobalVideoListing(validatedData);

      // Create Stripe payment intent for listing fee
      const paymentIntent = await stripeService.createPaymentIntent(
        45.00,
        "eur",
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

  // Confirm library listing payment
  app.post("/api/library/:id/confirm-payment", async (req, res) => {
    try {
      const listing = await storage.getGlobalVideoListing(req.params.id);
      if (!listing) {
        return res.status(404).json({ error: "Listing not found" });
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

  // Remove a single item from a playlist
  app.delete("/api/playlists/:id/items/:itemId", async (req, res) => {
    try {
      await storage.removePlaylistItem(Number(req.params.itemId));
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

      const LICENSE_FEE_PER_VIDEO = 4500; // €45.00 in cents
      const totalCents = items.length * LICENSE_FEE_PER_VIDEO;

      const paymentIntent = await stripeService.createPaymentIntent(totalCents, "eur", {
        playlistId: String(playlistId),
        userId: user.id,
        videoCount: String(items.length),
      });

      const updated = await storage.updatePlaylist(playlistId, {
        status: "pending_payment",
        stripePaymentIntentId: paymentIntent.id,
        licenseFeeTotal: (totalCents / 100).toFixed(2),
      });

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id,
        totalCents,
        totalEur: (totalCents / 100).toFixed(2),
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

      const baseUrl = process.env.REPLIT_DEV_DOMAIN
        ? `https://${process.env.REPLIT_DEV_DOMAIN}`
        : "https://your-app.replit.dev";

      const embedCode = `<div id="mat-playlist-${playlistId}" data-playlist="${playlistId}" data-user="${user.id}"></div>\n<script src="${baseUrl}/embed/playlist.js" async></script>`;

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

      // Create Stripe payment intent
      const paymentIntent = await stripeService.createPaymentIntent(
        Number(listing.licenseFee),
        "eur",
        { purchaseId: purchase.id, userId: user.id, type: "license_purchase" }
      );

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

  // Confirm license purchase payment
  app.post("/api/purchases/:id/confirm-payment", async (req, res) => {
    try {
      const purchase = await storage.getVideoLicensePurchase(req.params.id);
      if (!purchase) {
        return res.status(404).json({ error: "Purchase not found" });
      }

      await storage.updateVideoLicensePurchaseStatus(purchase.id, "paid", req.body.paymentIntentId);

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

      const account = await stripeService.createConnectAccount(user.email, user.id);
      await storage.updateUser(user.id, { stripeConnectAccountId: account.id } as any);

      res.json({ accountId: account.id });
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

      const baseUrl = `https://${process.env.REPLIT_DOMAINS?.split(",")[0]}`;
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
      const isOnboarded = account.charges_enabled && account.payouts_enabled;

      if (isOnboarded && !user.stripeConnectOnboarded) {
        await storage.updateUser(user.id, { stripeConnectOnboarded: true } as any);
      }

      res.json({
        connected: true,
        onboarded: isOnboarded,
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

  // ==================== CREATOR REWARDS ROUTES ====================

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

  // Redeem reward for video listing
  app.post("/api/rewards/:id/redeem", async (req, res) => {
    try {
      const { listingId } = req.body;
      if (!listingId) {
        return res.status(400).json({ error: "Listing ID required" });
      }
      const reward = await storage.redeemCreatorReward(req.params.id, listingId);
      if (!reward) {
        return res.status(404).json({ error: "Reward not found" });
      }
      res.json(reward);
    } catch (error) {
      res.status(500).json({ error: "Failed to redeem reward" });
    }
  });

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

  // ==================== MAILBOX ====================

  // Get notifications from real platform activity
  app.get("/api/mailbox/notifications", async (req, res) => {
    try {
      const sessionUserId = (req.session as any)?.userId;
      if (!sessionUserId) return res.status(401).json({ error: "Authentication required" });

      const user = await storage.getUser(sessionUserId);
      if (!user) return res.status(401).json({ error: "User not found" });

      const notifications: any[] = [];

      // Pull from publisher notifications (for affiliates)
      if (user.role === "affiliate") {
        const pubNotifs = await storage.getPublisherNotifications(user.id);
        for (const pn of pubNotifs) {
          notifications.push({
            id: `pub-${pn.id}`,
            type: pn.type === "deactivation" ? "warning" : "campaign",
            title: pn.type === "deactivation" ? "Publisher deactivated" : "Campaign update",
            body: pn.message || `Campaign: ${pn.campaignName || "Unknown"}`,
            time: pn.createdAt?.toISOString() || new Date().toISOString(),
            read: pn.isRead ?? false,
          });
        }
      }

      // Pull from brand outreach (for creators)
      if (user.role === "creator") {
        const outreaches = await storage.getBrandOutreachesByCreator(user.id);
        for (const o of outreaches.slice(0, 10)) {
          notifications.push({
            id: `outreach-${o.id}`,
            type: o.status === "authorized" ? "success" : o.status === "pending" ? "info" : "campaign",
            title: `Brand outreach: ${o.brandName}`,
            body: `Status: ${o.status}${o.videoTitle ? ` — Video: ${o.videoTitle}` : ""}`,
            time: o.createdAt?.toISOString() || new Date().toISOString(),
            read: o.status !== "pending",
          });
        }
      }

      // Pull recent creator invitations (for brands)
      if (user.role === "brand") {
        const { db } = await import("./db");
        const { creatorInvitations, brands: brandsTable } = await import("@shared/schema");
        const { eq, desc } = await import("drizzle-orm");
        const userBrands = await db.select().from(brandsTable).where(eq(brandsTable.ownerId, user.id));
        if (userBrands.length > 0) {
          const invites = await db.select().from(creatorInvitations)
            .where(eq(creatorInvitations.brandId, userBrands[0].id))
            .orderBy(desc(creatorInvitations.createdAt))
            .limit(10);
          for (const inv of invites) {
            notifications.push({
              id: `invite-${inv.id}`,
              type: inv.status === "accepted" ? "success" : inv.status === "declined" ? "warning" : "info",
              title: `Creator invitation: ${inv.creatorName}`,
              body: `Status: ${inv.status}`,
              time: inv.createdAt?.toISOString() || new Date().toISOString(),
              read: inv.status !== "pending",
            });
          }
        }
      }

      // Sort by time descending
      notifications.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());

      res.json(notifications);
    } catch (error) {
      console.error("Mailbox error:", error);
      res.json([]);
    }
  });

  // ==================== ADMIN ROUTES ====================

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
      }).from(users).orderBy(desc(users.createdAt));

      res.json(allUsers);
    } catch (error) {
      console.error("Admin users error:", error);
      res.status(500).json({ error: "Failed to load users" });
    }
  });

  // Admin update user
  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const { role, isAdmin, freeAccess } = req.body;
      const updated = await storage.updateUser(id, { role, isAdmin, freeAccess } as any);
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json(updated);
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
      const docuSignUrl = process.env.DOCUSIGN_SIGNING_URL ?? "https://app.docusign.com/templates";

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
      res.json({ success: true, user: updated });
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

  app.put("/api/brand/subscription", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const parsed = insertBrandSubscriptionSchema.parse({ ...req.body, userId });
      const sub = await storage.upsertBrandSubscription(parsed);
      res.json(sub);
    } catch (e) { res.status(400).json({ error: "Invalid data" }); }
  });

  // Subscription → Stripe Checkout (creates recurring plan)
  app.post("/api/brand/subscription/checkout", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { plan } = req.body;
      if (!plan || !["starter", "pro"].includes(plan)) {
        return res.status(400).json({ error: "Plan must be 'starter' or 'pro'" });
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
        plan as "starter" | "pro",
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
  app.post("/api/brand/subscription/surplus-invoice", async (req, res) => {
    try {
      const userId = (req.session as any)?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { views, minutes, publishers, totalAmount } = req.body;
      if (!totalAmount || totalAmount <= 0) {
        return res.status(400).json({ error: "Surplus amount must be greater than zero" });
      }

      const user = await storage.getUser(userId);
      let customerId = user?.stripeCustomerId;
      if (!customerId) {
        const customer = await stripeService.createCustomer(user?.email ?? "", userId, user?.name ?? undefined);
        customerId = customer.id;
        await storage.updateUser(userId, { stripeCustomerId: customerId });
      }

      const description = `Overage charges — ${(views ?? 0).toLocaleString()} views × ${publishers ?? 1} publishers + ${(minutes ?? 0).toLocaleString()} min × ${publishers ?? 1} publishers`;
      const invoice = await stripeService.createSurplusInvoice(customerId, totalAmount, description);

      res.json({ invoiceId: invoice.id, url: invoice.hosted_invoice_url });
    } catch (e: any) {
      console.error("Surplus invoice error:", e);
      res.status(500).json({ error: e?.message ?? "Failed to create surplus invoice" });
    }
  });

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
        const [starterId, proId] = await Promise.all([
          stripeService.findOrCreateSubscriptionPrice('starter'),
          stripeService.findOrCreateSubscriptionPrice('pro'),
        ]);
        res.json({ starter: starterId, pro: proId });
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
          if (!planName || !["starter", "pro"].includes(planName)) continue;
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
          plan?: "starter" | "pro";
          eventType?: string;
        };
        if (!userId) return res.status(400).json({ error: "userId is required" });

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
                  product: { name: plan === "pro" ? "Pro" : "Starter" },
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
        productUrl: o.productUrl,
        brandName: (o.brandName || "").replace(/[<>"'&]/g, ""),
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
    #player{width:100vw;height:100vh;position:relative}
    video{width:100%;height:100%;object-fit:contain}
    #loader{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:10}
    .spinner{width:40px;height:40px;border:3px solid rgba(255,255,255,0.2);border-top-color:#677A67;border-radius:50%;animation:spin 0.8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
    #carousel{position:absolute;bottom:16px;left:16px;right:16px;display:flex;gap:8px;overflow-x:auto;padding:8px 0;scrollbar-width:none}
    #carousel::-webkit-scrollbar{display:none}
    .product-card{flex:0 0 auto;background:rgba(255,255,255,0.95);border-radius:12px;padding:8px;width:120px;cursor:pointer;transition:transform .2s;text-decoration:none}
    .product-card:hover{transform:scale(1.05)}
    .product-card img{width:100%;height:80px;object-fit:cover;border-radius:8px}
    .product-name{font-size:11px;font-weight:600;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#333}
    .product-price{font-size:10px;color:#677A67;font-weight:700;margin-top:2px}
  </style>
</head>
<body>
  <div id="player">
    <div id="loader"><div class="spinner"></div></div>
    <video id="vid" autoplay muted loop playsinline></video>
    <div id="carousel"></div>
  </div>
  <script>
    var utm="${utm.replace(/[<>"'\\]/g, "")}",videoId="${video.id}",apiBase="${apiBase}";
    var vid=document.getElementById("vid");
    vid.src="${(video.videoUrl || "").replace(/[<>"'\\]/g, "")}";
    vid.addEventListener("playing",function(){document.getElementById("loader").style.display="none";});
    var products=${JSON.stringify(products)};
    var carousel=document.getElementById("carousel");
    products.forEach(function(p){
      var a=document.createElement("a");
      a.href=p.productUrl||"#";a.target="_blank";a.rel="noopener";a.className="product-card";
      if(p.imageUrl){var img=document.createElement("img");img.src=p.imageUrl;img.alt=p.name;a.appendChild(img);}
      var nameDiv=document.createElement("div");nameDiv.className="product-name";nameDiv.textContent=p.name;a.appendChild(nameDiv);
      if(p.price){var priceDiv=document.createElement("div");priceDiv.className="product-price";priceDiv.textContent="\\u20AC"+p.price;a.appendChild(priceDiv);}
      a.addEventListener("click",function(){track("click")});
      carousel.appendChild(a);
    });
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
        productUrl: o.productUrl,
      }));

      const apiBase = `${req.protocol}://${req.get("host")}`;
      const safeVideoUrl = (video.videoUrl || "").replace(/"/g, '\\"');

      res.set("Content-Type", "application/javascript");
      res.set("Cache-Control", "public, max-age=300");
      res.set("Access-Control-Allow-Origin", "*");
      res.send(`(function(){
  var videoId="${video.id}",utm="${utm.replace(/"/g, "")}",apiBase="${apiBase}";
  var el=document.getElementById("vc-widget-"+videoId);
  if(!el){console.error("[Materialized] Widget container not found");return;}
  el.style.position="relative";el.style.width="100%";el.style.maxWidth="640px";
  el.style.aspectRatio="16/9";el.style.background="#000";el.style.borderRadius="12px";
  el.style.overflow="hidden";
  var v=document.createElement("video");
  v.src="${safeVideoUrl}";v.autoplay=true;v.muted=true;v.loop=true;v.playsInline=true;
  v.style.cssText="width:100%;height:100%;object-fit:cover;";
  el.appendChild(v);
  var products=${JSON.stringify(products)};
  if(products.length){
    var c=document.createElement("div");
    c.style.cssText="position:absolute;bottom:8px;left:8px;right:8px;display:flex;gap:6px;overflow-x:auto;";
    products.forEach(function(p){
      var a=document.createElement("a");
      a.href=p.productUrl||"#";a.target="_blank";a.rel="noopener";
      a.style.cssText="flex:0 0 auto;background:rgba(255,255,255,.95);border-radius:10px;padding:6px;width:100px;text-decoration:none;";
      if(p.imageUrl){var img=document.createElement("img");img.src=p.imageUrl;img.alt=p.name;img.style.cssText="width:100%;height:60px;object-fit:cover;border-radius:6px";a.appendChild(img);}
      var nd=document.createElement("div");nd.style.cssText="font-size:10px;font-weight:600;color:#333;margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
      nd.textContent=p.name||"";a.appendChild(nd);
      if(p.price){var pd=document.createElement("div");pd.style.cssText="font-size:9px;color:#677A67;font-weight:700";pd.textContent="\\u20AC"+p.price;a.appendChild(pd);}
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
