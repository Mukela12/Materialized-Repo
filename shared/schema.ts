import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, numeric, serial, timestamp, boolean, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Enums
export const userRoleEnum = pgEnum("user_role", ["creator", "brand", "affiliate"]);
export const videoStatusEnum = pgEnum("video_status", ["draft", "processing", "published", "archived"]);
export const referralStatusEnum = pgEnum("referral_status", ["pending", "sent", "accepted", "declined"]);
export const buttonLabelEnum = pgEnum("button_label", [
  "BUY NOW", "PRE ORDER", "RENT", "ENQUIRE", "APPLY NOW", "DONATE", "BOOK NOW", "BID NOW"
]);
export const detectionJobStatusEnum = pgEnum("detection_job_status", [
  "queued", "processing", "completed", "failed"
]);
export const carouselPositionEnum = pgEnum("carousel_position", [
  "bottom", "top", "left", "right", "bottom-left", "bottom-right", "top-left", "top-right"
]);
export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft", "active", "paused", "completed", "cancelled"
]);
export const invitationStatusEnum = pgEnum("invitation_status", [
  "pending", "sent", "accepted", "declined"
]);
export const videoPublishStatusEnum = pgEnum("video_publish_status", [
  "unpublished", "pending_payment", "published", "delisted"
]);
export const licensePurchaseStatusEnum = pgEnum("license_purchase_status", [
  "pending", "paid", "failed", "refunded"
]);
export const payoutStatusEnum = pgEnum("payout_status", [
  "pending", "processing", "paid", "failed"
]);

export const videoCategoryEnum = pgEnum("video_category", [
  "fashion", "travel", "skincare", "cuisine_bev", "health", "eco", "interiors"
]);

export const rewardTypeEnum = pgEnum("reward_type", [
  "brand_referral", "bonus", "promotional"
]);

export const rewardStatusEnum = pgEnum("reward_status", [
  "pending", "credited", "redeemed", "expired"
]);

export const commissionStatusEnum = pgEnum("commission_status", [
  "pending", "approved", "paid", "rejected"
]);

// Users table with role-based access
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  role: userRoleEnum("role").notNull().default("creator"),
  affiliateTrackingId: text("affiliate_tracking_id").default(sql`gen_random_uuid()`),
  referralCode: text("referral_code").default(sql`'REF_' || substr(gen_random_uuid()::text, 1, 8)`),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).default("15.00"),
  charityContribution: decimal("charity_contribution", { precision: 5, scale: 2 }).default("0.00"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  stripeConnectOnboarded: boolean("stripe_connect_onboarded").default(false),
  isAdmin: boolean("is_admin").default(false),
  freeAccess: boolean("free_access").default(false),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpires: timestamp("email_verification_expires"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Brands table
export const brands = pgTable("brands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  website: text("website"),
  category: text("category"),
  description: text("description"),
  prContactEmail: text("pr_contact_email"),
  prContactName: text("pr_contact_name"),
  isActive: boolean("is_active").default(true),
  ownerId: varchar("owner_id").references(() => users.id),
});

// Products table for brand inventory
export const products = pgTable("products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  brandId: varchar("brand_id").notNull().references(() => brands.id),
  name: text("name").notNull(),
  description: text("description"),
  price: decimal("price", { precision: 10, scale: 2 }).notNull(),
  imageUrl: text("image_url"),
  productUrl: text("product_url"),
  sku: text("sku"),
  category: text("category"),
  productType: text("product_type"), // "Physical" | "Digital" | "Service" | "Subscription" | "Bundle"
  thumbnailType: text("thumbnail_type"), // "image" | "video"
  isActive: boolean("is_active").default(true),
});

// Videos table
export const videos = pgTable("videos", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  description: text("description"),
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  status: videoStatusEnum("status").default("draft"),
  embedCode: text("embed_code"),
  utmCode: text("utm_code").default(sql`gen_random_uuid()`),
  totalViews: integer("total_views").default(0),
  totalClicks: integer("total_clicks").default(0),
  totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }).default("0.00"),
  categories: text("categories"), // JSON array of up to 3 categories
  durationSeconds: integer("duration_seconds"),
  isTrial: boolean("is_trial").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Video-Brand associations (many-to-many)
export const videoBrands = pgTable("video_brands", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  brandId: varchar("brand_id").notNull().references(() => brands.id),
});

// Detected products in videos
export const videoProducts = pgTable("video_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  productId: varchar("product_id").notNull().references(() => products.id),
  confidence: decimal("confidence", { precision: 5, scale: 2 }),
  timestamp: decimal("timestamp", { precision: 10, scale: 2 }),
});

// Brand referrals from creators
export const brandReferrals = pgTable("brand_referrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id").notNull().references(() => users.id),
  brandName: text("brand_name").notNull(),
  prContactName: text("pr_contact_name").notNull(),
  prContactEmail: text("pr_contact_email").notNull(),
  productCategory: text("product_category"),
  message: text("message"),
  status: referralStatusEnum("status").default("pending"),
  signupToken: text("signup_token").default(sql`gen_random_uuid()`),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Analytics events
export const analyticsEvents = pgTable("analytics_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  eventType: text("event_type").notNull(), // view, click, purchase
  productId: varchar("product_id").references(() => products.id),
  affiliateId: varchar("affiliate_id").references(() => users.id),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmCode: text("utm_code"),
  referrerDomain: text("referrer_domain"),
  revenue: decimal("revenue", { precision: 10, scale: 2 }),
  country: text("country"),
  device: text("device"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Affiliate payouts
export const affiliatePayouts = pgTable("affiliate_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").default("pending"), // pending, paid
  periodStart: timestamp("period_start"),
  periodEnd: timestamp("period_end"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Brand Campaigns - marketing campaigns with budgets and ROI tracking
export const campaigns = pgTable("campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  brandId: varchar("brand_id").notNull().references(() => brands.id),
  name: text("name").notNull(),
  description: text("description"),
  status: campaignStatusEnum("status").default("draft"),
  budget: decimal("budget", { precision: 10, scale: 2 }).notNull(),
  spentAmount: decimal("spent_amount", { precision: 10, scale: 2 }).default("0.00"),
  startDate: timestamp("start_date"),
  endDate: timestamp("end_date"),
  targetViews: integer("target_views"),
  targetClicks: integer("target_clicks"),
  targetConversions: integer("target_conversions"),
  targetRevenue: decimal("target_revenue", { precision: 10, scale: 2 }),
  actualViews: integer("actual_views").default(0),
  actualClicks: integer("actual_clicks").default(0),
  actualConversions: integer("actual_conversions").default(0),
  actualRevenue: decimal("actual_revenue", { precision: 10, scale: 2 }).default("0.00"),
  productIds: text("product_ids"), // JSON array of product IDs included in campaign
  creatorIds: text("creator_ids"), // JSON array of creator IDs participating
  videoId: varchar("video_id").references(() => videos.id), // primary featured video
  repostCount: integer("repost_count").default(0),
  totalDays: integer("total_days").default(60),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Brand Kits - stores brand styling defaults from PDF extraction or manual entry
export const brandKits = pgTable("brand_kits", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  sourcePdfUrl: text("source_pdf_url"),
  extractedFonts: text("extracted_fonts"), // JSON array of font names
  extractedColors: text("extracted_colors"), // JSON array of {name, cmyk, hex, rgb}
  manualFonts: text("manual_fonts"), // JSON array of manually added fonts
  manualColors: text("manual_colors"), // JSON array of manually added colors
  defaultButtonFont: text("default_button_font"),
  defaultButtonColor: text("default_button_color"), // hex color
  defaultButtonTextColor: text("default_button_text_color"), // hex color
  defaultCornerRadius: integer("default_corner_radius").default(16),
  defaultBackgroundOpacity: integer("default_background_opacity").default(55),
  defaultShowThumbnail: boolean("default_show_thumbnail").default(true),
  defaultShowButton: boolean("default_show_button").default(true),
  defaultShowPrice: boolean("default_show_price").default(true),
  defaultShowTitle: boolean("default_show_title").default(true),
  defaultButtonLabel: buttonLabelEnum("default_button_label").default("BUY NOW"),
  defaultPosition: carouselPositionEnum("default_position").default("bottom"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Video Carousel Overrides - per-video customizations
export const videoCarouselOverrides = pgTable("video_carousel_overrides", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  position: carouselPositionEnum("position"),
  positionOffsetX: integer("position_offset_x").default(0),
  positionOffsetY: integer("position_offset_y").default(0),
  delayUntilEnd: boolean("delay_until_end").default(false),
  cornerRadius: integer("corner_radius"),
  backgroundOpacity: integer("background_opacity"),
  showThumbnail: boolean("show_thumbnail"),
  showButton: boolean("show_button"),
  showPrice: boolean("show_price"),
  showTitle: boolean("show_title"),
  buttonLabel: buttonLabelEnum("button_label"),
  buttonFont: text("button_font"),
  buttonColor: text("button_color"),
  buttonTextColor: text("button_text_color"),
  manualProducts: text("manual_products"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Video Detection Jobs - tracks AI product detection processing
export const videoDetectionJobs = pgTable("video_detection_jobs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  selectedBrandIds: text("selected_brand_ids"), // JSON array of brand IDs to scan
  status: detectionJobStatusEnum("status").default("queued"),
  frameSamplingRate: integer("frame_sampling_rate").default(1), // frames per second
  totalFrames: integer("total_frames").default(0),
  processedFrames: integer("processed_frames").default(0),
  error: text("error"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Video Detection Results - individual product detections with timestamps
export const videoDetectionResults = pgTable("video_detection_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobId: varchar("job_id").notNull().references(() => videoDetectionJobs.id),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  productId: varchar("product_id").notNull().references(() => products.id),
  brandId: varchar("brand_id").notNull().references(() => brands.id),
  confidence: decimal("confidence", { precision: 5, scale: 2 }).notNull(),
  frameTimestamp: decimal("frame_timestamp", { precision: 10, scale: 2 }).notNull(), // seconds into video
  startTime: decimal("start_time", { precision: 10, scale: 2 }), // when to show product
  endTime: decimal("end_time", { precision: 10, scale: 2 }), // when to hide product
  boundingBox: text("bounding_box"), // JSON {x, y, width, height}
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Video Product Overlays - per-product timing and position for the video player
export const videoProductOverlays = pgTable("video_product_overlays", {
  id: serial("id").primaryKey(),
  videoId: varchar("video_id").notNull().references(() => videos.id, { onDelete: "cascade" }),
  productId: varchar("product_id").references(() => products.id),
  name: text("name").notNull(),
  productUrl: text("product_url"),
  imageUrl: text("image_url"),
  price: text("price"),
  brandName: text("brand_name"),
  position: carouselPositionEnum("position").notNull().default("bottom"),
  startTime: decimal("start_time", { precision: 10, scale: 2 }).notNull().default("0"),
  endTime: decimal("end_time", { precision: 10, scale: 2 }),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Creator Invitations - brand invitations to influencer affiliates
export const creatorInvitations = pgTable("creator_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  brandId: varchar("brand_id").notNull().references(() => brands.id),
  creatorName: text("creator_name").notNull(),
  email: text("email").notNull(),
  category: text("category"),
  message: text("message"),
  status: invitationStatusEnum("status").default("pending"),
  invitedAt: timestamp("invited_at").default(sql`CURRENT_TIMESTAMP`),
});

// Affiliate Invitations - invite affiliates to promote videos
export const affiliateInvitations = pgTable("affiliate_invitations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  inviterId: varchar("inviter_id").notNull().references(() => users.id),
  affiliateName: text("affiliate_name").notNull(),
  email: text("email").notNull(),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull().default("10.00"),
  message: text("message"),
  status: invitationStatusEnum("status").default("pending"),
  inviteToken: text("invite_token").default(sql`gen_random_uuid()`),
  acceptedByUserId: varchar("accepted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Campaign Affiliates - affiliates assigned to specific video campaigns
export const campaignAffiliates = pgTable("campaign_affiliates", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  affiliateId: varchar("affiliate_id").notNull().references(() => users.id),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull(),
  utmCode: text("utm_code").default(sql`gen_random_uuid()`),
  embedCode: text("embed_code"),
  totalClicks: integer("total_clicks").default(0),
  totalConversions: integer("total_conversions").default(0),
  totalRevenue: decimal("total_revenue", { precision: 10, scale: 2 }).default("0.00"),
  totalEarnings: decimal("total_earnings", { precision: 10, scale: 2 }).default("0.00"),
  notifiedAt: timestamp("notified_at"),
  isDisabled: boolean("is_disabled").default(false),
  disabledAt: timestamp("disabled_at"),
  graceUntil: timestamp("grace_until"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Global Video Library - videos available for affiliate licensing
export const globalVideoLibrary = pgTable("global_video_library", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  creatorId: varchar("creator_id").notNull().references(() => users.id),
  licenseFee: decimal("license_fee", { precision: 10, scale: 2 }).notNull().default("45.00"),
  publishStatus: videoPublishStatusEnum("publish_status").default("unpublished"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  listingTitle: text("listing_title"),
  listingDescription: text("listing_description"),
  category: text("category"),
  tags: text("tags"),
  totalLicenses: integer("total_licenses").default(0),
  listedAt: timestamp("listed_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Video License Purchases - affiliates purchasing video licenses
export const videoLicensePurchases = pgTable("video_license_purchases", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  globalListingId: varchar("global_listing_id").notNull().references(() => globalVideoLibrary.id),
  affiliateId: varchar("affiliate_id").notNull().references(() => users.id),
  licenseFee: decimal("license_fee", { precision: 10, scale: 2 }).notNull(),
  status: licensePurchaseStatusEnum("status").default("pending"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  utmCode: text("utm_code").default(sql`gen_random_uuid()`),
  embedCode: text("embed_code"),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull().default("10.00"),
  purchasedAt: timestamp("purchased_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Video Publish Records - embed code and UTM tracking for published videos
export const videoPublishRecords = pgTable("video_publish_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  embedCode: text("embed_code").notNull(),
  embedCodeMinified: text("embed_code_minified"),
  widgetConfig: text("widget_config"),
  baseUtmCode: text("base_utm_code").default(sql`gen_random_uuid()`),
  publishedAt: timestamp("published_at").default(sql`CURRENT_TIMESTAMP`),
  isActive: boolean("is_active").default(true),
});

// User Profiles - personal details for all user types
export const userProfiles = pgTable("user_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  bio: varchar("bio", { length: 100 }),
  profileMediaUrl: text("profile_media_url"),
  profileMediaType: text("profile_media_type"), // "image" or "video"
  locationCity: text("location_city"),
  locationCountry: text("location_country"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Creator Rewards - tracks credits earned from brand referrals
export const creatorRewards = pgTable("creator_rewards", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id").notNull().references(() => users.id),
  rewardType: rewardTypeEnum("reward_type").notNull().default("brand_referral"),
  creditsAmount: integer("credits_amount").notNull().default(45),
  euroValue: decimal("euro_value", { precision: 10, scale: 2 }).notNull().default("45.00"),
  status: rewardStatusEnum("status").notNull().default("credited"),
  brandReferralId: varchar("brand_referral_id").references(() => brandReferrals.id),
  description: text("description"),
  redeemedForListingId: varchar("redeemed_for_listing_id"),
  earnedAt: timestamp("earned_at").default(sql`CURRENT_TIMESTAMP`),
  redeemedAt: timestamp("redeemed_at"),
});

// Embed Deployments - tracks where affiliate embed codes are deployed
export const embedDeployments = pgTable("embed_deployments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  affiliateId: varchar("affiliate_id").notNull().references(() => users.id),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  utmCode: text("utm_code").notNull(),
  referrerDomain: text("referrer_domain").notNull(),
  referrerUrl: text("referrer_url"),
  totalLoads: integer("total_loads").default(1),
  firstSeenAt: timestamp("first_seen_at").default(sql`CURRENT_TIMESTAMP`),
  lastSeenAt: timestamp("last_seen_at").default(sql`CURRENT_TIMESTAMP`),
});

// Commission Transactions - line-by-line ledger for affiliate payouts
export const commissionTransactions = pgTable("commission_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  affiliateId: varchar("affiliate_id").notNull().references(() => users.id),
  analyticsEventId: varchar("analytics_event_id").references(() => analyticsEvents.id),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  productId: varchar("product_id").references(() => products.id),
  saleAmount: decimal("sale_amount", { precision: 10, scale: 2 }).notNull(),
  commissionRate: decimal("commission_rate", { precision: 5, scale: 2 }).notNull(),
  commissionAmount: decimal("commission_amount", { precision: 10, scale: 2 }).notNull(),
  status: commissionStatusEnum("status").default("pending"),
  campaignAffiliateId: varchar("campaign_affiliate_id").references(() => campaignAffiliates.id),
  licensePurchaseId: varchar("license_purchase_id").references(() => videoLicensePurchases.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// Relations
export const usersRelations = relations(users, ({ many, one }) => ({
  videos: many(videos),
  referrals: many(brandReferrals),
  payouts: many(affiliatePayouts),
  ownedBrand: one(brands, { fields: [users.id], references: [brands.ownerId] }),
}));

export const brandsRelations = relations(brands, ({ many, one }) => ({
  products: many(products),
  videoBrands: many(videoBrands),
  campaigns: many(campaigns),
  creatorInvitations: many(creatorInvitations),
  owner: one(users, { fields: [brands.ownerId], references: [users.id] }),
}));

export const creatorInvitationsRelations = relations(creatorInvitations, ({ one }) => ({
  brand: one(brands, { fields: [creatorInvitations.brandId], references: [brands.id] }),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  brand: one(brands, { fields: [products.brandId], references: [brands.id] }),
  videoProducts: many(videoProducts),
}));

export const videosRelations = relations(videos, ({ one, many }) => ({
  creator: one(users, { fields: [videos.creatorId], references: [users.id] }),
  videoBrands: many(videoBrands),
  videoProducts: many(videoProducts),
  analyticsEvents: many(analyticsEvents),
}));

export const videoBrandsRelations = relations(videoBrands, ({ one }) => ({
  video: one(videos, { fields: [videoBrands.videoId], references: [videos.id] }),
  brand: one(brands, { fields: [videoBrands.brandId], references: [brands.id] }),
}));

export const videoProductsRelations = relations(videoProducts, ({ one }) => ({
  video: one(videos, { fields: [videoProducts.videoId], references: [videos.id] }),
  product: one(products, { fields: [videoProducts.productId], references: [products.id] }),
}));

export const brandReferralsRelations = relations(brandReferrals, ({ one }) => ({
  creator: one(users, { fields: [brandReferrals.creatorId], references: [users.id] }),
}));

export const analyticsEventsRelations = relations(analyticsEvents, ({ one }) => ({
  video: one(videos, { fields: [analyticsEvents.videoId], references: [videos.id] }),
  product: one(products, { fields: [analyticsEvents.productId], references: [products.id] }),
  affiliate: one(users, { fields: [analyticsEvents.affiliateId], references: [users.id] }),
}));

export const affiliatePayoutsRelations = relations(affiliatePayouts, ({ one }) => ({
  user: one(users, { fields: [affiliatePayouts.userId], references: [users.id] }),
}));

export const campaignsRelations = relations(campaigns, ({ one }) => ({
  brand: one(brands, { fields: [campaigns.brandId], references: [brands.id] }),
}));

export const brandKitsRelations = relations(brandKits, ({ one }) => ({
  user: one(users, { fields: [brandKits.userId], references: [users.id] }),
}));

export const videoCarouselOverridesRelations = relations(videoCarouselOverrides, ({ one }) => ({
  video: one(videos, { fields: [videoCarouselOverrides.videoId], references: [videos.id] }),
}));

export const videoDetectionJobsRelations = relations(videoDetectionJobs, ({ one, many }) => ({
  video: one(videos, { fields: [videoDetectionJobs.videoId], references: [videos.id] }),
  results: many(videoDetectionResults),
}));

export const videoDetectionResultsRelations = relations(videoDetectionResults, ({ one }) => ({
  job: one(videoDetectionJobs, { fields: [videoDetectionResults.jobId], references: [videoDetectionJobs.id] }),
  video: one(videos, { fields: [videoDetectionResults.videoId], references: [videos.id] }),
  product: one(products, { fields: [videoDetectionResults.productId], references: [products.id] }),
  brand: one(brands, { fields: [videoDetectionResults.brandId], references: [brands.id] }),
}));

export const affiliateInvitationsRelations = relations(affiliateInvitations, ({ one }) => ({
  inviter: one(users, { fields: [affiliateInvitations.inviterId], references: [users.id] }),
  acceptedBy: one(users, { fields: [affiliateInvitations.acceptedByUserId], references: [users.id] }),
}));

export const campaignAffiliatesRelations = relations(campaignAffiliates, ({ one }) => ({
  video: one(videos, { fields: [campaignAffiliates.videoId], references: [videos.id] }),
  affiliate: one(users, { fields: [campaignAffiliates.affiliateId], references: [users.id] }),
}));

export const globalVideoLibraryRelations = relations(globalVideoLibrary, ({ one, many }) => ({
  video: one(videos, { fields: [globalVideoLibrary.videoId], references: [videos.id] }),
  creator: one(users, { fields: [globalVideoLibrary.creatorId], references: [users.id] }),
  purchases: many(videoLicensePurchases),
}));

export const videoLicensePurchasesRelations = relations(videoLicensePurchases, ({ one }) => ({
  listing: one(globalVideoLibrary, { fields: [videoLicensePurchases.globalListingId], references: [globalVideoLibrary.id] }),
  affiliate: one(users, { fields: [videoLicensePurchases.affiliateId], references: [users.id] }),
}));

export const videoPublishRecordsRelations = relations(videoPublishRecords, ({ one }) => ({
  video: one(videos, { fields: [videoPublishRecords.videoId], references: [videos.id] }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, { fields: [userProfiles.userId], references: [users.id] }),
}));

export const creatorRewardsRelations = relations(creatorRewards, ({ one }) => ({
  creator: one(users, { fields: [creatorRewards.creatorId], references: [users.id] }),
  brandReferral: one(brandReferrals, { fields: [creatorRewards.brandReferralId], references: [brandReferrals.id] }),
}));

export const embedDeploymentsRelations = relations(embedDeployments, ({ one }) => ({
  affiliate: one(users, { fields: [embedDeployments.affiliateId], references: [users.id] }),
  video: one(videos, { fields: [embedDeployments.videoId], references: [videos.id] }),
}));

export const commissionTransactionsRelations = relations(commissionTransactions, ({ one }) => ({
  affiliate: one(users, { fields: [commissionTransactions.affiliateId], references: [users.id] }),
  video: one(videos, { fields: [commissionTransactions.videoId], references: [videos.id] }),
  product: one(products, { fields: [commissionTransactions.productId], references: [products.id] }),
  analyticsEvent: one(analyticsEvents, { fields: [commissionTransactions.analyticsEventId], references: [analyticsEvents.id] }),
  campaignAffiliate: one(campaignAffiliates, { fields: [commissionTransactions.campaignAffiliateId], references: [campaignAffiliates.id] }),
}));

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, affiliateTrackingId: true, referralCode: true });
export const insertBrandSchema = createInsertSchema(brands).omit({ id: true });
export const insertProductSchema = createInsertSchema(products).omit({ id: true });
export const insertVideoSchema = createInsertSchema(videos).omit({ id: true, embedCode: true, utmCode: true, totalViews: true, totalClicks: true, totalRevenue: true, createdAt: true });
export const insertVideoBrandSchema = createInsertSchema(videoBrands).omit({ id: true });
export const insertVideoProductSchema = createInsertSchema(videoProducts).omit({ id: true });
export const insertBrandReferralSchema = createInsertSchema(brandReferrals).omit({ id: true, status: true, signupToken: true, createdAt: true });
export const insertAnalyticsEventSchema = createInsertSchema(analyticsEvents).omit({ id: true, createdAt: true });
export const insertAffiliatePayoutSchema = createInsertSchema(affiliatePayouts).omit({ id: true, createdAt: true });
export const insertCampaignSchema = createInsertSchema(campaigns).omit({ id: true, spentAmount: true, actualViews: true, actualClicks: true, actualConversions: true, actualRevenue: true, createdAt: true, updatedAt: true });
export const insertBrandKitSchema = createInsertSchema(brandKits).omit({ id: true, createdAt: true, updatedAt: true });
export const insertVideoCarouselOverrideSchema = createInsertSchema(videoCarouselOverrides).omit({ id: true, createdAt: true });
export const insertVideoDetectionJobSchema = createInsertSchema(videoDetectionJobs).omit({ id: true, status: true, totalFrames: true, processedFrames: true, error: true, startedAt: true, completedAt: true, createdAt: true });
export const insertVideoDetectionResultSchema = createInsertSchema(videoDetectionResults).omit({ id: true, createdAt: true });
export const insertVideoProductOverlaySchema = createInsertSchema(videoProductOverlays).omit({ id: true, createdAt: true });
export const insertCreatorInvitationSchema = createInsertSchema(creatorInvitations).omit({ id: true, status: true, invitedAt: true });
export const insertAffiliateInvitationSchema = createInsertSchema(affiliateInvitations).omit({ id: true, status: true, inviteToken: true, acceptedByUserId: true, createdAt: true });
export const insertCampaignAffiliateSchema = createInsertSchema(campaignAffiliates).omit({ id: true, utmCode: true, embedCode: true, totalClicks: true, totalConversions: true, totalRevenue: true, totalEarnings: true, notifiedAt: true, createdAt: true });
export const insertGlobalVideoLibrarySchema = createInsertSchema(globalVideoLibrary).omit({ id: true, publishStatus: true, stripePaymentIntentId: true, totalLicenses: true, listedAt: true, createdAt: true });
export const insertVideoLicensePurchaseSchema = createInsertSchema(videoLicensePurchases).omit({ id: true, status: true, stripePaymentIntentId: true, utmCode: true, embedCode: true, purchasedAt: true, createdAt: true });
export const insertVideoPublishRecordSchema = createInsertSchema(videoPublishRecords).omit({ id: true, embedCodeMinified: true, baseUtmCode: true, publishedAt: true, isActive: true });
export const insertUserProfileSchema = createInsertSchema(userProfiles).omit({ id: true, createdAt: true, updatedAt: true });
export const insertCreatorRewardSchema = createInsertSchema(creatorRewards).omit({ id: true, earnedAt: true, redeemedAt: true });
export const insertEmbedDeploymentSchema = createInsertSchema(embedDeployments).omit({ id: true, totalLoads: true, firstSeenAt: true, lastSeenAt: true });
export const insertCommissionTransactionSchema = createInsertSchema(commissionTransactions).omit({ id: true, status: true, createdAt: true });

// Types
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type InsertBrand = z.infer<typeof insertBrandSchema>;
export type Brand = typeof brands.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;
export type Product = typeof products.$inferSelect;
export type InsertVideo = z.infer<typeof insertVideoSchema>;
export type Video = typeof videos.$inferSelect;
export type InsertVideoBrand = z.infer<typeof insertVideoBrandSchema>;
export type VideoBrand = typeof videoBrands.$inferSelect;
export type InsertVideoProduct = z.infer<typeof insertVideoProductSchema>;
export type VideoProduct = typeof videoProducts.$inferSelect;
export type InsertBrandReferral = z.infer<typeof insertBrandReferralSchema>;
export type BrandReferral = typeof brandReferrals.$inferSelect;
export type InsertAnalyticsEvent = z.infer<typeof insertAnalyticsEventSchema>;
export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type InsertAffiliatePayout = z.infer<typeof insertAffiliatePayoutSchema>;
export type AffiliatePayout = typeof affiliatePayouts.$inferSelect;
export type InsertCampaign = z.infer<typeof insertCampaignSchema>;
export type Campaign = typeof campaigns.$inferSelect;
export type InsertBrandKit = z.infer<typeof insertBrandKitSchema>;
export type BrandKit = typeof brandKits.$inferSelect;
export type InsertVideoCarouselOverride = z.infer<typeof insertVideoCarouselOverrideSchema>;
export type VideoCarouselOverride = typeof videoCarouselOverrides.$inferSelect;
export type InsertVideoDetectionJob = z.infer<typeof insertVideoDetectionJobSchema>;
export type VideoDetectionJob = typeof videoDetectionJobs.$inferSelect;
export type InsertVideoDetectionResult = z.infer<typeof insertVideoDetectionResultSchema>;
export type VideoDetectionResult = typeof videoDetectionResults.$inferSelect;
export type InsertVideoProductOverlay = z.infer<typeof insertVideoProductOverlaySchema>;
export type VideoProductOverlay = typeof videoProductOverlays.$inferSelect;
export type InsertCreatorInvitation = z.infer<typeof insertCreatorInvitationSchema>;
export type CreatorInvitation = typeof creatorInvitations.$inferSelect;
export type InsertAffiliateInvitation = z.infer<typeof insertAffiliateInvitationSchema>;
export type AffiliateInvitation = typeof affiliateInvitations.$inferSelect;
export type InsertCampaignAffiliate = z.infer<typeof insertCampaignAffiliateSchema>;
export type CampaignAffiliate = typeof campaignAffiliates.$inferSelect;
export type InsertGlobalVideoLibrary = z.infer<typeof insertGlobalVideoLibrarySchema>;
export type GlobalVideoLibrary = typeof globalVideoLibrary.$inferSelect;
export type InsertVideoLicensePurchase = z.infer<typeof insertVideoLicensePurchaseSchema>;
export type VideoLicensePurchase = typeof videoLicensePurchases.$inferSelect;
export type InsertVideoPublishRecord = z.infer<typeof insertVideoPublishRecordSchema>;
export type VideoPublishRecord = typeof videoPublishRecords.$inferSelect;
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;
export type InsertCreatorReward = z.infer<typeof insertCreatorRewardSchema>;
export type CreatorReward = typeof creatorRewards.$inferSelect;
export type InsertEmbedDeployment = z.infer<typeof insertEmbedDeploymentSchema>;
export type EmbedDeployment = typeof embedDeployments.$inferSelect;
export type InsertCommissionTransaction = z.infer<typeof insertCommissionTransactionSchema>;
export type CommissionTransaction = typeof commissionTransactions.$inferSelect;

// Button label options for carousel
export const BUTTON_LABEL_OPTIONS = [
  "BUY NOW", "PRE ORDER", "RENT", "ENQUIRE", "APPLY NOW", "DONATE", "BOOK NOW", "BID NOW"
] as const;

// Carousel position options
export const CAROUSEL_POSITION_OPTIONS = [
  "bottom", "top", "left", "right", "bottom-left", "bottom-right", "top-left", "top-right"
] as const;

// Font options for carousel text
export const FONT_OPTIONS = [
  { value: "system", label: "System Default" },
  { value: "public-pixel", label: "Public Pixel" },
  { value: "inter", label: "Inter" },
  { value: "roboto", label: "Roboto" },
  { value: "poppins", label: "Poppins" },
  { value: "montserrat", label: "Montserrat" },
  { value: "playfair", label: "Playfair Display" },
  { value: "oswald", label: "Oswald" },
] as const;

// Video category options for taxonomy
export const VIDEO_CATEGORY_OPTIONS = [
  { value: "fashion", label: "Fashion" },
  { value: "travel", label: "Travel" },
  { value: "skincare", label: "Skincare" },
  { value: "cuisine_bev", label: "Cuisine & Beverage" },
  { value: "health", label: "Health" },
  { value: "eco", label: "Eco" },
  { value: "interiors", label: "Interiors" },
] as const;

// Brand outreach status
export const outreachStatusEnum = pgEnum("outreach_status", [
  "pending", "email_sent", "authorized", "agreement_sent", "completed", "declined"
]);

export const followUpTypeEnum = pgEnum("follow_up_type", [
  "docusign_reminder", "results_excitement", "global_pitch", "subscription_nudge"
]);

// Brand Outreach Requests — creator-initiated outreach to a brand PR contact
export const brandOutreachRequests = pgTable("brand_outreach_requests", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  creatorId: varchar("creator_id").notNull().references(() => users.id),
  videoId: varchar("video_id").references(() => videos.id),
  videoUrl: text("video_url"),
  videoTitle: text("video_title"),
  brandName: text("brand_name").notNull(),
  prContactName: text("pr_contact_name").notNull(),
  prContactEmail: text("pr_contact_email").notNull(),
  creatorMessage: text("creator_message"),
  authToken: text("auth_token").notNull().unique().default(sql`gen_random_uuid()`),
  status: outreachStatusEnum("status").default("pending"),
  authorizedAt: timestamp("authorized_at"),
  agreementStartedAt: timestamp("agreement_started_at"),
  agreementSignedAt: timestamp("agreement_signed_at"),
  brandSubscribedAt: timestamp("brand_subscribed_at"),
  followUpCount: integer("follow_up_count").default(0),
  lastFollowUpAt: timestamp("last_follow_up_at"),
  lastFollowUpType: followUpTypeEnum("last_follow_up_type"),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertBrandOutreachSchema = createInsertSchema(brandOutreachRequests).omit({
  id: true, authToken: true, status: true, authorizedAt: true, createdAt: true,
  agreementStartedAt: true, agreementSignedAt: true, brandSubscribedAt: true,
  followUpCount: true, lastFollowUpAt: true, lastFollowUpType: true, adminNotes: true,
});
export type InsertBrandOutreach = z.infer<typeof insertBrandOutreachSchema>;
export type BrandOutreach = typeof brandOutreachRequests.$inferSelect;

// Subscriber intake role enum
export const subscriberRoleEnum = pgEnum("subscriber_role", ["creator", "brand", "publisher"]);

// Subscriber Intake table for landing page signups
export const subscriberIntakes = pgTable("subscriber_intakes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  role: subscriberRoleEnum("role").notNull(),
  firstName: text("first_name").notNull(),
  surname: text("surname").notNull(),
  email: text("email").notNull(),
  instagramHandle: text("instagram_handle"),
  tiktokHandle: text("tiktok_handle"),
  country: text("country").notNull(),
  city: text("city").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertSubscriberIntakeSchema = createInsertSchema(subscriberIntakes).omit({ id: true, createdAt: true });
export type InsertSubscriberIntake = z.infer<typeof insertSubscriberIntakeSchema>;
export type SubscriberIntake = typeof subscriberIntakes.$inferSelect;

// Publisher Notifications — sent when a brand disables a publisher
export const publisherNotifications = pgTable("publisher_notifications", {
  id: serial("id").primaryKey(),
  affiliateId: varchar("affiliate_id").notNull().references(() => users.id),
  campaignAffiliateId: varchar("campaign_affiliate_id").references(() => campaignAffiliates.id),
  campaignName: text("campaign_name"),
  type: text("type").notNull().default("performance_warning"), // "performance_warning" | "deactivation"
  message: text("message"),
  isRead: boolean("is_read").default(false),
  actionTaken: text("action_taken"), // "extended_48h" | null
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});
export const insertPublisherNotificationSchema = createInsertSchema(publisherNotifications).omit({ id: true, createdAt: true });
export type InsertPublisherNotification = z.infer<typeof insertPublisherNotificationSchema>;
export type PublisherNotification = typeof publisherNotifications.$inferSelect;

// ─── Brand Billing & Account Tables ─────────────────────────────────────────

// Brand Subscriptions
export const brandSubscriptions = pgTable("brand_subscriptions", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  plan: text("plan").notNull().default("starter"),
  status: text("status").notNull().default("active"),
  subscribedAt: timestamp("subscribed_at").default(sql`CURRENT_TIMESTAMP`),
  currentPeriodEnd: timestamp("current_period_end"),
  stripeSubscriptionId: text("stripe_subscription_id"),
});
export const insertBrandSubscriptionSchema = createInsertSchema(brandSubscriptions).omit({ id: true });
export type InsertBrandSubscription = z.infer<typeof insertBrandSubscriptionSchema>;
export type BrandSubscription = typeof brandSubscriptions.$inferSelect;

// Brand Billing Records (invoices + transactions)
export const brandBillingRecords = pgTable("brand_billing_records", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  type: text("type").notNull(), // "invoice" | "payout" | "payment"
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  currency: text("currency").default("EUR"),
  status: text("status").notNull().default("pending"), // "paid" | "pending" | "failed"
  description: text("description"),
  reference: text("reference"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});
export const insertBrandBillingRecordSchema = createInsertSchema(brandBillingRecords).omit({ id: true, createdAt: true });
export type InsertBrandBillingRecord = z.infer<typeof insertBrandBillingRecordSchema>;
export type BrandBillingRecord = typeof brandBillingRecords.$inferSelect;

// Brand Payout Methods
export const brandPayoutMethods = pgTable("brand_payout_methods", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  type: text("type").notNull().default("bank_transfer"), // "bank_transfer" | "paypal" | "stripe"
  bankName: text("bank_name"),
  accountLast4: text("account_last4"),
  iban: text("iban"),
  bic: text("bic"),
  paypalEmail: text("paypal_email"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});
export const insertBrandPayoutMethodSchema = createInsertSchema(brandPayoutMethods).omit({ id: true, updatedAt: true });
export type InsertBrandPayoutMethod = z.infer<typeof insertBrandPayoutMethodSchema>;
export type BrandPayoutMethod = typeof brandPayoutMethods.$inferSelect;

// Brand Billing Profiles (address + business info)
export const brandBillingProfiles = pgTable("brand_billing_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id).unique(),
  companyName: text("company_name"),
  vatNumber: text("vat_number"),
  addressLine1: text("address_line1"),
  addressLine2: text("address_line2"),
  city: text("city"),
  state: text("state"),
  postalCode: text("postal_code"),
  country: text("country"),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});
export const insertBrandBillingProfileSchema = createInsertSchema(brandBillingProfiles).omit({ id: true, updatedAt: true });
export type InsertBrandBillingProfile = z.infer<typeof insertBrandBillingProfileSchema>;
export type BrandBillingProfile = typeof brandBillingProfiles.$inferSelect;

// Brand API Keys
export const brandApiKeys = pgTable("brand_api_keys", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  keyPrefix: text("key_prefix").notNull(),
  keyHash: text("key_hash").notNull(),
  isActive: boolean("is_active").default(true),
  lastUsedAt: timestamp("last_used_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});
export const insertBrandApiKeySchema = createInsertSchema(brandApiKeys).omit({ id: true, createdAt: true, lastUsedAt: true });
export type InsertBrandApiKey = z.infer<typeof insertBrandApiKeySchema>;
export type BrandApiKey = typeof brandApiKeys.$inferSelect;

// ─── Playlists ────────────────────────────────────────────────────────────────

export const playlistStatusEnum = pgEnum("playlist_status", ["draft", "pending_payment", "published"]);

// Playlists — curated video collections from the Global Video Library
export const playlists = pgTable("playlists", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  status: playlistStatusEnum("status").default("draft"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  licenseFeeTotal: decimal("license_fee_total", { precision: 10, scale: 2 }),
  embedCode: text("embed_code"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

// PlaylistItems — individual videos inside a playlist with UTM tracking
export const playlistItems = pgTable("playlist_items", {
  id: serial("id").primaryKey(),
  playlistId: integer("playlist_id").notNull().references(() => playlists.id),
  listingId: varchar("listing_id").notNull().references(() => globalVideoLibrary.id),
  utmSource: text("utm_source"),
  utmMedium: text("utm_medium"),
  utmCampaign: text("utm_campaign"),
  utmContent: text("utm_content"),
  utmCode: text("utm_code").default(sql`gen_random_uuid()`),
  addedAt: timestamp("added_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertPlaylistSchema = createInsertSchema(playlists).omit({ id: true, status: true, stripePaymentIntentId: true, licenseFeeTotal: true, embedCode: true, publishedAt: true, createdAt: true });
export const insertPlaylistItemSchema = createInsertSchema(playlistItems).omit({ id: true, utmCode: true, addedAt: true });

export type InsertPlaylist = z.infer<typeof insertPlaylistSchema>;
export type Playlist = typeof playlists.$inferSelect;
export type InsertPlaylistItem = z.infer<typeof insertPlaylistItemSchema>;
export type PlaylistItem = typeof playlistItems.$inferSelect;

// Wishlists — users save global library listings for later
export const wishlists = pgTable("wishlists", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  globalListingId: varchar("global_listing_id").notNull().references(() => globalVideoLibrary.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertWishlistSchema = createInsertSchema(wishlists).omit({ id: true, createdAt: true });
export type InsertWishlist = z.infer<typeof insertWishlistSchema>;
export type Wishlist = typeof wishlists.$inferSelect;

// ─── Store Connections (Shopify/WooCommerce) ─────────────────────────────────

export const storePlatformEnum = pgEnum("store_platform", ["shopify", "woocommerce", "manual"]);

export const storeConnections = pgTable("store_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  platform: storePlatformEnum("platform").notNull(),
  storeDomain: text("store_domain"),
  accessToken: text("access_token"),
  lastSyncAt: timestamp("last_sync_at"),
  productCount: integer("product_count").default(0),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertStoreConnectionSchema = createInsertSchema(storeConnections).omit({ id: true, lastSyncAt: true, productCount: true, createdAt: true });
export type InsertStoreConnection = z.infer<typeof insertStoreConnectionSchema>;
export type StoreConnection = typeof storeConnections.$inferSelect;

// ─────────────────────────────────────────────────────────────────────────────

// Country list for dropdown
export const COUNTRIES = [
  "Afghanistan", "Albania", "Algeria", "Andorra", "Angola", "Antigua and Barbuda", "Argentina", "Armenia", "Australia", "Austria",
  "Azerbaijan", "Bahamas", "Bahrain", "Bangladesh", "Barbados", "Belarus", "Belgium", "Belize", "Benin", "Bhutan",
  "Bolivia", "Bosnia and Herzegovina", "Botswana", "Brazil", "Brunei", "Bulgaria", "Burkina Faso", "Burundi", "Cabo Verde", "Cambodia",
  "Cameroon", "Canada", "Central African Republic", "Chad", "Chile", "China", "Colombia", "Comoros", "Congo", "Costa Rica",
  "Croatia", "Cuba", "Cyprus", "Czech Republic", "Denmark", "Djibouti", "Dominica", "Dominican Republic", "Ecuador", "Egypt",
  "El Salvador", "Equatorial Guinea", "Eritrea", "Estonia", "Eswatini", "Ethiopia", "Fiji", "Finland", "France", "Gabon",
  "Gambia", "Georgia", "Germany", "Ghana", "Greece", "Grenada", "Guatemala", "Guinea", "Guinea-Bissau", "Guyana",
  "Haiti", "Honduras", "Hungary", "Iceland", "India", "Indonesia", "Iran", "Iraq", "Ireland", "Israel",
  "Italy", "Jamaica", "Japan", "Jordan", "Kazakhstan", "Kenya", "Kiribati", "Kuwait", "Kyrgyzstan", "Laos",
  "Latvia", "Lebanon", "Lesotho", "Liberia", "Libya", "Liechtenstein", "Lithuania", "Luxembourg", "Madagascar", "Malawi",
  "Malaysia", "Maldives", "Mali", "Malta", "Marshall Islands", "Mauritania", "Mauritius", "Mexico", "Micronesia", "Moldova",
  "Monaco", "Mongolia", "Montenegro", "Morocco", "Mozambique", "Myanmar", "Namibia", "Nauru", "Nepal", "Netherlands",
  "New Zealand", "Nicaragua", "Niger", "Nigeria", "North Korea", "North Macedonia", "Norway", "Oman", "Pakistan", "Palau",
  "Palestine", "Panama", "Papua New Guinea", "Paraguay", "Peru", "Philippines", "Poland", "Portugal", "Qatar", "Romania",
  "Russia", "Rwanda", "Saint Kitts and Nevis", "Saint Lucia", "Saint Vincent and the Grenadines", "Samoa", "San Marino", "Sao Tome and Principe", "Saudi Arabia", "Senegal",
  "Serbia", "Seychelles", "Sierra Leone", "Singapore", "Slovakia", "Slovenia", "Solomon Islands", "Somalia", "South Africa", "South Korea",
  "South Sudan", "Spain", "Sri Lanka", "Sudan", "Suriname", "Sweden", "Switzerland", "Syria", "Taiwan", "Tajikistan",
  "Tanzania", "Thailand", "Timor-Leste", "Togo", "Tonga", "Trinidad and Tobago", "Tunisia", "Turkey", "Turkmenistan", "Tuvalu",
  "Uganda", "Ukraine", "United Arab Emirates", "United Kingdom", "United States", "Uruguay", "Uzbekistan", "Vanuatu", "Vatican City", "Venezuela",
  "Vietnam", "Yemen", "Zambia", "Zimbabwe"
] as const;
