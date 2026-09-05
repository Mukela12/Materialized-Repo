import { sql, relations } from "drizzle-orm";
import { pgTable, text, varchar, integer, decimal, numeric, serial, timestamp, boolean, pgEnum, uniqueIndex, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { LICENSE_FEE_DECIMAL } from "./pricing";

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
  "pending", "approved", "paid", "rejected", "reversed"
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
  commissionRateOverride: decimal("commission_rate_override", { precision: 5, scale: 2 }),
  charityContribution: decimal("charity_contribution", { precision: 5, scale: 2 }).default("0.00"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  stripeConnectOnboarded: boolean("stripe_connect_onboarded").default(false),
  /**
   * Can this account ACCEPT card payments, as opposed to merely receiving
   * payouts? Connect accounts here were created for payouts and request only
   * the `transfers` capability; selling through a brand's account additionally
   * needs `card_payments`, which Stripe verifies separately. Kept apart from
   * stripeConnectOnboarded so a brand cannot look ready to sell while Stripe
   * would reject the charge.
   */
  stripeConnectChargesEnabled: boolean("stripe_connect_charges_enabled").notNull().default(false),
  isAdmin: boolean("is_admin").default(false),
  freeAccess: boolean("free_access").default(false),
  /**
   * When free access lapses. NULL = never, which is what a manual comp from the
   * admin Users tab means. Set from the voucher's expiry at redemption, so a
   * festival account converts to a paid subscription on the date the client
   * chose rather than being free for good.
   */
  freeAccessUntil: timestamp("free_access_until"),
  /**
   * The one-time admin setup fee. Creators never owe it; Brands and Publishers
   * always do, whether they arrive by subscription checkout (where it is a line
   * item) or by voucher (where it is charged on its own).
   */
  setupFeePaid: boolean("setup_fee_paid").notNull().default(false),
  setupFeePaidAt: timestamp("setup_fee_paid_at"),
  /**
   * Free access requires a card. Stamped at voucher redemption — the client's
   * rule is that overage accountability is "the single requirement of having
   * free access" — so it binds voucher signups only, never existing accounts
   * or manual comps.
   */
  overageCardRequired: boolean("overage_card_required").notNull().default(false),
  /** A default payment method exists on the Stripe customer. Set by webhook. */
  cardOnFile: boolean("card_on_file").notNull().default(false),
  cardOnFileAt: timestamp("card_on_file_at"),
  emailVerified: boolean("email_verified").default(false),
  emailVerificationToken: text("email_verification_token"),
  emailVerificationExpires: timestamp("email_verification_expires"),
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpires: timestamp("password_reset_expires"),
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

  // ── Admin-granted inventory access ──────────────────────────────────────────
  // The client's rule is that a brand's inventory becomes discoverable once the
  // brand accepts and pays the $29 admin fee — WITHOUT a full subscription. The
  // self-serve version of that (emailed accept link, store connect, hosted
  // checkout) was built and then cut: review showed a creator could name an
  // unclaimed brand in a free-text invite, receive the token themselves, and take
  // ownership of a real catalogue. See stash "self-serve brand acceptance".
  //
  // This is the safe form of the same outcome: an admin verifies the brand and
  // settles the $29 out of band, then grants a window here. No untrusted party
  // can reach it.
  //
  // Expiry is evaluated at READ time (`> now()`), so the window self-expires.
  // There is no scheduler in this codebase and this deliberately does not need one.
  inventoryAccessUntil: timestamp("inventory_access_until"),
  inventoryAccessGrantedBy: varchar("inventory_access_granted_by").references(() => users.id),
  inventoryAccessNote: text("inventory_access_note"),
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
}, (t) => ({
  /**
   * "Which videos belong to this creator" is on the path of every creator
   * dashboard, the trial gate, and now the billing aggregate — and it was a
   * sequential scan, because Postgres does not index foreign keys automatically.
   */
  creatorIdx: index("videos_creator_id_idx").on(t.creatorId),
}));

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

  /**
   * The creator who owns the video, denormalized at write time.
   *
   * Billing asks "how much usage did THIS creator have between these dates",
   * and without this every such query joins through videos and inlines the
   * creator's whole video-id list into an IN (...) predicate. Denormalizing
   * makes it a single indexed range scan.
   *
   * Safe to denormalize because a video's owner never changes: creatorId is set
   * once at insert and no route updates it. It is also a point-in-time record —
   * usage should stay attributed to whoever owned the video when it happened.
   */
  creatorId: varchar("creator_id").references(() => users.id),

  /**
   * Opaque per-viewer-per-day identity, used ONLY to deduplicate billable views.
   *
   * A salted HMAC of IP + user-agent + the UTC date (see server/viewerIdentity.ts).
   * Because the date is inside the hash it rotates every midnight UTC, so the
   * partial unique index below yields exactly one billable view per viewer, per
   * video, per day without needing a separate day column or any scheduled job.
   *
   * Deliberately NOT reversible and NOT stored alongside the raw IP: it is a
   * dedup key, not a tracking identifier, and it stops being linkable to a
   * person after 24 hours.
   *
   * NULL on rows written before this existed, and on any event we cannot
   * identify — the partial index ignores NULLs, so those never block a write.
   */
  viewerHash: text("viewer_hash"),

  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  /**
   * The billing aggregate: one creator, one event type, a date range.
   * This table had NO index beyond its primary key, so every stat query was a
   * sequential scan.
   */
  creatorPeriodIdx: index("analytics_events_creator_period_idx")
    .on(t.creatorId, t.eventType, t.createdAt),

  /** Per-video dashboards and the video detail page. */
  videoCreatedIdx: index("analytics_events_video_created_idx")
    .on(t.videoId, t.createdAt),

  /**
   * One billable view per viewer, per video, per day — enforced by the DATABASE
   * rather than by application logic, so a race between two concurrent requests
   * cannot produce two rows. The ingest route catches the violation and returns
   * success, because a repeat view is a normal thing for a viewer to do, not an
   * error.
   *
   * Partial on purpose: clicks and purchases must never be deduplicated (a
   * viewer may legitimately click several products), and NULL viewer_hash rows
   * are exempt so historical data and unidentifiable requests still record.
   */
  billableViewUniq: uniqueIndex("analytics_events_billable_view_uniq")
    .on(t.videoId, t.viewerHash)
    .where(sql`${t.eventType} = 'view' AND ${t.viewerHash} IS NOT NULL`),
}));

// Affiliate payouts
export const affiliatePayouts = pgTable("affiliate_payouts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  amount: decimal("amount", { precision: 10, scale: 2 }).notNull(),
  status: text("status").default("pending"), // pending | processing | paid | failed
  stripeTransferId: text("stripe_transfer_id"),
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

  // ── The rest of the client's styling list (0022) ──────────────────────────
  // The carousel's own panel colour. It was hard-coded black at whatever
  // opacity was set, so a brand could colour the button and nothing else.
  defaultCarouselBackgroundColor: text("default_carousel_background_color"),
  // Two separate radii. One value drove both the panel and the button, so a
  // square panel forced square buttons and a pill button forced a pill panel.
  defaultButtonCornerRadius: integer("default_button_corner_radius"),
  // Text colours. Both were inherited from the theme, which is white — legible
  // on a dark panel and invisible on a pale one.
  defaultBrandTitleColor: text("default_brand_title_color"),
  defaultProductTitleColor: text("default_product_title_color"),
  // Hover state and button opacity, both requested explicitly.
  defaultButtonHoverColor: text("default_button_hover_color"),
  defaultButtonOpacity: integer("default_button_opacity"),
  /**
   * Whether the carousel sells during playback.
   *
   * Disabled, the viewer is shown a product list at the end of the video
   * instead of an overlay during it. Nullable so an existing row keeps
   * behaving as it did rather than being silently switched by a default.
   */
  defaultCommerceEnabled: boolean("default_commerce_enabled"),

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

  // Mirrors of the brand-kit defaults above. NULL means "inherit" — the client
  // asked to change colours per video for a season or a collection without
  // disturbing the defaults every other video uses.
  carouselBackgroundColor: text("carousel_background_color"),
  buttonCornerRadius: integer("button_corner_radius"),
  brandTitleColor: text("brand_title_color"),
  productTitleColor: text("product_title_color"),
  buttonHoverColor: text("button_hover_color"),
  buttonOpacity: integer("button_opacity"),
  commerceEnabled: boolean("commerce_enabled"),

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
  /** Display label as typed — "$49", "from £20". NEVER charge from this. */
  price: text("price"),
  /**
   * The authoritative amount, and the only thing in-video checkout reads.
   * A price is a number or it is not chargeable; free text is a label.
   */
  priceCents: integer("price_cents"),
  currency: text("currency"),
  brandName: text("brand_name"),
  /**
   * This product's own call to action. NULL uses the video-wide setting, so an
   * existing overlay behaves exactly as before until someone overrides it.
   */
  buttonLabel: text("button_label"),
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
  licenseFee: decimal("license_fee", { precision: 10, scale: 2 }).notNull().default(LICENSE_FEE_DECIMAL),
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
  /**
   * The creator's Instagram handle (0026).
   *
   * The client asked the brand-outreach email to say "by [Creator_Instagram_
   * Handle]" rather than a display name. A brand's PR contact recognises a
   * handle they can look up; a display name means nothing to them. Stored
   * without the "@", which is added when it is shown.
   */
  instagramHandle: text("instagram_handle"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});

// Creator Rewards — SUPERSEDED by `tokenLedger` below. RETIRED, READ-ONLY.
//
// This table models an earlier "45 credits ≈ $45" scheme that was never wired up:
// nothing has ever written a row (createCreatorReward had zero callers and has been
// removed), so the table is provably empty. It is left in place because the migration
// runner is additive-only (see server/migrate.ts) — NOT because it is still live.
// Do not add writers. One credit system only: use tokenLedger.
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

// ─── Token Wallet ────────────────────────────────────────────────────────────
//
// APPEND-ONLY ledger of wallet tokens. 1 token = $49 of PREPAID PLATFORM CREDIT.
// TOKENS ARE NEVER CASHABLE — see the module doc on server/wallet.ts.
//
// There is deliberately NO `users.token_balance` column. A mutable counter is a
// read-modify-write and loses updates under concurrency; the balance is always
// SUM(delta_tokens) over this table. If you are about to add a balance column as
// a "cache", you are about to reintroduce the bug this design exists to prevent.

export const tokenLedgerReasonEnum = pgEnum("token_ledger_reason", [
  // ── credits (delta_tokens > 0) ──
  "brand_conversion",         // minted when a tagged brand pays for a qualifying subscription
  "admin_grant",              // manual grant / attribution correction (positive leg)
  "spend_refund",             // compensating reversal of a spend that failed downstream
  // ── debits (delta_tokens < 0) ──
  "spend_library_listing",    // import/list one video into the Global Video Library
  "spend_playlist",           // curate a playlist — one token PER VIDEO
  "spend_subscription_credit",// applied as a NEGATIVE Stripe customer balance txn
  "admin_revoke",             // manual clawback / attribution correction (negative leg)
]);

export const tokenLedger = pgTable("token_ledger", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Whose wallet this row belongs to.
  userId: varchar("user_id").notNull().references(() => users.id),

  // SIGNED movement: +N earned, -N spent. Never UPDATEd, never DELETEd.
  // Balance = SUM(delta_tokens). A zero row would be a no-op event, so it is rejected.
  deltaTokens: integer("delta_tokens").notNull(),

  reason: tokenLedgerReasonEnum("reason").notNull(),

  // INVARIANT 5 — USD value of ONE token, captured at the moment this row was
  // written (4900 today). The row's total USD value is ABS(delta_tokens) * this.
  // Repricing tokens later changes new rows only; history is never rewritten.
  usdValueCents: integer("usd_value_cents").notNull(),

  // ── mint provenance (brand_conversion only; NULL on every other row) ──
  sourceBrandId: varchar("source_brand_id").references(() => brands.id),
  sourceSubscriptionUserId: varchar("source_subscription_user_id").references(() => users.id),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // 'brand_referral' | 'first_touch_tag' | 'admin_override' — see resolveBrandConversionAttribution().
  attributionMethod: text("attribution_method"),
  attributedVideoId: varchar("attributed_video_id").references(() => videos.id),
  brandReferralId: varchar("brand_referral_id").references(() => brandReferrals.id),

  // ── spend provenance ──
  // spendRefType: 'global_video_listing' | 'playlist' | 'stripe_customer_balance'.
  // (spendRefType, spendRefId) is UNIQUE, which is what makes a retried spend a no-op
  // instead of a second debit.
  spendRefType: text("spend_ref_type"),
  spendRefId: text("spend_ref_id"),
  // Set once, after the fact, by attachStripeBalanceTxn() — the ONLY permitted UPDATE
  // on this table, and one that provably cannot change a balance (it never touches
  // delta_tokens and only fires when the column is still NULL).
  stripeBalanceTxnId: text("stripe_balance_txn_id"),

  description: text("description"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  // INVARIANT 3 — at most ONE token is ever minted for a given brand, enforced by the
  // DATABASE, not by application logic. This is what makes the many-to-many tagging
  // safe: five creators tagging one brand still yields exactly one token, because the
  // index is keyed on source_brand_id ALONE. Keying it on (brand, creator) would permit
  // one row per creator — 5 × $49 = $245 of credit against a single $249 subscription.
  //
  // Deliberately NOT scoped by stripe_subscription_id: the spec says the brand's FIRST
  // qualifying subscription, so cancel-and-resubscribe must not mint again.
  brandConversionUniq: uniqueIndex("token_ledger_brand_conversion_uniq")
    .on(t.sourceBrandId)
    .where(sql`${t.reason} = 'brand_conversion' AND ${t.sourceBrandId} IS NOT NULL`),

  // Same invariant from the other direction. brands.owner_id is NOT unique, so one
  // subscriber can own three brands; without this, a resolver bug could mint 3 × $49
  // against one $249 subscription. At most one mint per subscribing account, ever.
  subscriberConversionUniq: uniqueIndex("token_ledger_subscriber_conversion_uniq")
    .on(t.sourceSubscriptionUserId)
    .where(sql`${t.reason} = 'brand_conversion' AND ${t.sourceSubscriptionUserId} IS NOT NULL`),

  // INVARIANT 4 (idempotency half) — one debit per thing bought. A retried client
  // request for the same listing/playlist trips this and is reported as a duplicate
  // rather than debiting twice.
  spendRefUniq: uniqueIndex("token_ledger_spend_ref_uniq")
    .on(t.spendRefType, t.spendRefId)
    .where(sql`${t.spendRefId} IS NOT NULL`),

  // A Stripe balance transaction may back at most one ledger row.
  stripeBalanceTxnUniq: uniqueIndex("token_ledger_stripe_balance_txn_uniq")
    .on(t.stripeBalanceTxnId)
    .where(sql`${t.stripeBalanceTxnId} IS NOT NULL`),

  // Balance is SUM over one user's rows — the hot path deserves an index.
  byUser: index("token_ledger_user_idx").on(t.userId),
}));

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
  payoutId: varchar("payout_id").references(() => affiliatePayouts.id),
  externalOrderId: text("external_order_id"),
  // Store the order belongs to. Store order ids are only unique WITHIN a store, so refunds
  // and dedup must be scoped by (external_order_id, store_connection_id) to avoid a cross-store
  // order-id collision. Nullable + backward-compatible: legacy rows (internal /api/sales, or
  // pre-migration store rows) carry NULL here and keep working with the 1-arg lookups.
  storeConnectionId: varchar("store_connection_id").references(() => storeConnections.id),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  // Prevent concurrent duplicate commissions for the same store order. A single sale
  // writes at most TWO rows (creator + publisher), which always have distinct
  // affiliate_ids. Order ids collide across stores, so the index is scoped by
  // store_connection_id too: (external_order_id, affiliate_id, store_connection_id). The
  // partial predicate leaves the internal /api/sales path (externalOrderId NULL) unconstrained.
  extOrderAffiliateUniq: uniqueIndex("commission_tx_ext_order_affiliate_store_uniq")
    .on(t.externalOrderId, t.affiliateId, t.storeConnectionId)
    .where(sql`${t.externalOrderId} IS NOT NULL`),
}));

/**
 * The creator's 5% share of a subscription they brought in.
 *
 * ── Why its own table, and not commission_transactions ───────────────────────
 * A commission row is sale-shaped: it REQUIRES a videoId and hangs off a
 * product, an analytics event and a store order. A subscription payment has
 * none of those. Forcing one in would mean a fake videoId on a money row and
 * would corrupt every sales report that counts commission rows as sales.
 *
 * It is still paid by the SAME engine — approved rows, batched per creator,
 * transferred over Connect — because a second payout path is a second place for
 * money to go wrong unattended.
 *
 * ── The unique index IS the idempotency ──────────────────────────────────────
 * Stripe delivers invoice.payment_succeeded more than once: on retry after a
 * timeout, and again on a manual replay from the dashboard. A code-level "have
 * I seen this?" check loses that race under concurrent delivery. The database
 * decides instead, on (stripe_invoice_id, creator_id) — the second insert
 * violates and is caught as "already recorded".
 */
export const creatorBonuses = pgTable("creator_bonuses", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Who earns it — the creator who first tagged the brand. */
  creatorId: varchar("creator_id").notNull().references(() => users.id),
  /** The brand whose subscription generated it. */
  brandId: varchar("brand_id").notNull().references(() => brands.id),
  /** The account that was actually charged. */
  subscriberUserId: varchar("subscriber_user_id").notNull().references(() => users.id),

  stripeInvoiceId: text("stripe_invoice_id").notNull(),
  stripeSubscriptionId: text("stripe_subscription_id"),

  /** What was actually paid, in cents — Stripe's own amount_paid, not a list price. */
  basisCents: integer("basis_cents").notNull(),
  ratePct: decimal("rate_pct", { precision: 5, scale: 2 }).notNull(),
  /** The payable amount. Stored in cents; a transfer is made in cents. */
  amountCents: integer("amount_cents").notNull(),

  status: commissionStatusEnum("status").default("approved"),
  payoutId: varchar("payout_id").references(() => affiliatePayouts.id),

  /** Kept so an attribution can be explained, and audited, months later. */
  attributedVideoId: varchar("attributed_video_id").references(() => videos.id),
  attributionMethod: text("attribution_method"),

  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  invoiceCreatorUniq: uniqueIndex("creator_bonus_invoice_creator_uniq")
    .on(t.stripeInvoiceId, t.creatorId),
  creatorStatusIdx: index("creator_bonus_creator_status_idx").on(t.creatorId, t.status),
}));

export type CreatorBonus = typeof creatorBonuses.$inferSelect;
export type InsertCreatorBonus = typeof creatorBonuses.$inferInsert;

/**
 * A typeface a brand uploaded, rather than one of the twelve built in.
 *
 * The client: "Font upload must allow for the .otf or .ttf". Most fashion
 * brands licence their own face and had no way to use it — a font was either a
 * built-in or a name typed in and looked up on Google Fonts, which silently
 * fell back to system-ui when the name was not published there.
 *
 * `id` IS THE CSS FAMILY NAME, as `custom:<id>`. The label a person typed never
 * reaches a stylesheet: `font-family:'X'` closes on an apostrophe like any
 * other CSS string, and this rule is served inside a brand's own page.
 */
export const brandFonts = pgTable("brand_fonts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  /** What the person calls it. Shown in the app; never interpolated into CSS. */
  label: text("label").notNull(),
  /** Where the file lives. Must be https — see fontFaceRule. */
  fileUrl: text("file_url").notNull(),
  /** Decided by sniffing the bytes, never by the extension or Content-Type. */
  format: text("format").notNull(),
  sizeBytes: integer("size_bytes"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  userIdx: index("brand_fonts_user_idx").on(t.userId),
}));

export type BrandFont = typeof brandFonts.$inferSelect;
export type InsertBrandFont = typeof brandFonts.$inferInsert;

// Admin-editable platform fee/commission defaults (single "singleton" row).
// Null columns fall back to the env/code defaults (15 / 8 / 2).
/**
 * What each plan includes before overage, and what extras cost.
 *
 * NULL on an allowance means that meter is unlimited. billing_enabled false
 * means overage is recorded but never billed — the first month runs as a dry
 * run the client reviews before any card is touched.
 */
export const planAllowances = pgTable("plan_allowances", {
  plan: text("plan").primaryKey(),
  includedVideos: integer("included_videos"),
  includedViews: integer("included_views"),
  overagePerVideoCents: integer("overage_per_video_cents"),
  overagePer1000ViewsCents: integer("overage_per_1000_views_cents"),
  billingEnabled: boolean("billing_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
export type PlanAllowance = typeof planAllowances.$inferSelect;

/** One subscriber's overage for one billing month. (user, period_start) is the idempotency claim. */
export const overageCharges = pgTable("overage_charges", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  plan: text("plan").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  videosUsed: integer("videos_used").notNull(),
  viewsUsed: integer("views_used").notNull(),
  includedVideos: integer("included_videos"),
  includedViews: integer("included_views"),
  videoOverageCents: integer("video_overage_cents").notNull().default(0),
  viewOverageCents: integer("view_overage_cents").notNull().default(0),
  totalCents: integer("total_cents").notNull(),
  currency: text("currency").notNull(),
  status: text("status").notNull().default("recorded"),
  stripeInvoiceItemId: text("stripe_invoice_item_id"),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (t) => ({
  overageOncePerPeriod: uniqueIndex("overage_once_per_period_idx").on(t.userId, t.periodStart),
}));
export type OverageCharge = typeof overageCharges.$inferSelect;

export const platformSettings = pgTable("platform_settings", {
  id: varchar("id").primaryKey().default("singleton"),
  marketplaceFeePct: decimal("marketplace_fee_pct", { precision: 5, scale: 2 }),
  creatorPct: decimal("creator_pct", { precision: 5, scale: 2 }),
  publisherPct: decimal("publisher_pct", { precision: 5, scale: 2 }),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`),
});
export type PlatformSettings = typeof platformSettings.$inferSelect;
export type InsertPlatformSettings = typeof platformSettings.$inferInsert;

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

export const tokenLedgerRelations = relations(tokenLedger, ({ one }) => ({
  user: one(users, { fields: [tokenLedger.userId], references: [users.id] }),
  sourceBrand: one(brands, { fields: [tokenLedger.sourceBrandId], references: [brands.id] }),
  attributedVideo: one(videos, { fields: [tokenLedger.attributedVideoId], references: [videos.id] }),
  brandReferral: one(brandReferrals, { fields: [tokenLedger.brandReferralId], references: [brandReferrals.id] }),
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
// Ledger rows are written only by server/wallet.ts, which supplies every field
// explicitly. `id` and `createdAt` are DB-generated.
export const insertTokenLedgerSchema = createInsertSchema(tokenLedger).omit({ id: true, createdAt: true });

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
export type InsertTokenLedgerEntry = z.infer<typeof insertTokenLedgerSchema>;
export type TokenLedgerEntry = typeof tokenLedger.$inferSelect;
export type TokenLedgerReason = TokenLedgerEntry["reason"];

// Button label options for carousel
export const BUTTON_LABEL_OPTIONS = [
  "BUY NOW", "PRE ORDER", "RENT", "ENQUIRE", "APPLY NOW", "DONATE", "BOOK NOW", "BID NOW"
] as const;

// Carousel position options
export const CAROUSEL_POSITION_OPTIONS = [
  "bottom", "top", "left", "right", "bottom-left", "bottom-right", "top-left", "top-right"
] as const;

/**
 * Fonts offered for carousel text.
 *
 * EVERY ENTRY HERE MUST ACTUALLY RENDER — either declared as a local @font-face
 * in client/src/index.css, or present in the Google Fonts link in
 * client/index.html. Two previous entries were not:
 *
 *   "Public Pixel" existed nowhere in the project at all.
 *   "Oswald" was offered but missing from the Google Fonts request.
 *
 * Both silently fell back to system-ui, so the setting saved and changed
 * nothing, which is indistinguishable from a broken feature. Adding a name here
 * without loading the font reintroduces exactly that.
 *
 * The client mirror with CSS stacks is client/src/lib/fonts.ts.
 */
export const FONT_OPTIONS = [
  { value: "system", label: "System Default" },
  { value: "aileron", label: "Aileron" },
  { value: "lekton", label: "Lekton" },
  { value: "inter", label: "Inter" },
  { value: "roboto", label: "Roboto" },
  { value: "poppins", label: "Poppins" },
  { value: "montserrat", label: "Montserrat" },
  { value: "playfair", label: "Playfair Display" },
  { value: "dm-sans", label: "DM Sans" },
  { value: "outfit", label: "Outfit" },
  { value: "lora", label: "Lora" },
  { value: "space-grotesk", label: "Space Grotesk" },
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
  docusignEnvelopeId: text("docusign_envelope_id"),
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
  docusignEnvelopeId: true,
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
  currency: text("currency").default("USD"),
  status: text("status").notNull().default("pending"), // "paid" | "pending" | "failed"
  description: text("description"),
  reference: text("reference"),
  stripeInvoiceId: text("stripe_invoice_id"), // Stripe invoice id, used to resolve the hosted invoice URL on demand
  hostedInvoiceUrl: text("hosted_invoice_url"), // cached Stripe hosted invoice URL (may expire; falls back to stripeInvoiceId)
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

  // ── The frame the videos are viewed in (0023) ─────────────────────────────
  // The client: "Playlist Styling refers to the box in which one or several
  // videos are viewed in." None of this existed; the embed drew a fixed black
  // rounded rectangle. All nullable, so an already-published playlist keeps
  // exactly the look it has until someone changes it.
  frameShow: boolean("frame_show"),
  frameBorderWidth: integer("frame_border_width"),   // 0-5pt, her range
  frameBorderColor: text("frame_border_color"),
  frameCornerRadius: integer("frame_corner_radius"),

  /** Automatic playback, or wait for the viewer to press play. */
  playAutoplay: boolean("play_autoplay"),
  playButtonColor: text("play_button_color"),
  playButtonSize: integer("play_button_size"),
  playButtonOpacity: integer("play_button_opacity"),

  audioShow: boolean("audio_show"),
  audioIconColor: text("audio_icon_color"),
  audioIconSize: integer("audio_icon_size"),
  audioIconOpacity: integer("audio_icon_opacity"),

  /** A publisher's own mark over the frame. Watermark variants are semi-opaque. */
  logoUrl: text("logo_url"),
  logoPosition: text("logo_position"),

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
  webhookSecret: text("webhook_secret"),
  lastSyncAt: timestamp("last_sync_at"),
  productCount: integer("product_count").default(0),
  isActive: boolean("is_active").default(true),
  /**
   * Set when a store is reconnected, superseding this row. Partial-unique index
   * (user, platform, domain) WHERE deactivated_at IS NULL allows at most one
   * live connection — reconnecting used to mint a second one with its own live
   * webhook, and both fired on every order, billing the brand twice. Superseded
   * rows are kept, not deleted: they still own their historic accruals.
   */
  deactivatedAt: timestamp("deactivated_at"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`),
});

export const insertStoreConnectionSchema = createInsertSchema(storeConnections).omit({ id: true, lastSyncAt: true, productCount: true, createdAt: true });
export type InsertStoreConnection = z.infer<typeof insertStoreConnectionSchema>;
export type StoreConnection = typeof storeConnections.$inferSelect;

// ─── Platform fee accruals ───────────────────────────────────────────────────
//
// WHAT THE PLATFORM IS OWED. The mirror image of commission_transactions, which
// records money going OUT to creators and publishers; this records money coming
// IN from brands.
//
// It exists because the 15% marketplace fee was computed on every verified store
// order and then discarded — returned from computeSaleSplit(), echoed in the
// webhook response, and never written anywhere. There was no row in any table to
// invoice a brand from.
//
// THIS IS AN ACCOUNTS-RECEIVABLE LEDGER, NOT A PAYMENT PATH. A Stripe
// application fee only exists on a charge the PLATFORM creates. Brand sales
// happen on the brand's own store and own Stripe account, with Materialized
// nowhere in the payment path, so there is nothing for Stripe to skim. Recording
// what is owed and invoicing it is the honest mechanism. Do not add code here
// that implies the money collects itself.
//
// Every verified order gets a row, including ones that could not be attributed —
// see the migration header (0013) for why that matters.
export const feeAccrualStatusEnum = pgEnum("fee_accrual_status", [
  "accrued", "invoiced", "paid", "void",
]);

export const feeAttributionStateEnum = pgEnum("fee_attribution_state", [
  // A Materialized link drove the sale and resolved cleanly. Only these carry a fee.
  "attributed",
  // No Materialized ref on the order — not our sale, recorded for completeness.
  "no_ref",
  // A ref WAS present but did not resolve. Revenue that should have been earned;
  // these are the rows to investigate.
  "ref_unresolved",
  // Ref resolved but its video is gone. Same category of leak.
  "video_missing",
]);

export const platformFeeAccruals = pgTable("platform_fee_accruals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /**
   * NULL for an in-video sale, which has no store connection — the sale happened
   * in our own player. Was NOT NULL, and the in-video handler passed a video id
   * to satisfy it, which is a foreign-key violation on every such sale. See
   * migrations/0017.
   */
  storeConnectionId: varchar("store_connection_id").references(() => storeConnections.id),
  // Denormalised from the connection so an invoice survives the connection being
  // deleted or re-pointed at another store.
  brandUserId: varchar("brand_user_id").notNull().references(() => users.id),
  externalOrderId: text("external_order_id").notNull(),
  videoId: varchar("video_id").references(() => videos.id),
  currency: text("currency").notNull(),
  saleCents: integer("sale_cents").notNull(),
  marketplaceFeeCents: integer("marketplace_fee_cents").notNull().default(0),
  creatorCents: integer("creator_cents").notNull().default(0),
  publisherCents: integer("publisher_cents").notNull().default(0),
  /** The invoiceable margin: fee less the commissions paid out of it. */
  platformCents: integer("platform_cents").notNull().default(0),
  /**
   * The rate captured at the time of the sale, never looked up at invoice time.
   * Changing the platform default must not rewrite what a brand already owes —
   * same principle as commission_transactions.commission_rate.
   */
  marketplaceFeePct: decimal("marketplace_fee_pct", { precision: 5, scale: 2 }).notNull().default("0"),
  attributionState: feeAttributionStateEnum("attribution_state").notNull(),
  status: feeAccrualStatusEnum("status").notNull().default("accrued"),
  stripeInvoiceId: text("stripe_invoice_id"),
  invoicedAt: timestamp("invoiced_at"),
  /** Set on refund. Voided rows are never invoiced; already-invoiced ones need crediting. */
  voidedAt: timestamp("voided_at"),
  occurredAt: timestamp("occurred_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  /**
   * The invoice run that claimed this row. Null while unbilled, and set back to
   * null if a failed run releases it. Declared after the fee_invoices table in
   * SQL (migration 0014) but referenced by name here to avoid a circular
   * reference between the two pgTable definitions.
   */
  feeInvoiceId: varchar("fee_invoice_id"),
});

export const insertPlatformFeeAccrualSchema = createInsertSchema(platformFeeAccruals).omit({
  id: true, status: true, stripeInvoiceId: true, invoicedAt: true, voidedAt: true, createdAt: true,
  // Set only by an invoice run, never by the webhook that creates the accrual.
  feeInvoiceId: true,
});
export type InsertPlatformFeeAccrual = z.infer<typeof insertPlatformFeeAccrualSchema>;
export type PlatformFeeAccrual = typeof platformFeeAccruals.$inferSelect;

// ─── Fee invoices ────────────────────────────────────────────────────────────
//
// An invoice raised against the accruals above.
//
// Invoicing writes to two systems — the accruals here and an invoice at Stripe —
// and a crash between them leaves the two disagreeing. The rows are therefore
// CLAIMED first, into a row of this table, inside one transaction under an
// advisory lock on the brand. That ordering is chosen deliberately: claiming
// first can only ever under-bill (visible, recoverable), whereas calling Stripe
// first can bill a customer TWICE. See migrations/0014 and server/feeInvoicing.ts.
//
// This row is also the resume point. Its id is the Stripe idempotency key, so a
// retry of a half-finished run returns the same invoice instead of a second one.
export const feeInvoiceStatusEnum = pgEnum("fee_invoice_status", [
  /** Accruals claimed, Stripe not yet confirmed. Resumable. */
  "pending",
  /** The Stripe invoice exists. */
  "created",
  /** Gave up. The claimed accruals have been released back to 'accrued'. */
  "failed",
  /** Cancelled. Accruals released so they can be billed on a later run. */
  "void",
]);

export const feeInvoices = pgTable("fee_invoices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  brandUserId: varchar("brand_user_id").notNull().references(() => users.id),
  currency: text("currency").notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  /** Captured at claim time, so a failed run still shows what it tried to bill. */
  subtotalCents: integer("subtotal_cents").notNull(),
  lineCount: integer("line_count").notNull(),
  status: feeInvoiceStatusEnum("status").notNull().default("pending"),
  stripeInvoiceId: text("stripe_invoice_id"),
  hostedInvoiceUrl: text("hosted_invoice_url"),
  /** A draft bills nobody. Finalising is a separate, explicit step. */
  finalized: boolean("finalized").notNull().default(false),
  error: text("error"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type FeeInvoice = typeof feeInvoices.$inferSelect;

// ─── Scheduled job runs ──────────────────────────────────────────────────────
//
// The ledger behind server/scheduler.ts. An in-memory cron is not enough for
// money: it fires only while the process is alive, so a redeploy at the
// scheduled minute skips a payout run silently, and with two instances running
// every instance fires and everyone is paid twice.
//
// A row here is a CLAIM on one occurrence of one schedule. The unique index on
// (job_name, scheduled_for) is the real guard — two instances racing the same
// window both insert, exactly one wins, the loser takes 23505 and stands down.
// `scheduled_for` is the schedule occurrence, not the wall clock, so a run
// catching up a missed Monday cannot be confused with next Monday's.
export const scheduledRunStatusEnum = pgEnum("scheduled_run_status", [
  /** Claimed and in flight. Stuck here = the process died mid-run; deliberately
   *  left visible rather than silently retried, since re-running a half-finished
   *  payout is precisely what must never happen unattended. */
  "running",
  "success",
  "failed",
  /** Nothing to do — no payable commissions, or no billable accruals. */
  "skipped",
]);

export const scheduledJobRuns = pgTable("scheduled_job_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  jobName: text("job_name").notNull(),
  scheduledFor: timestamp("scheduled_for").notNull(),
  status: scheduledRunStatusEnum("status").notNull().default("running"),
  startedAt: timestamp("started_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  finishedAt: timestamp("finished_at"),
  items: integer("items").notNull().default(0),
  detail: text("detail"),
});

export type ScheduledJobRun = typeof scheduledJobRuns.$inferSelect;

// ─── In-video orders ─────────────────────────────────────────────────────────
//
// A shopper buying from the video overlay, paid through MTRLZD so Stripe can
// split the money at the moment of the charge.
//
// This is the difference between "invoices a 15% fee" and "retains" one. On the
// invoicing path the brand's own checkout takes the money and we bill them
// later; here the charge is created by the platform on the brand's connected
// account, Stripe routes the brand their share and withholds our fee, and the
// brand stays merchant of record via `on_behalf_of`.
//
// commission_transactions records what people EARN from a sale and has nowhere
// to put the shopper's payment itself. This is that record, and it is what a
// refund or dispute gets reconciled against.
export const videoOrderStatusEnum = pgEnum("video_order_status", [
  "pending", "paid", "failed", "refunded",
]);

export const videoOrders = pgTable("video_orders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  videoId: varchar("video_id").notNull().references(() => videos.id),
  overlayId: integer("overlay_id"),
  // Denormalised so an order stays readable after a video or overlay is edited.
  brandUserId: varchar("brand_user_id").notNull().references(() => users.id),
  creatorId: varchar("creator_id").references(() => users.id),
  affiliateId: varchar("affiliate_id").references(() => users.id),
  /** The utm/ref carried from the embed click, kept for reconciliation. */
  attributionRef: text("attribution_ref"),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").notNull(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  currency: text("currency").notNull(),
  amountCents: integer("amount_cents").notNull(),
  /** What Stripe withheld for the platform at the moment of the charge. */
  applicationFeeCents: integer("application_fee_cents").notNull().default(0),
  status: videoOrderStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  paidAt: timestamp("paid_at"),
  refundedAt: timestamp("refunded_at"),
});

export type VideoOrder = typeof videoOrders.$inferSelect;

// ─── Vouchers ────────────────────────────────────────────────────────────────
//
// Replaces a single string in an environment variable that was the same for
// everyone, uncapped, never expired, recorded nothing, and could only be revoked
// by rotating it for everybody at once.
//
// The offer it exists for: 20 free creator accounts, tied to the brand who
// earned them by subscribing, for a promotional period. That needs a code to be
// unique, capped, owned, expirable and revocable — none of which a shared
// constant can be.
//
// THE CAP IS A DATABASE GUARANTEE. Twenty creators given the same code do not
// redeem one at a time; counting then inserting is a read-modify-write that
// hands out 21+. Redemption re-counts under an advisory lock, and
// (voucher_id, user_id) is unique so nobody can redeem the same voucher twice.
export const voucherGrantEnum = pgEnum("voucher_grant", [
  /** Permanent free access — no subscription, no upload caps. */
  "free_access",
  /** Waives the $29 setup fee; the subscription itself is still paid. */
  "waive_setup_fee",
]);

export const vouchers = pgTable("vouchers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  /** Stored and compared uppercase, so whoever types it need not care. */
  code: text("code").notNull(),
  /** Admin-only note, e.g. "GTM — Nike, 20 creator seats". */
  label: text("label"),
  grantType: voucherGrantEnum("grant_type").notNull().default("free_access"),
  /** The brand this was issued to. Null for a general campaign code. */
  brandUserId: varchar("brand_user_id").references(() => users.id),
  /** "creator" restricts redemption to creator signups; null means any role. */
  roleRestriction: text("role_restriction"),
  /** Null means uncapped — which is what the old env-var code effectively was. */
  maxRedemptions: integer("max_redemptions"),
  /**
   * Groups one mint, so "the 80 I gave Vogue" is one query, one CSV export and
   * one thing to revoke — rather than 80 rows to pick out of a list by eye.
   */
  batchId: varchar("batch_id"),
  /**
   * Who this code was handed to. A NOTE, not a foreign key: the recipient is
   * typically a brand that has no account yet — which is the whole point of a
   * voucher — and the client plans to have partners fill these in on a
   * spreadsheet. An FK would make the common case unrepresentable.
   */
  assignedTo: text("assigned_to"),
  /**
   * WHICH partner within the batch, where assignedTo is WHO the batch went to.
   *
   * Brooklyn's 81 codes all carry assignedTo "Brooklyn"; the festival organiser
   * is the only person who knows that a given code went to a particular brand.
   * They fill this in on the exported CSV and it is read back by code, so
   * redemptions can be attributed to a partner rather than to a festival.
   */
  partner: text("partner"),
  /**
   * Not usable before this instant. Null means usable immediately, which is how
   * every code behaved before this column existed.
   *
   * Distinct from createdAt: a festival's codes are minted weeks ahead and must
   * not work until the doors open.
   */
  activeFrom: timestamp("active_from"),
  expiresAt: timestamp("expires_at"),
  /**
   * Free period in days, counted from redemption. NULL keeps the festival
   * behaviour: free until the voucher's own expiry date.
   */
  freeDays: integer("free_days"),
  /** Revocation is a timestamp, not a delete: redemptions already made stay valid. */
  revokedAt: timestamp("revoked_at"),
  createdBy: varchar("created_by").references(() => users.id),
  createdAt: timestamp("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const voucherRedemptions = pgTable("voucher_redemptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  voucherId: varchar("voucher_id").notNull().references(() => vouchers.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  redeemedAt: timestamp("redeemed_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export type Voucher = typeof vouchers.$inferSelect;
export type VoucherRedemption = typeof voucherRedemptions.$inferSelect;

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
