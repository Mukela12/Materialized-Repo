import { randomUUID } from "crypto";
import { eq, desc, sql, and } from "drizzle-orm";
import { db } from "./db";
import {
  type User, type InsertUser,
  type Brand, type InsertBrand,
  type Product, type InsertProduct,
  type Video, type InsertVideo,
  type VideoBrand, type InsertVideoBrand,
  type VideoProduct, type InsertVideoProduct,
  type BrandReferral, type InsertBrandReferral,
  type AnalyticsEvent, type InsertAnalyticsEvent,
  type AffiliatePayout, type InsertAffiliatePayout,
  type Campaign, type InsertCampaign,
  type BrandKit, type InsertBrandKit,
  type VideoCarouselOverride, type InsertVideoCarouselOverride,
  type VideoDetectionJob, type InsertVideoDetectionJob,
  type VideoDetectionResult, type InsertVideoDetectionResult,
  type VideoProductOverlay, type InsertVideoProductOverlay,
  type CreatorInvitation, type InsertCreatorInvitation,
  type AffiliateInvitation, type InsertAffiliateInvitation,
  type CampaignAffiliate, type InsertCampaignAffiliate,
  type GlobalVideoLibrary, type InsertGlobalVideoLibrary,
  type VideoLicensePurchase, type InsertVideoLicensePurchase,
  type VideoPublishRecord, type InsertVideoPublishRecord,
  type SubscriberIntake, type InsertSubscriberIntake,
  type UserProfile, type InsertUserProfile,
  type CreatorReward, type InsertCreatorReward,
  type EmbedDeployment, type InsertEmbedDeployment,
  type CommissionTransaction, type InsertCommissionTransaction,
  type BrandOutreach, type InsertBrandOutreach,
  type PublisherNotification, type InsertPublisherNotification,
  type BrandSubscription, type InsertBrandSubscription,
  type BrandBillingRecord, type InsertBrandBillingRecord,
  type BrandPayoutMethod, type InsertBrandPayoutMethod,
  type BrandBillingProfile, type InsertBrandBillingProfile,
  type BrandApiKey, type InsertBrandApiKey,
  insertCreatorInvitationSchema,
  users,
  brands,
  products,
  videos,
  videoBrands,
  videoProducts,
  brandReferrals,
  analyticsEvents,
  affiliatePayouts,
  brandKits,
  campaigns,
  videoCarouselOverrides,
  videoDetectionJobs,
  videoDetectionResults,
  videoProductOverlays,
  creatorInvitations,
  affiliateInvitations,
  campaignAffiliates,
  globalVideoLibrary,
  videoLicensePurchases,
  videoPublishRecords,
  subscriberIntakes,
  userProfiles,
  creatorRewards,
  embedDeployments,
  commissionTransactions,
  brandOutreachRequests,
  publisherNotifications,
  brandSubscriptions,
  brandBillingRecords,
  brandPayoutMethods,
  brandBillingProfiles,
  brandApiKeys,
  playlists,
  playlistItems,
  type InsertPlaylist,
  type Playlist,
  type InsertPlaylistItem,
  type PlaylistItem,
  wishlists,
  type Wishlist,
  type InsertWishlist,
} from "@shared/schema";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  getUserByStripeCustomerId(customerId: string): Promise<User | undefined>;
  getUserByVerificationToken(token: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined>;
  
  // Brands
  getBrands(): Promise<Brand[]>;
  getBrand(id: string): Promise<Brand | undefined>;
  createBrand(brand: InsertBrand): Promise<Brand>;
  updateBrand(id: string, data: Partial<InsertBrand>): Promise<Brand | undefined>;
  
  // Products
  getProducts(brandId?: string): Promise<Product[]>;
  getProduct(id: string): Promise<Product | undefined>;
  createProduct(product: InsertProduct): Promise<Product>;
  
  // Videos
  getVideos(creatorId?: string): Promise<Video[]>;
  getVideoCountByUser(userId: string): Promise<number>;
  getVideo(id: string): Promise<Video | undefined>;
  createVideo(video: InsertVideo): Promise<Video>;
  updateVideo(id: string, data: Partial<InsertVideo>): Promise<Video | undefined>;
  deleteVideo(id: string): Promise<boolean>;
  getAllPublishedVideos(): Promise<Video[]>;
  
  // Video-Brand associations
  addVideoBrand(videoBrand: InsertVideoBrand): Promise<VideoBrand>;
  getVideoBrands(videoId: string): Promise<VideoBrand[]>;
  
  // Video-Product associations (detected products)
  addVideoProduct(videoProduct: InsertVideoProduct): Promise<VideoProduct>;
  getVideoProducts(videoId: string): Promise<VideoProduct[]>;
  
  // Brand Referrals
  getReferrals(creatorId: string): Promise<BrandReferral[]>;
  getReferral(id: string): Promise<BrandReferral | undefined>;
  createReferral(referral: InsertBrandReferral): Promise<BrandReferral>;
  updateReferralStatus(id: string, status: string): Promise<BrandReferral | undefined>;

  // Brand Outreach
  createBrandOutreach(outreach: InsertBrandOutreach): Promise<BrandOutreach>;
  getBrandOutreach(id: string): Promise<BrandOutreach | undefined>;
  getBrandOutreachByToken(token: string): Promise<BrandOutreach | undefined>;
  getBrandOutreachesByCreator(creatorId: string): Promise<BrandOutreach[]>;
  getAllBrandOutreaches(): Promise<BrandOutreach[]>;
  updateBrandOutreachStatus(id: string, status: string, authorizedAt?: Date): Promise<BrandOutreach | undefined>;
  updateBrandOutreachAdmin(id: string, updates: Partial<Pick<BrandOutreach, "adminNotes" | "agreementStartedAt" | "agreementSignedAt" | "brandSubscribedAt" | "status">>): Promise<BrandOutreach | undefined>;
  recordOutreachFollowUp(id: string, followUpType: string): Promise<BrandOutreach | undefined>;

  // Analytics
  getAnalyticsEvents(videoId?: string): Promise<AnalyticsEvent[]>;
  createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent>;
  getVideoStats(creatorId: string): Promise<{
    totalViews: number;
    totalClicks: number;
    totalRevenue: number;
    averageCTR: number;
  }>;
  
  // Payouts
  getPayouts(userId: string): Promise<AffiliatePayout[]>;
  createPayout(payout: InsertAffiliatePayout): Promise<AffiliatePayout>;
  
  // Campaigns
  getCampaigns(brandId: string): Promise<Campaign[]>;
  getCampaign(id: string): Promise<Campaign | undefined>;
  createCampaign(campaign: InsertCampaign): Promise<Campaign>;
  updateCampaign(id: string, data: Partial<Campaign>): Promise<Campaign | undefined>;
  deleteCampaign(id: string): Promise<boolean>;
  getCampaignStats(brandId: string): Promise<{
    totalCampaigns: number;
    activeCampaigns: number;
    totalBudget: number;
    totalSpent: number;
    totalRevenue: number;
    averageROI: number;
  }>;
  
  // Brand Kits
  getBrandKit(userId: string): Promise<BrandKit | undefined>;
  createBrandKit(kit: InsertBrandKit): Promise<BrandKit>;
  updateBrandKit(id: string, data: Partial<InsertBrandKit>): Promise<BrandKit | undefined>;
  
  // Video Carousel Overrides
  getVideoCarouselOverride(videoId: string): Promise<VideoCarouselOverride | undefined>;
  createVideoCarouselOverride(override: InsertVideoCarouselOverride): Promise<VideoCarouselOverride>;
  updateVideoCarouselOverride(videoId: string, data: Partial<InsertVideoCarouselOverride>): Promise<VideoCarouselOverride | undefined>;
  
  // Video Detection Jobs
  getDetectionJob(id: string): Promise<VideoDetectionJob | undefined>;
  getDetectionJobByVideoId(videoId: string): Promise<VideoDetectionJob | undefined>;
  createDetectionJob(job: InsertVideoDetectionJob): Promise<VideoDetectionJob>;
  updateDetectionJob(id: string, data: Partial<VideoDetectionJob>): Promise<VideoDetectionJob | undefined>;
  
  // Video Detection Results
  getDetectionResults(jobId: string): Promise<VideoDetectionResult[]>;
  getDetectionResultsByVideo(videoId: string): Promise<VideoDetectionResult[]>;
  createDetectionResult(result: InsertVideoDetectionResult): Promise<VideoDetectionResult>;
  
  // Video Product Overlays
  getVideoProductOverlays(videoId: string): Promise<VideoProductOverlay[]>;
  createVideoProductOverlay(overlay: InsertVideoProductOverlay): Promise<VideoProductOverlay>;
  updateVideoProductOverlay(id: number, data: Partial<InsertVideoProductOverlay>): Promise<VideoProductOverlay | undefined>;
  deleteVideoProductOverlay(id: number): Promise<void>;

  // Creator Invitations
  getCreatorInvitations(brandId: string): Promise<CreatorInvitation[]>;
  createCreatorInvitation(invitation: InsertCreatorInvitation): Promise<CreatorInvitation>;
  createCreatorInvitationsBulk(invitations: InsertCreatorInvitation[]): Promise<CreatorInvitation[]>;
  updateCreatorInvitationStatus(id: string, status: string): Promise<CreatorInvitation | undefined>;
  
  // Affiliate Invitations
  getAffiliateInvitations(inviterId: string): Promise<AffiliateInvitation[]>;
  getAffiliateInvitationByToken(token: string): Promise<AffiliateInvitation | undefined>;
  createAffiliateInvitation(invitation: InsertAffiliateInvitation): Promise<AffiliateInvitation>;
  createAffiliateInvitationsBulk(invitations: InsertAffiliateInvitation[]): Promise<AffiliateInvitation[]>;
  updateAffiliateInvitationStatus(id: string, status: string, acceptedByUserId?: string): Promise<AffiliateInvitation | undefined>;
  
  // Campaign Affiliates
  getCampaignAffiliates(videoId: string): Promise<CampaignAffiliate[]>;
  getCampaignAffiliatesByUser(affiliateId: string): Promise<CampaignAffiliate[]>;
  createCampaignAffiliate(assignment: InsertCampaignAffiliate): Promise<CampaignAffiliate>;
  updateCampaignAffiliateStats(id: string, stats: Partial<CampaignAffiliate>): Promise<CampaignAffiliate | undefined>;
  getAffiliatePublishersAnalytics(): Promise<{
    id: string;
    affiliateId: string;
    affiliateName: string;
    affiliateEmail: string;
    totalClicks: number;
    totalConversions: number;
    totalRevenue: string;
    totalEarnings: string;
    campaignCount: number;
  }[]>;
  
  // Global Video Library
  getGlobalVideoListings(category?: string): Promise<GlobalVideoLibrary[]>;
  getGlobalVideoListing(id: string): Promise<GlobalVideoLibrary | undefined>;
  getGlobalVideoListingByVideo(videoId: string): Promise<GlobalVideoLibrary | undefined>;
  createGlobalVideoListing(listing: InsertGlobalVideoLibrary): Promise<GlobalVideoLibrary>;
  updateGlobalVideoListing(id: string, data: Partial<GlobalVideoLibrary>): Promise<GlobalVideoLibrary | undefined>;
  
  // Video License Purchases
  getVideoLicensePurchases(affiliateId: string): Promise<VideoLicensePurchase[]>;
  getVideoLicensePurchase(id: string): Promise<VideoLicensePurchase | undefined>;
  createVideoLicensePurchase(purchase: InsertVideoLicensePurchase): Promise<VideoLicensePurchase>;
  updateVideoLicensePurchaseStatus(id: string, status: string, paymentIntentId?: string): Promise<VideoLicensePurchase | undefined>;
  
  // Video Publish Records
  getVideoPublishRecord(videoId: string): Promise<VideoPublishRecord | undefined>;
  createVideoPublishRecord(record: InsertVideoPublishRecord): Promise<VideoPublishRecord>;
  updateVideoPublishRecord(id: string, data: Partial<VideoPublishRecord>): Promise<VideoPublishRecord | undefined>;
  
  // Subscriber Intakes
  createSubscriberIntake(intake: InsertSubscriberIntake): Promise<SubscriberIntake>;
  getSubscriberIntakes(): Promise<SubscriberIntake[]>;
  getSubscriberIntakeByEmail(email: string): Promise<SubscriberIntake | undefined>;
  
  // User Profiles
  getUserProfile(userId: string): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(userId: string, data: Partial<InsertUserProfile>): Promise<UserProfile | undefined>;
  
  // Creator Rewards
  getCreatorRewards(creatorId: string): Promise<CreatorReward[]>;
  getCreatorRewardsSummary(creatorId: string): Promise<{ totalCredits: number; availableCredits: number; redeemedCredits: number; euroValue: number }>;
  createCreatorReward(reward: InsertCreatorReward): Promise<CreatorReward>;
  redeemCreatorReward(rewardId: string, listingId: string): Promise<CreatorReward | undefined>;
  
  // Embed Deployments
  getEmbedDeployment(affiliateId: string, videoId: string, referrerDomain: string, utmCode: string): Promise<EmbedDeployment | undefined>;
  getEmbedDeploymentsByAffiliate(affiliateId: string): Promise<EmbedDeployment[]>;
  createEmbedDeployment(deployment: InsertEmbedDeployment): Promise<EmbedDeployment>;
  incrementEmbedDeploymentLoads(id: string): Promise<EmbedDeployment | undefined>;
  
  // Commission Transactions
  getCommissionTransactions(affiliateId: string): Promise<CommissionTransaction[]>;
  getCommissionTransactionsByVideo(videoId: string): Promise<CommissionTransaction[]>;
  createCommissionTransaction(transaction: InsertCommissionTransaction): Promise<CommissionTransaction>;
  updateCommissionTransactionStatus(id: string, status: string): Promise<CommissionTransaction | undefined>;
  getAffiliateEarningsFromLedger(affiliateId: string): Promise<{ totalSales: number; totalCommission: number; pendingCommission: number; approvedCommission: number; paidCommission: number; transactionCount: number }>;
  
  // UTM Resolution
  resolveUtmToAffiliate(utmCode: string): Promise<{ affiliateId: string; campaignAffiliateId: string | null; videoId: string; commissionRate: string } | null>;

  // Publisher Notifications
  getPublisherNotifications(affiliateId: string): Promise<PublisherNotification[]>;
  createPublisherNotification(data: InsertPublisherNotification): Promise<PublisherNotification>;
  markPublisherNotificationRead(id: number): Promise<void>;
  getUnreadNotificationCount(affiliateId: string): Promise<number>;
  // Campaign Publisher Management
  getCampaignDetail(campaignId: string): Promise<any>;
  disableCampaignPublisher(campaignAffiliateId: string): Promise<CampaignAffiliate | undefined>;
  extendCampaignPublisher(campaignAffiliateId: string, hours: number): Promise<CampaignAffiliate | undefined>;

  // Brand Billing & Account
  getBrandSubscription(userId: string): Promise<BrandSubscription | undefined>;
  upsertBrandSubscription(data: InsertBrandSubscription): Promise<BrandSubscription>;
  getBrandBillingRecords(userId: string, type?: string): Promise<BrandBillingRecord[]>;
  createBrandBillingRecord(data: InsertBrandBillingRecord): Promise<BrandBillingRecord>;
  getBrandPayoutMethod(userId: string): Promise<BrandPayoutMethod | undefined>;
  upsertBrandPayoutMethod(data: InsertBrandPayoutMethod): Promise<BrandPayoutMethod>;
  getBrandBillingProfile(userId: string): Promise<BrandBillingProfile | undefined>;
  upsertBrandBillingProfile(data: InsertBrandBillingProfile): Promise<BrandBillingProfile>;
  getBrandApiKeys(userId: string): Promise<BrandApiKey[]>;
  createBrandApiKey(data: InsertBrandApiKey): Promise<BrandApiKey>;
  revokeBrandApiKey(id: number, userId: string): Promise<void>;

  // Playlists
  getUserPlaylists(userId: string): Promise<Playlist[]>;
  getPlaylist(id: number): Promise<Playlist | undefined>;
  createPlaylist(data: InsertPlaylist): Promise<Playlist>;
  updatePlaylist(id: number, data: Partial<Playlist>): Promise<Playlist | undefined>;
  deletePlaylist(id: number, userId: string): Promise<void>;
  getPlaylistItems(playlistId: number): Promise<PlaylistItem[]>;
  addPlaylistItems(items: InsertPlaylistItem[]): Promise<PlaylistItem[]>;
  removePlaylistItem(id: number): Promise<void>;
  getUserWishlist(userId: string): Promise<Wishlist[]>;
  addToWishlist(data: InsertWishlist): Promise<Wishlist>;
  removeFromWishlist(userId: string, globalListingId: string): Promise<void>;
  isInWishlist(userId: string, globalListingId: string): Promise<boolean>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User> = new Map();
  private brands: Map<string, Brand> = new Map();
  private products: Map<string, Product> = new Map();
  private videos: Map<string, Video> = new Map();
  private videoBrands: Map<string, VideoBrand> = new Map();
  private videoProducts: Map<string, VideoProduct> = new Map();
  private referrals: Map<string, BrandReferral> = new Map();
  private analyticsEvents: Map<string, AnalyticsEvent> = new Map();
  private payouts: Map<string, AffiliatePayout> = new Map();
  private brandKits: Map<string, BrandKit> = new Map();
  private campaigns: Map<string, Campaign> = new Map();
  private videoCarouselOverrides: Map<string, VideoCarouselOverride> = new Map();
  private detectionJobs: Map<string, VideoDetectionJob> = new Map();
  private detectionResults: Map<string, VideoDetectionResult> = new Map();
  private videoProductOverlaysMap: Map<number, VideoProductOverlay> = new Map();
  private overlayIdSeq = 0;
  private creatorInvitations: Map<string, CreatorInvitation> = new Map();
  private affiliateInvitations: Map<string, AffiliateInvitation> = new Map();
  private campaignAffiliates: Map<string, CampaignAffiliate> = new Map();
  private globalVideoLibrary: Map<string, GlobalVideoLibrary> = new Map();
  private videoLicensePurchases: Map<string, VideoLicensePurchase> = new Map();
  private videoPublishRecords: Map<string, VideoPublishRecord> = new Map();

  constructor() {
    this.seedDemoData();
  }

  private seedDemoData() {
    // Create demo user
    const demoUserId = randomUUID();
    const demoUser: User = {
      id: demoUserId,
      username: "demo_creator",
      password: "demo123",
      email: "demo@example.com",
      displayName: "Demo Creator",
      avatarUrl: null,
      role: "creator",
      affiliateTrackingId: randomUUID(),
      referralCode: `REF_${randomUUID().slice(0, 8).toUpperCase()}`,
      commissionRate: "15.00",
      charityContribution: "0.00",
      stripeCustomerId: null,
      stripeConnectAccountId: null,
      stripeConnectOnboarded: false,
    };
    this.users.set(demoUserId, demoUser);

    // Create demo brands
    const brandData = [
      { name: "Nike", category: "Fashion", website: "nike.com" },
      { name: "Apple", category: "Electronics", website: "apple.com" },
      { name: "Samsung", category: "Electronics", website: "samsung.com" },
      { name: "Adidas", category: "Fashion", website: "adidas.com" },
      { name: "Sony", category: "Electronics", website: "sony.com" },
      { name: "Sephora", category: "Beauty", website: "sephora.com" },
      { name: "Lululemon", category: "Fitness", website: "lululemon.com" },
      { name: "Dyson", category: "Home", website: "dyson.com" },
    ];

    for (const data of brandData) {
      const brandId = randomUUID();
      const brand: Brand = {
        id: brandId,
        name: data.name,
        category: data.category,
        website: data.website,
        logoUrl: null,
        description: null,
        prContactEmail: null,
        prContactName: null,
        isActive: true,
        ownerId: null,
      };
      this.brands.set(brandId, brand);
    }
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.username === username);
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.email === email);
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.stripeCustomerId === customerId);
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find((u) => u.emailVerificationToken === token);
  }

  async createUser(user: InsertUser): Promise<User> {
    const id = randomUUID();
    const newUser: User = {
      id,
      username: user.username,
      password: user.password,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl ?? null,
      role: user.role ?? "creator",
      affiliateTrackingId: randomUUID(),
      referralCode: `REF_${randomUUID().slice(0, 8).toUpperCase()}`,
      commissionRate: user.commissionRate ?? "15.00",
      charityContribution: user.charityContribution ?? "0.00",
      stripeCustomerId: null,
      stripeConnectAccountId: null,
      stripeConnectOnboarded: false,
    };
    this.users.set(id, newUser);
    return newUser;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const user = this.users.get(id);
    if (!user) return undefined;
    const updated = { ...user, ...data };
    this.users.set(id, updated);
    return updated;
  }

  // Brands
  async getBrands(): Promise<Brand[]> {
    return Array.from(this.brands.values()).filter((b) => b.isActive);
  }

  async getBrand(id: string): Promise<Brand | undefined> {
    return this.brands.get(id);
  }

  async createBrand(brand: InsertBrand): Promise<Brand> {
    const id = randomUUID();
    const newBrand: Brand = {
      id,
      name: brand.name,
      logoUrl: brand.logoUrl ?? null,
      website: brand.website ?? null,
      category: brand.category ?? null,
      description: brand.description ?? null,
      prContactEmail: brand.prContactEmail ?? null,
      prContactName: brand.prContactName ?? null,
      isActive: brand.isActive ?? true,
      ownerId: brand.ownerId ?? null,
    };
    this.brands.set(id, newBrand);
    return newBrand;
  }

  async updateBrand(id: string, data: Partial<InsertBrand>): Promise<Brand | undefined> {
    const brand = this.brands.get(id);
    if (!brand) return undefined;
    const updated = { ...brand, ...data };
    this.brands.set(id, updated);
    return updated;
  }

  // Products
  async getProducts(brandId?: string): Promise<Product[]> {
    const allProducts = Array.from(this.products.values()).filter((p) => p.isActive);
    if (brandId) {
      return allProducts.filter((p) => p.brandId === brandId);
    }
    return allProducts;
  }

  async getProduct(id: string): Promise<Product | undefined> {
    return this.products.get(id);
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const id = randomUUID();
    const newProduct: Product = {
      id,
      brandId: product.brandId,
      name: product.name,
      description: product.description ?? null,
      price: product.price,
      imageUrl: product.imageUrl ?? null,
      productUrl: product.productUrl ?? null,
      sku: product.sku ?? null,
      category: product.category ?? null,
      isActive: product.isActive ?? true,
    };
    this.products.set(id, newProduct);
    return newProduct;
  }

  // Videos
  async getVideos(creatorId?: string): Promise<Video[]> {
    const allVideos = Array.from(this.videos.values());
    if (creatorId) {
      return allVideos.filter((v) => v.creatorId === creatorId)
        .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
    }
    return allVideos.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getVideoCountByUser(userId: string): Promise<number> {
    return Array.from(this.videos.values()).filter((v) => v.creatorId === userId).length;
  }

  async getVideo(id: string): Promise<Video | undefined> {
    return this.videos.get(id);
  }

  async createVideo(video: InsertVideo): Promise<Video> {
    const id = randomUUID();
    const newVideo: Video = {
      id,
      creatorId: video.creatorId,
      title: video.title,
      description: video.description ?? null,
      videoUrl: video.videoUrl,
      thumbnailUrl: video.thumbnailUrl ?? null,
      status: "processing",
      embedCode: null,
      utmCode: randomUUID(),
      totalViews: 0,
      totalClicks: 0,
      totalRevenue: "0.00",
      createdAt: new Date(),
    };
    this.videos.set(id, newVideo);
    return newVideo;
  }

  async updateVideo(id: string, data: Partial<InsertVideo>): Promise<Video | undefined> {
    const video = this.videos.get(id);
    if (!video) return undefined;
    const updated = { ...video, ...data } as Video;
    this.videos.set(id, updated);
    return updated;
  }

  async deleteVideo(id: string): Promise<boolean> {
    return this.videos.delete(id);
  }

  async getAllPublishedVideos(): Promise<Video[]> {
    return Array.from(this.videos.values())
      .filter((v) => v.status === "published")
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  // Video-Brand associations
  async addVideoBrand(videoBrand: InsertVideoBrand): Promise<VideoBrand> {
    const id = randomUUID();
    const newVideoBrand: VideoBrand = { id, ...videoBrand };
    this.videoBrands.set(id, newVideoBrand);
    return newVideoBrand;
  }

  async getVideoBrands(videoId: string): Promise<VideoBrand[]> {
    return Array.from(this.videoBrands.values()).filter((vb) => vb.videoId === videoId);
  }

  // Video-Product associations
  async addVideoProduct(videoProduct: InsertVideoProduct): Promise<VideoProduct> {
    const id = randomUUID();
    const newVideoProduct: VideoProduct = {
      id,
      videoId: videoProduct.videoId,
      productId: videoProduct.productId,
      confidence: videoProduct.confidence ?? null,
      timestamp: videoProduct.timestamp ?? null,
    };
    this.videoProducts.set(id, newVideoProduct);
    return newVideoProduct;
  }

  async getVideoProducts(videoId: string): Promise<VideoProduct[]> {
    return Array.from(this.videoProducts.values()).filter((vp) => vp.videoId === videoId);
  }

  // Brand Referrals
  async getReferrals(creatorId: string): Promise<BrandReferral[]> {
    return Array.from(this.referrals.values())
      .filter((r) => r.creatorId === creatorId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getReferral(id: string): Promise<BrandReferral | undefined> {
    return this.referrals.get(id);
  }

  async createReferral(referral: InsertBrandReferral): Promise<BrandReferral> {
    const id = randomUUID();
    const newReferral: BrandReferral = {
      id,
      creatorId: referral.creatorId,
      brandName: referral.brandName,
      prContactName: referral.prContactName,
      prContactEmail: referral.prContactEmail,
      productCategory: referral.productCategory ?? null,
      message: referral.message ?? null,
      status: "pending",
      signupToken: randomUUID(),
      createdAt: new Date(),
    };
    this.referrals.set(id, newReferral);
    return newReferral;
  }

  async updateReferralStatus(id: string, status: string): Promise<BrandReferral | undefined> {
    const referral = this.referrals.get(id);
    if (!referral) return undefined;
    const updated = { ...referral, status: status as any };
    this.referrals.set(id, updated);
    return updated;
  }

  // Brand Outreach
  private brandOutreachMap: Map<string, BrandOutreach> = new Map();

  async createBrandOutreach(outreach: InsertBrandOutreach): Promise<BrandOutreach> {
    const id = randomUUID();
    const token = randomUUID();
    const newOutreach: BrandOutreach = {
      id,
      creatorId: outreach.creatorId,
      videoId: outreach.videoId ?? null,
      videoUrl: outreach.videoUrl ?? null,
      videoTitle: outreach.videoTitle ?? null,
      brandName: outreach.brandName,
      prContactName: outreach.prContactName,
      prContactEmail: outreach.prContactEmail,
      creatorMessage: outreach.creatorMessage ?? null,
      authToken: token,
      status: "pending",
      authorizedAt: null,
      createdAt: new Date(),
    };
    this.brandOutreachMap.set(id, newOutreach);
    return newOutreach;
  }

  async getBrandOutreach(id: string): Promise<BrandOutreach | undefined> {
    return this.brandOutreachMap.get(id);
  }

  async getBrandOutreachByToken(token: string): Promise<BrandOutreach | undefined> {
    return Array.from(this.brandOutreachMap.values()).find((o) => o.authToken === token);
  }

  async getBrandOutreachesByCreator(creatorId: string): Promise<BrandOutreach[]> {
    return Array.from(this.brandOutreachMap.values())
      .filter((o) => o.creatorId === creatorId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getAllBrandOutreaches(): Promise<BrandOutreach[]> {
    return Array.from(this.brandOutreachMap.values())
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async updateBrandOutreachStatus(id: string, status: string, authorizedAt?: Date): Promise<BrandOutreach | undefined> {
    const outreach = this.brandOutreachMap.get(id);
    if (!outreach) return undefined;
    const updated = { ...outreach, status: status as any, authorizedAt: authorizedAt ?? outreach.authorizedAt };
    this.brandOutreachMap.set(id, updated);
    return updated;
  }

  async updateBrandOutreachAdmin(id: string, updates: Partial<Pick<BrandOutreach, "adminNotes" | "agreementStartedAt" | "agreementSignedAt" | "brandSubscribedAt" | "status">>): Promise<BrandOutreach | undefined> {
    const outreach = this.brandOutreachMap.get(id);
    if (!outreach) return undefined;
    const updated = { ...outreach, ...updates };
    this.brandOutreachMap.set(id, updated);
    return updated;
  }

  async recordOutreachFollowUp(id: string, followUpType: string): Promise<BrandOutreach | undefined> {
    const outreach = this.brandOutreachMap.get(id);
    if (!outreach) return undefined;
    const updated = {
      ...outreach,
      followUpCount: (outreach.followUpCount ?? 0) + 1,
      lastFollowUpAt: new Date(),
      lastFollowUpType: followUpType as any,
    };
    this.brandOutreachMap.set(id, updated);
    return updated;
  }

  // Analytics
  async getAnalyticsEvents(videoId?: string): Promise<AnalyticsEvent[]> {
    const allEvents = Array.from(this.analyticsEvents.values());
    if (videoId) {
      return allEvents.filter((e) => e.videoId === videoId);
    }
    return allEvents;
  }

  async createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const id = randomUUID();
    const newEvent: AnalyticsEvent = {
      id,
      videoId: event.videoId,
      eventType: event.eventType,
      productId: event.productId ?? null,
      affiliateId: event.affiliateId ?? null,
      utmSource: event.utmSource ?? null,
      utmMedium: event.utmMedium ?? null,
      utmCampaign: event.utmCampaign ?? null,
      utmCode: event.utmCode ?? null,
      referrerDomain: event.referrerDomain ?? null,
      revenue: event.revenue ?? null,
      country: event.country ?? null,
      device: event.device ?? null,
      createdAt: new Date(),
    };
    this.analyticsEvents.set(id, newEvent);
    return newEvent;
  }

  async getVideoStats(creatorId: string): Promise<{
    totalViews: number;
    totalClicks: number;
    totalRevenue: number;
    averageCTR: number;
  }> {
    const creatorVideos = await this.getVideos(creatorId);
    
    let totalViews = 0;
    let totalClicks = 0;
    let totalRevenue = 0;
    
    for (const video of creatorVideos) {
      totalViews += video.totalViews || 0;
      totalClicks += video.totalClicks || 0;
      totalRevenue += Number(video.totalRevenue || 0);
    }
    
    const averageCTR = totalViews > 0 ? (totalClicks / totalViews) * 100 : 0;
    
    return { totalViews, totalClicks, totalRevenue, averageCTR };
  }

  // Payouts
  async getPayouts(userId: string): Promise<AffiliatePayout[]> {
    return Array.from(this.payouts.values())
      .filter((p) => p.userId === userId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async createPayout(payout: InsertAffiliatePayout): Promise<AffiliatePayout> {
    const id = randomUUID();
    const newPayout: AffiliatePayout = {
      id,
      userId: payout.userId,
      amount: payout.amount,
      status: payout.status ?? "pending",
      periodStart: payout.periodStart ?? null,
      periodEnd: payout.periodEnd ?? null,
      createdAt: new Date(),
    };
    this.payouts.set(id, newPayout);
    return newPayout;
  }

  // Campaigns
  async getCampaigns(brandId: string): Promise<Campaign[]> {
    return Array.from(this.campaigns.values())
      .filter((c) => c.brandId === brandId)
      .sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
  }

  async getCampaign(id: string): Promise<Campaign | undefined> {
    return this.campaigns.get(id);
  }

  async createCampaign(campaign: InsertCampaign): Promise<Campaign> {
    const id = randomUUID();
    const newCampaign: Campaign = {
      id,
      brandId: campaign.brandId,
      name: campaign.name,
      description: campaign.description ?? null,
      status: campaign.status ?? "draft",
      budget: campaign.budget,
      spentAmount: "0.00",
      startDate: campaign.startDate ?? null,
      endDate: campaign.endDate ?? null,
      targetViews: campaign.targetViews ?? null,
      targetClicks: campaign.targetClicks ?? null,
      targetConversions: campaign.targetConversions ?? null,
      targetRevenue: campaign.targetRevenue ?? null,
      actualViews: 0,
      actualClicks: 0,
      actualConversions: 0,
      actualRevenue: "0.00",
      productIds: campaign.productIds ?? null,
      creatorIds: campaign.creatorIds ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.campaigns.set(id, newCampaign);
    return newCampaign;
  }

  async updateCampaign(id: string, data: Partial<Campaign>): Promise<Campaign | undefined> {
    const campaign = this.campaigns.get(id);
    if (!campaign) return undefined;
    const updated = { ...campaign, ...data, updatedAt: new Date() } as Campaign;
    this.campaigns.set(id, updated);
    return updated;
  }

  async deleteCampaign(id: string): Promise<boolean> {
    return this.campaigns.delete(id);
  }

  async getCampaignStats(brandId: string): Promise<{
    totalCampaigns: number;
    activeCampaigns: number;
    totalBudget: number;
    totalSpent: number;
    totalRevenue: number;
    averageROI: number;
  }> {
    const campaigns = await this.getCampaigns(brandId);
    
    let totalBudget = 0;
    let totalSpent = 0;
    let totalRevenue = 0;
    let activeCampaigns = 0;
    
    for (const campaign of campaigns) {
      totalBudget += Number(campaign.budget || 0);
      totalSpent += Number(campaign.spentAmount || 0);
      totalRevenue += Number(campaign.actualRevenue || 0);
      if (campaign.status === "active") {
        activeCampaigns++;
      }
    }
    
    const averageROI = totalSpent > 0 ? ((totalRevenue - totalSpent) / totalSpent) * 100 : 0;
    
    return {
      totalCampaigns: campaigns.length,
      activeCampaigns,
      totalBudget,
      totalSpent,
      totalRevenue,
      averageROI,
    };
  }

  // Brand Kits
  async getBrandKit(userId: string): Promise<BrandKit | undefined> {
    return Array.from(this.brandKits.values()).find((kit) => kit.userId === userId);
  }

  async createBrandKit(kit: InsertBrandKit): Promise<BrandKit> {
    const id = randomUUID();
    const newKit: BrandKit = {
      id,
      userId: kit.userId,
      sourcePdfUrl: kit.sourcePdfUrl ?? null,
      extractedFonts: kit.extractedFonts ?? null,
      extractedColors: kit.extractedColors ?? null,
      manualFonts: kit.manualFonts ?? null,
      manualColors: kit.manualColors ?? null,
      defaultButtonFont: kit.defaultButtonFont ?? null,
      defaultButtonColor: kit.defaultButtonColor ?? null,
      defaultButtonTextColor: kit.defaultButtonTextColor ?? null,
      defaultCornerRadius: kit.defaultCornerRadius ?? 16,
      defaultBackgroundOpacity: kit.defaultBackgroundOpacity ?? 55,
      defaultShowThumbnail: kit.defaultShowThumbnail ?? true,
      defaultShowButton: kit.defaultShowButton ?? true,
      defaultShowPrice: kit.defaultShowPrice ?? true,
      defaultShowTitle: kit.defaultShowTitle ?? true,
      defaultButtonLabel: kit.defaultButtonLabel ?? "BUY NOW",
      defaultPosition: kit.defaultPosition ?? "bottom",
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.brandKits.set(id, newKit);
    return newKit;
  }

  async updateBrandKit(id: string, data: Partial<InsertBrandKit>): Promise<BrandKit | undefined> {
    const kit = this.brandKits.get(id);
    if (!kit) return undefined;
    const updated = { ...kit, ...data, updatedAt: new Date() } as BrandKit;
    this.brandKits.set(id, updated);
    return updated;
  }

  // Video Carousel Overrides
  async getVideoCarouselOverride(videoId: string): Promise<VideoCarouselOverride | undefined> {
    return Array.from(this.videoCarouselOverrides.values()).find((o) => o.videoId === videoId);
  }

  async createVideoCarouselOverride(override: InsertVideoCarouselOverride): Promise<VideoCarouselOverride> {
    const id = randomUUID();
    const newOverride: VideoCarouselOverride = {
      id,
      videoId: override.videoId,
      position: override.position ?? null,
      positionOffsetX: override.positionOffsetX ?? 0,
      positionOffsetY: override.positionOffsetY ?? 0,
      delayUntilEnd: override.delayUntilEnd ?? false,
      cornerRadius: override.cornerRadius ?? null,
      backgroundOpacity: override.backgroundOpacity ?? null,
      showThumbnail: override.showThumbnail ?? null,
      showButton: override.showButton ?? null,
      showPrice: override.showPrice ?? null,
      showTitle: override.showTitle ?? null,
      buttonLabel: override.buttonLabel ?? null,
      buttonFont: override.buttonFont ?? null,
      buttonColor: override.buttonColor ?? null,
      buttonTextColor: override.buttonTextColor ?? null,
      createdAt: new Date(),
    };
    this.videoCarouselOverrides.set(id, newOverride);
    return newOverride;
  }

  async updateVideoCarouselOverride(videoId: string, data: Partial<InsertVideoCarouselOverride>): Promise<VideoCarouselOverride | undefined> {
    const override = await this.getVideoCarouselOverride(videoId);
    if (!override) return undefined;
    const updated = { ...override, ...data } as VideoCarouselOverride;
    this.videoCarouselOverrides.set(override.id, updated);
    return updated;
  }

  // Video Detection Jobs
  async getDetectionJob(id: string): Promise<VideoDetectionJob | undefined> {
    return this.detectionJobs.get(id);
  }

  async getDetectionJobByVideoId(videoId: string): Promise<VideoDetectionJob | undefined> {
    return Array.from(this.detectionJobs.values()).find((job) => job.videoId === videoId);
  }

  async createDetectionJob(job: InsertVideoDetectionJob): Promise<VideoDetectionJob> {
    const id = randomUUID();
    const newJob: VideoDetectionJob = {
      id,
      videoId: job.videoId,
      selectedBrandIds: job.selectedBrandIds ?? null,
      status: "queued",
      frameSamplingRate: job.frameSamplingRate ?? 1,
      totalFrames: 0,
      processedFrames: 0,
      error: null,
      startedAt: null,
      completedAt: null,
      createdAt: new Date(),
    };
    this.detectionJobs.set(id, newJob);
    return newJob;
  }

  async updateDetectionJob(id: string, data: Partial<VideoDetectionJob>): Promise<VideoDetectionJob | undefined> {
    const job = this.detectionJobs.get(id);
    if (!job) return undefined;
    const updated = { ...job, ...data } as VideoDetectionJob;
    this.detectionJobs.set(id, updated);
    return updated;
  }

  // Video Detection Results
  async getDetectionResults(jobId: string): Promise<VideoDetectionResult[]> {
    return Array.from(this.detectionResults.values()).filter((r) => r.jobId === jobId);
  }

  async getDetectionResultsByVideo(videoId: string): Promise<VideoDetectionResult[]> {
    return Array.from(this.detectionResults.values())
      .filter((r) => r.videoId === videoId)
      .sort((a, b) => Number(a.startTime || 0) - Number(b.startTime || 0));
  }

  async createDetectionResult(result: InsertVideoDetectionResult): Promise<VideoDetectionResult> {
    const id = randomUUID();
    const newResult: VideoDetectionResult = {
      id,
      jobId: result.jobId,
      videoId: result.videoId,
      productId: result.productId,
      brandId: result.brandId,
      confidence: result.confidence,
      frameTimestamp: result.frameTimestamp,
      startTime: result.startTime ?? null,
      endTime: result.endTime ?? null,
      boundingBox: result.boundingBox ?? null,
      createdAt: new Date(),
    };
    this.detectionResults.set(id, newResult);
    return newResult;
  }

  // Video Product Overlays
  async getVideoProductOverlays(videoId: string): Promise<VideoProductOverlay[]> {
    return Array.from(this.videoProductOverlaysMap.values())
      .filter((o) => o.videoId === videoId)
      .sort((a, b) => (a.id as number) - (b.id as number));
  }
  async createVideoProductOverlay(overlay: InsertVideoProductOverlay): Promise<VideoProductOverlay> {
    const id = ++this.overlayIdSeq;
    const created: VideoProductOverlay = { ...overlay, id, productId: overlay.productId ?? null, productUrl: overlay.productUrl ?? null, imageUrl: overlay.imageUrl ?? null, price: overlay.price ?? null, brandName: overlay.brandName ?? null, endTime: overlay.endTime ?? null, createdAt: new Date() };
    this.videoProductOverlaysMap.set(id, created);
    return created;
  }
  async updateVideoProductOverlay(id: number, data: Partial<InsertVideoProductOverlay>): Promise<VideoProductOverlay | undefined> {
    const existing = this.videoProductOverlaysMap.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...data };
    this.videoProductOverlaysMap.set(id, updated);
    return updated;
  }
  async deleteVideoProductOverlay(id: number): Promise<void> {
    this.videoProductOverlaysMap.delete(id);
  }

  // Creator Invitations
  async getCreatorInvitations(brandId: string): Promise<CreatorInvitation[]> {
    return Array.from(this.creatorInvitations.values())
      .filter((inv) => inv.brandId === brandId)
      .sort((a, b) => (b.invitedAt?.getTime() || 0) - (a.invitedAt?.getTime() || 0));
  }

  async createCreatorInvitation(invitation: InsertCreatorInvitation): Promise<CreatorInvitation> {
    const id = randomUUID();
    const newInvitation: CreatorInvitation = {
      id,
      brandId: invitation.brandId,
      creatorName: invitation.creatorName,
      email: invitation.email,
      category: invitation.category ?? null,
      message: invitation.message ?? null,
      status: "pending",
      invitedAt: new Date(),
    };
    this.creatorInvitations.set(id, newInvitation);
    return newInvitation;
  }

  async createCreatorInvitationsBulk(invitations: InsertCreatorInvitation[]): Promise<CreatorInvitation[]> {
    const created: CreatorInvitation[] = [];
    for (const invitation of invitations) {
      const validated = insertCreatorInvitationSchema.safeParse(invitation);
      if (!validated.success) {
        continue;
      }
      const result = await this.createCreatorInvitation(validated.data);
      created.push(result);
    }
    return created;
  }

  async updateCreatorInvitationStatus(id: string, status: string): Promise<CreatorInvitation | undefined> {
    const invitation = this.creatorInvitations.get(id);
    if (!invitation) return undefined;
    const updated = { ...invitation, status: status as "pending" | "sent" | "accepted" | "declined" };
    this.creatorInvitations.set(id, updated);
    return updated;
  }

  // Affiliate Invitations
  async getAffiliateInvitations(inviterId: string): Promise<AffiliateInvitation[]> {
    return Array.from(this.affiliateInvitations.values())
      .filter((inv) => inv.inviterId === inviterId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getAffiliateInvitationByToken(token: string): Promise<AffiliateInvitation | undefined> {
    return Array.from(this.affiliateInvitations.values()).find((inv) => inv.inviteToken === token);
  }

  async createAffiliateInvitation(invitation: InsertAffiliateInvitation): Promise<AffiliateInvitation> {
    const id = randomUUID();
    const newInvitation: AffiliateInvitation = {
      id,
      inviterId: invitation.inviterId,
      affiliateName: invitation.affiliateName,
      email: invitation.email,
      commissionRate: invitation.commissionRate ?? "10.00",
      message: invitation.message ?? null,
      status: "pending",
      inviteToken: randomUUID(),
      acceptedByUserId: null,
      createdAt: new Date(),
    };
    this.affiliateInvitations.set(id, newInvitation);
    return newInvitation;
  }

  async createAffiliateInvitationsBulk(invitations: InsertAffiliateInvitation[]): Promise<AffiliateInvitation[]> {
    const created: AffiliateInvitation[] = [];
    for (const invitation of invitations) {
      const result = await this.createAffiliateInvitation(invitation);
      created.push(result);
    }
    return created;
  }

  async updateAffiliateInvitationStatus(id: string, status: string, acceptedByUserId?: string): Promise<AffiliateInvitation | undefined> {
    const invitation = this.affiliateInvitations.get(id);
    if (!invitation) return undefined;
    const updated = { 
      ...invitation, 
      status: status as "pending" | "sent" | "accepted" | "declined",
      acceptedByUserId: acceptedByUserId ?? invitation.acceptedByUserId
    };
    this.affiliateInvitations.set(id, updated);
    return updated;
  }

  // Campaign Affiliates
  async getCampaignAffiliates(videoId: string): Promise<CampaignAffiliate[]> {
    return Array.from(this.campaignAffiliates.values())
      .filter((ca) => ca.videoId === videoId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getCampaignAffiliatesByUser(affiliateId: string): Promise<CampaignAffiliate[]> {
    return Array.from(this.campaignAffiliates.values())
      .filter((ca) => ca.affiliateId === affiliateId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async createCampaignAffiliate(assignment: InsertCampaignAffiliate): Promise<CampaignAffiliate> {
    const id = randomUUID();
    const utmCode = randomUUID();
    const newAssignment: CampaignAffiliate = {
      id,
      videoId: assignment.videoId,
      affiliateId: assignment.affiliateId,
      commissionRate: assignment.commissionRate,
      utmCode,
      embedCode: null,
      totalClicks: 0,
      totalConversions: 0,
      totalRevenue: "0.00",
      totalEarnings: "0.00",
      notifiedAt: null,
      createdAt: new Date(),
    };
    this.campaignAffiliates.set(id, newAssignment);
    return newAssignment;
  }

  async updateCampaignAffiliateStats(id: string, stats: Partial<CampaignAffiliate>): Promise<CampaignAffiliate | undefined> {
    const assignment = this.campaignAffiliates.get(id);
    if (!assignment) return undefined;
    const updated = { ...assignment, ...stats };
    this.campaignAffiliates.set(id, updated);
    return updated;
  }

  async getAffiliatePublishersAnalytics(): Promise<{
    id: string;
    affiliateId: string;
    affiliateName: string;
    affiliateEmail: string;
    totalClicks: number;
    totalConversions: number;
    totalRevenue: string;
    totalEarnings: string;
    campaignCount: number;
  }[]> {
    const affiliateMap = new Map<string, {
      id: string;
      affiliateId: string;
      affiliateName: string;
      affiliateEmail: string;
      totalClicks: number;
      totalConversions: number;
      totalRevenue: number;
      totalEarnings: number;
      campaignCount: number;
    }>();

    for (const ca of this.campaignAffiliates.values()) {
      const user = this.users.get(ca.affiliateId);
      if (!user) continue;
      
      const existing = affiliateMap.get(ca.affiliateId);
      if (existing) {
        existing.totalClicks += ca.totalClicks || 0;
        existing.totalConversions += ca.totalConversions || 0;
        existing.totalRevenue += parseFloat(ca.totalRevenue?.toString() || "0");
        existing.totalEarnings += parseFloat(ca.totalEarnings?.toString() || "0");
        existing.campaignCount += 1;
      } else {
        affiliateMap.set(ca.affiliateId, {
          id: ca.affiliateId,
          affiliateId: ca.affiliateId,
          affiliateName: user.displayName || user.username,
          affiliateEmail: user.email,
          totalClicks: ca.totalClicks || 0,
          totalConversions: ca.totalConversions || 0,
          totalRevenue: parseFloat(ca.totalRevenue?.toString() || "0"),
          totalEarnings: parseFloat(ca.totalEarnings?.toString() || "0"),
          campaignCount: 1,
        });
      }
    }

    return Array.from(affiliateMap.values()).map(a => ({
      ...a,
      totalRevenue: a.totalRevenue.toFixed(2),
      totalEarnings: a.totalEarnings.toFixed(2),
    }));
  }

  // Global Video Library
  async getGlobalVideoListings(category?: string): Promise<GlobalVideoLibrary[]> {
    let listings = Array.from(this.globalVideoLibrary.values())
      .filter((l) => l.publishStatus === "published");
    if (category) {
      listings = listings.filter((l) => l.category === category);
    }
    return listings.sort((a, b) => (b.listedAt?.getTime() || 0) - (a.listedAt?.getTime() || 0));
  }

  async getGlobalVideoListing(id: string): Promise<GlobalVideoLibrary | undefined> {
    return this.globalVideoLibrary.get(id);
  }

  async getGlobalVideoListingByVideo(videoId: string): Promise<GlobalVideoLibrary | undefined> {
    return Array.from(this.globalVideoLibrary.values()).find((l) => l.videoId === videoId);
  }

  async createGlobalVideoListing(listing: InsertGlobalVideoLibrary): Promise<GlobalVideoLibrary> {
    const id = randomUUID();
    const newListing: GlobalVideoLibrary = {
      id,
      videoId: listing.videoId,
      creatorId: listing.creatorId,
      licenseFee: listing.licenseFee ?? "45.00",
      publishStatus: "unpublished",
      stripePaymentIntentId: null,
      listingTitle: listing.listingTitle ?? null,
      listingDescription: listing.listingDescription ?? null,
      category: listing.category ?? null,
      tags: listing.tags ?? null,
      totalLicenses: 0,
      listedAt: null,
      createdAt: new Date(),
    };
    this.globalVideoLibrary.set(id, newListing);
    return newListing;
  }

  async updateGlobalVideoListing(id: string, data: Partial<GlobalVideoLibrary>): Promise<GlobalVideoLibrary | undefined> {
    const listing = this.globalVideoLibrary.get(id);
    if (!listing) return undefined;
    const updated = { ...listing, ...data };
    this.globalVideoLibrary.set(id, updated);
    return updated;
  }

  // Video License Purchases
  async getVideoLicensePurchases(affiliateId: string): Promise<VideoLicensePurchase[]> {
    return Array.from(this.videoLicensePurchases.values())
      .filter((p) => p.affiliateId === affiliateId)
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getVideoLicensePurchase(id: string): Promise<VideoLicensePurchase | undefined> {
    return this.videoLicensePurchases.get(id);
  }

  async createVideoLicensePurchase(purchase: InsertVideoLicensePurchase): Promise<VideoLicensePurchase> {
    const id = randomUUID();
    const utmCode = randomUUID();
    const newPurchase: VideoLicensePurchase = {
      id,
      globalListingId: purchase.globalListingId,
      affiliateId: purchase.affiliateId,
      licenseFee: purchase.licenseFee,
      status: "pending",
      stripePaymentIntentId: null,
      utmCode,
      embedCode: null,
      commissionRate: purchase.commissionRate ?? "10.00",
      purchasedAt: null,
      createdAt: new Date(),
    };
    this.videoLicensePurchases.set(id, newPurchase);
    return newPurchase;
  }

  async updateVideoLicensePurchaseStatus(id: string, status: string, paymentIntentId?: string): Promise<VideoLicensePurchase | undefined> {
    const purchase = this.videoLicensePurchases.get(id);
    if (!purchase) return undefined;
    const updated = { 
      ...purchase, 
      status: status as "pending" | "paid" | "failed" | "refunded",
      stripePaymentIntentId: paymentIntentId ?? purchase.stripePaymentIntentId,
      purchasedAt: status === "paid" ? new Date() : purchase.purchasedAt,
    };
    this.videoLicensePurchases.set(id, updated);
    return updated;
  }

  // Video Publish Records
  async getVideoPublishRecord(videoId: string): Promise<VideoPublishRecord | undefined> {
    return Array.from(this.videoPublishRecords.values()).find((r) => r.videoId === videoId && r.isActive);
  }

  async createVideoPublishRecord(record: InsertVideoPublishRecord): Promise<VideoPublishRecord> {
    const id = randomUUID();
    const newRecord: VideoPublishRecord = {
      id,
      videoId: record.videoId,
      embedCode: record.embedCode,
      embedCodeMinified: record.embedCode.replace(/\s+/g, ' ').trim(),
      widgetConfig: record.widgetConfig ?? null,
      baseUtmCode: randomUUID(),
      publishedAt: new Date(),
      isActive: true,
    };
    this.videoPublishRecords.set(id, newRecord);
    return newRecord;
  }

  async updateVideoPublishRecord(id: string, data: Partial<VideoPublishRecord>): Promise<VideoPublishRecord | undefined> {
    const record = this.videoPublishRecords.get(id);
    if (!record) return undefined;
    const updated = { ...record, ...data };
    this.videoPublishRecords.set(id, updated);
    return updated;
  }

  // Subscriber Intakes
  private subscriberIntakesMap: Map<string, SubscriberIntake> = new Map();

  async createSubscriberIntake(intake: InsertSubscriberIntake): Promise<SubscriberIntake> {
    const id = randomUUID();
    const newIntake: SubscriberIntake = {
      id,
      ...intake,
      createdAt: new Date(),
    };
    this.subscriberIntakesMap.set(id, newIntake);
    return newIntake;
  }

  async getSubscriberIntakes(): Promise<SubscriberIntake[]> {
    return Array.from(this.subscriberIntakesMap.values())
      .sort((a, b) => (b.createdAt?.getTime() || 0) - (a.createdAt?.getTime() || 0));
  }

  async getSubscriberIntakeByEmail(email: string): Promise<SubscriberIntake | undefined> {
    return Array.from(this.subscriberIntakesMap.values()).find(
      (i) => i.email.toLowerCase() === email.toLowerCase()
    );
  }

  // User Profiles
  private userProfilesMap: Map<string, UserProfile> = new Map();

  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    return Array.from(this.userProfilesMap.values()).find((p) => p.userId === userId);
  }

  async createUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const id = randomUUID();
    const newProfile: UserProfile = {
      id,
      userId: profile.userId,
      bio: profile.bio ?? null,
      profileMediaUrl: profile.profileMediaUrl ?? null,
      profileMediaType: profile.profileMediaType ?? null,
      locationCity: profile.locationCity ?? null,
      locationCountry: profile.locationCountry ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.userProfilesMap.set(id, newProfile);
    return newProfile;
  }

  async updateUserProfile(userId: string, data: Partial<InsertUserProfile>): Promise<UserProfile | undefined> {
    const existing = await this.getUserProfile(userId);
    if (existing) {
      const updated = { ...existing, ...data, updatedAt: new Date() };
      this.userProfilesMap.set(existing.id, updated);
      return updated;
    } else {
      return this.createUserProfile({ userId, ...data });
    }
  }

  // Creator Rewards
  private creatorRewardsMap: Map<string, CreatorReward> = new Map();

  async getCreatorRewards(creatorId: string): Promise<CreatorReward[]> {
    return Array.from(this.creatorRewardsMap.values())
      .filter((r) => r.creatorId === creatorId)
      .sort((a, b) => (b.earnedAt?.getTime() || 0) - (a.earnedAt?.getTime() || 0));
  }

  async getCreatorRewardsSummary(creatorId: string): Promise<{ totalCredits: number; availableCredits: number; redeemedCredits: number; euroValue: number }> {
    const rewards = await this.getCreatorRewards(creatorId);
    const totalCredits = rewards.reduce((sum, r) => sum + (r.creditsAmount || 0), 0);
    const redeemedCredits = rewards.filter(r => r.status === "redeemed").reduce((sum, r) => sum + (r.creditsAmount || 0), 0);
    const availableCredits = rewards.filter(r => r.status === "credited").reduce((sum, r) => sum + (r.creditsAmount || 0), 0);
    const euroValue = availableCredits;
    return { totalCredits, availableCredits, redeemedCredits, euroValue };
  }

  async createCreatorReward(reward: InsertCreatorReward): Promise<CreatorReward> {
    const id = randomUUID();
    const newReward: CreatorReward = {
      id,
      creatorId: reward.creatorId,
      rewardType: reward.rewardType ?? "brand_referral",
      creditsAmount: reward.creditsAmount ?? 45,
      euroValue: reward.euroValue ?? "45.00",
      status: reward.status ?? "credited",
      brandReferralId: reward.brandReferralId ?? null,
      description: reward.description ?? null,
      redeemedForListingId: reward.redeemedForListingId ?? null,
      earnedAt: new Date(),
      redeemedAt: null,
    };
    this.creatorRewardsMap.set(id, newReward);
    return newReward;
  }

  async redeemCreatorReward(rewardId: string, listingId: string): Promise<CreatorReward | undefined> {
    const reward = this.creatorRewardsMap.get(rewardId);
    if (!reward) return undefined;
    const updated = { ...reward, status: "redeemed" as const, redeemedForListingId: listingId, redeemedAt: new Date() };
    this.creatorRewardsMap.set(rewardId, updated);
    return updated;
  }

  // Embed Deployments
  private embedDeploymentsMap: Map<string, EmbedDeployment> = new Map();

  async getEmbedDeployment(affiliateId: string, videoId: string, referrerDomain: string, utmCode: string): Promise<EmbedDeployment | undefined> {
    return Array.from(this.embedDeploymentsMap.values()).find(d => d.affiliateId === affiliateId && d.videoId === videoId && d.referrerDomain === referrerDomain && d.utmCode === utmCode);
  }

  async getEmbedDeploymentsByAffiliate(affiliateId: string): Promise<EmbedDeployment[]> {
    return Array.from(this.embedDeploymentsMap.values()).filter(d => d.affiliateId === affiliateId);
  }

  async createEmbedDeployment(deployment: InsertEmbedDeployment): Promise<EmbedDeployment> {
    const id = randomUUID();
    const newDeploy: EmbedDeployment = { id, ...deployment, totalLoads: 1, firstSeenAt: new Date(), lastSeenAt: new Date(), referrerUrl: deployment.referrerUrl ?? null };
    this.embedDeploymentsMap.set(id, newDeploy);
    return newDeploy;
  }

  async incrementEmbedDeploymentLoads(id: string): Promise<EmbedDeployment | undefined> {
    const deploy = this.embedDeploymentsMap.get(id);
    if (!deploy) return undefined;
    const updated = { ...deploy, totalLoads: (deploy.totalLoads || 0) + 1, lastSeenAt: new Date() };
    this.embedDeploymentsMap.set(id, updated);
    return updated;
  }

  // Commission Transactions
  private commissionTransactionsMap: Map<string, CommissionTransaction> = new Map();

  async getCommissionTransactions(affiliateId: string): Promise<CommissionTransaction[]> {
    return Array.from(this.commissionTransactionsMap.values()).filter(t => t.affiliateId === affiliateId);
  }

  async getCommissionTransactionsByVideo(videoId: string): Promise<CommissionTransaction[]> {
    return Array.from(this.commissionTransactionsMap.values()).filter(t => t.videoId === videoId);
  }

  async createCommissionTransaction(transaction: InsertCommissionTransaction): Promise<CommissionTransaction> {
    const id = randomUUID();
    const newTx: CommissionTransaction = {
      id,
      affiliateId: transaction.affiliateId,
      analyticsEventId: transaction.analyticsEventId ?? null,
      videoId: transaction.videoId,
      productId: transaction.productId ?? null,
      saleAmount: transaction.saleAmount,
      commissionRate: transaction.commissionRate,
      commissionAmount: transaction.commissionAmount,
      status: "pending",
      campaignAffiliateId: transaction.campaignAffiliateId ?? null,
      licensePurchaseId: transaction.licensePurchaseId ?? null,
      createdAt: new Date(),
    };
    this.commissionTransactionsMap.set(id, newTx);
    return newTx;
  }

  async updateCommissionTransactionStatus(id: string, status: string): Promise<CommissionTransaction | undefined> {
    const tx = this.commissionTransactionsMap.get(id);
    if (!tx) return undefined;
    const updated = { ...tx, status: status as "pending" | "approved" | "paid" | "rejected" };
    this.commissionTransactionsMap.set(id, updated);
    return updated;
  }

  async getAffiliateEarningsFromLedger(affiliateId: string): Promise<{ totalSales: number; totalCommission: number; pendingCommission: number; approvedCommission: number; paidCommission: number; transactionCount: number }> {
    const txs = Array.from(this.commissionTransactionsMap.values()).filter(t => t.affiliateId === affiliateId);
    return {
      totalSales: txs.reduce((sum, t) => sum + parseFloat(t.saleAmount || "0"), 0),
      totalCommission: txs.reduce((sum, t) => sum + parseFloat(t.commissionAmount || "0"), 0),
      pendingCommission: txs.filter(t => t.status === "pending").reduce((sum, t) => sum + parseFloat(t.commissionAmount || "0"), 0),
      approvedCommission: txs.filter(t => t.status === "approved").reduce((sum, t) => sum + parseFloat(t.commissionAmount || "0"), 0),
      paidCommission: txs.filter(t => t.status === "paid").reduce((sum, t) => sum + parseFloat(t.commissionAmount || "0"), 0),
      transactionCount: txs.length,
    };
  }

  // UTM Resolution
  async resolveUtmToAffiliate(utmCode: string): Promise<{ affiliateId: string; campaignAffiliateId: string | null; videoId: string; commissionRate: string } | null> {
    const caMatch = Array.from(this.campaignAffiliates.values()).find(ca => ca.utmCode === utmCode);
    if (caMatch) {
      return { affiliateId: caMatch.affiliateId, campaignAffiliateId: caMatch.id, videoId: caMatch.videoId, commissionRate: caMatch.commissionRate || "10.00" };
    }

    const lpMatch = Array.from(this.videoLicensePurchases.values()).find(lp => lp.utmCode === utmCode);
    if (lpMatch) {
      const listing = Array.from(this.globalVideoLibrary.values()).find(g => g.id === lpMatch.globalListingId);
      if (listing) {
        return { affiliateId: lpMatch.affiliateId, campaignAffiliateId: null, videoId: listing.videoId, commissionRate: lpMatch.commissionRate || "10.00" };
      }
    }

    return null;
  }

  // Publisher Notifications & Publisher Management — MemStorage stubs
  private publisherNotificationsList: PublisherNotification[] = [];
  async getPublisherNotifications(affiliateId: string): Promise<PublisherNotification[]> {
    return this.publisherNotificationsList.filter(n => n.affiliateId === affiliateId).sort((a, b) => +new Date(b.createdAt!) - +new Date(a.createdAt!));
  }
  async createPublisherNotification(data: InsertPublisherNotification): Promise<PublisherNotification> {
    const n: PublisherNotification = { id: Date.now(), createdAt: new Date(), ...data } as any;
    this.publisherNotificationsList.push(n);
    return n;
  }
  async markPublisherNotificationRead(id: number): Promise<void> {
    const n = this.publisherNotificationsList.find(x => x.id === id);
    if (n) n.isRead = true;
  }
  async getUnreadNotificationCount(affiliateId: string): Promise<number> {
    return this.publisherNotificationsList.filter(n => n.affiliateId === affiliateId && !n.isRead).length;
  }
  async getCampaignDetail(campaignId: string): Promise<any> { return null; }
  async disableCampaignPublisher(campaignAffiliateId: string): Promise<CampaignAffiliate | undefined> { return undefined; }
  async extendCampaignPublisher(campaignAffiliateId: string, hours: number): Promise<CampaignAffiliate | undefined> { return undefined; }

  // Brand Billing & Account — MemStorage stubs (in-memory maps)
  private brandSubscriptionsMap: Map<string, BrandSubscription> = new Map();
  private brandBillingRecordsList: BrandBillingRecord[] = [];
  private brandPayoutMethodsMap: Map<string, BrandPayoutMethod> = new Map();
  private brandBillingProfilesMap: Map<string, BrandBillingProfile> = new Map();
  private brandApiKeysList: BrandApiKey[] = [];

  async getBrandSubscription(userId: string): Promise<BrandSubscription | undefined> {
    return this.brandSubscriptionsMap.get(userId);
  }
  async upsertBrandSubscription(data: InsertBrandSubscription): Promise<BrandSubscription> {
    const sub: BrandSubscription = { id: Date.now(), ...data } as any;
    this.brandSubscriptionsMap.set(data.userId, sub);
    return sub;
  }
  async getBrandBillingRecords(userId: string, type?: string): Promise<BrandBillingRecord[]> {
    return this.brandBillingRecordsList.filter(r => r.userId === userId && (!type || r.type === type));
  }
  async createBrandBillingRecord(data: InsertBrandBillingRecord): Promise<BrandBillingRecord> {
    const record: BrandBillingRecord = { id: Date.now(), createdAt: new Date(), ...data } as any;
    this.brandBillingRecordsList.push(record);
    return record;
  }
  async getBrandPayoutMethod(userId: string): Promise<BrandPayoutMethod | undefined> {
    return this.brandPayoutMethodsMap.get(userId);
  }
  async upsertBrandPayoutMethod(data: InsertBrandPayoutMethod): Promise<BrandPayoutMethod> {
    const method: BrandPayoutMethod = { id: Date.now(), updatedAt: new Date(), ...data } as any;
    this.brandPayoutMethodsMap.set(data.userId, method);
    return method;
  }
  async getBrandBillingProfile(userId: string): Promise<BrandBillingProfile | undefined> {
    return this.brandBillingProfilesMap.get(userId);
  }
  async upsertBrandBillingProfile(data: InsertBrandBillingProfile): Promise<BrandBillingProfile> {
    const profile: BrandBillingProfile = { id: Date.now(), updatedAt: new Date(), ...data } as any;
    this.brandBillingProfilesMap.set(data.userId, profile);
    return profile;
  }
  async getBrandApiKeys(userId: string): Promise<BrandApiKey[]> {
    return this.brandApiKeysList.filter(k => k.userId === userId && k.isActive);
  }
  async createBrandApiKey(data: InsertBrandApiKey): Promise<BrandApiKey> {
    const key: BrandApiKey = { id: Date.now(), createdAt: new Date(), lastUsedAt: null, ...data } as any;
    this.brandApiKeysList.push(key);
    return key;
  }
  async revokeBrandApiKey(id: number, userId: string): Promise<void> {
    const key = this.brandApiKeysList.find(k => k.id === id && k.userId === userId);
    if (key) key.isActive = false;
  }

  // Playlists (in-memory)
  private playlistsList: Playlist[] = [];
  private playlistItemsList: PlaylistItem[] = [];

  async getUserPlaylists(userId: string): Promise<Playlist[]> {
    return this.playlistsList.filter(p => p.userId === userId);
  }
  async getPlaylist(id: number): Promise<Playlist | undefined> {
    return this.playlistsList.find(p => p.id === id);
  }
  async createPlaylist(data: InsertPlaylist): Promise<Playlist> {
    const pl: Playlist = { id: Date.now(), createdAt: new Date(), status: "draft", stripePaymentIntentId: null, licenseFeeTotal: null, embedCode: null, publishedAt: null, ...data } as any;
    this.playlistsList.push(pl);
    return pl;
  }
  async updatePlaylist(id: number, data: Partial<Playlist>): Promise<Playlist | undefined> {
    const idx = this.playlistsList.findIndex(p => p.id === id);
    if (idx === -1) return undefined;
    this.playlistsList[idx] = { ...this.playlistsList[idx], ...data };
    return this.playlistsList[idx];
  }
  async deletePlaylist(id: number, userId: string): Promise<void> {
    this.playlistsList = this.playlistsList.filter(p => !(p.id === id && p.userId === userId));
    this.playlistItemsList = this.playlistItemsList.filter(i => i.playlistId !== id);
  }
  async getPlaylistItems(playlistId: number): Promise<PlaylistItem[]> {
    return this.playlistItemsList.filter(i => i.playlistId === playlistId);
  }
  async addPlaylistItems(items: InsertPlaylistItem[]): Promise<PlaylistItem[]> {
    const created = items.map(item => ({
      id: Date.now() + Math.random(),
      utmCode: crypto.randomUUID(),
      addedAt: new Date(),
      ...item,
    } as unknown as PlaylistItem));
    this.playlistItemsList.push(...created);
    return created;
  }
  async removePlaylistItem(id: number): Promise<void> {
    this.playlistItemsList = this.playlistItemsList.filter(i => i.id !== id);
  }

  private wishlistItems: Wishlist[] = [];

  async getUserWishlist(userId: string): Promise<Wishlist[]> {
    return this.wishlistItems.filter(w => w.userId === userId);
  }

  async addToWishlist(data: InsertWishlist): Promise<Wishlist> {
    const entry: Wishlist = { id: randomUUID(), createdAt: new Date(), ...data };
    this.wishlistItems.push(entry);
    return entry;
  }

  async removeFromWishlist(userId: string, globalListingId: string): Promise<void> {
    this.wishlistItems = this.wishlistItems.filter(
      w => !(w.userId === userId && w.globalListingId === globalListingId)
    );
  }

  async isInWishlist(userId: string, globalListingId: string): Promise<boolean> {
    return this.wishlistItems.some(w => w.userId === userId && w.globalListingId === globalListingId);
  }
}

// DatabaseStorage implementation using PostgreSQL
export class DatabaseStorage implements IStorage {
  // Users
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async getUserByStripeCustomerId(customerId: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.stripeCustomerId, customerId));
    return user;
  }

  async getUserByVerificationToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.emailVerificationToken, token));
    return user;
  }

  async createUser(user: InsertUser): Promise<User> {
    const [newUser] = await db.insert(users).values(user).returning();
    return newUser;
  }

  async updateUser(id: string, data: Partial<InsertUser>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return updated;
  }

  // Brands
  async getBrands(): Promise<Brand[]> {
    return db.select().from(brands);
  }

  async getBrand(id: string): Promise<Brand | undefined> {
    const [brand] = await db.select().from(brands).where(eq(brands.id, id));
    return brand;
  }

  async createBrand(brand: InsertBrand): Promise<Brand> {
    const [newBrand] = await db.insert(brands).values(brand).returning();
    return newBrand;
  }

  async updateBrand(id: string, data: Partial<InsertBrand>): Promise<Brand | undefined> {
    const [updated] = await db.update(brands).set(data).where(eq(brands.id, id)).returning();
    return updated;
  }

  // Products
  async getProducts(brandId?: string): Promise<Product[]> {
    if (brandId) {
      return db.select().from(products).where(eq(products.brandId, brandId));
    }
    return db.select().from(products);
  }

  async getProduct(id: string): Promise<Product | undefined> {
    const [product] = await db.select().from(products).where(eq(products.id, id));
    return product;
  }

  async createProduct(product: InsertProduct): Promise<Product> {
    const [newProduct] = await db.insert(products).values(product).returning();
    return newProduct;
  }

  // Videos
  async getVideos(creatorId?: string): Promise<Video[]> {
    if (creatorId) {
      return db.select().from(videos).where(eq(videos.creatorId, creatorId)).orderBy(desc(videos.createdAt));
    }
    return db.select().from(videos).orderBy(desc(videos.createdAt));
  }

  async getVideoCountByUser(userId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)::int` }).from(videos).where(eq(videos.creatorId, userId));
    return result[0]?.count ?? 0;
  }

  async getVideo(id: string): Promise<Video | undefined> {
    const [video] = await db.select().from(videos).where(eq(videos.id, id));
    return video;
  }

  async createVideo(video: InsertVideo): Promise<Video> {
    const [newVideo] = await db.insert(videos).values(video).returning();
    return newVideo;
  }

  async updateVideo(id: string, data: Partial<InsertVideo>): Promise<Video | undefined> {
    const [updated] = await db.update(videos).set(data).where(eq(videos.id, id)).returning();
    return updated;
  }

  async deleteVideo(id: string): Promise<boolean> {
    const result = await db.delete(videos).where(eq(videos.id, id));
    return true;
  }

  async getAllPublishedVideos(): Promise<Video[]> {
    return db.select().from(videos).where(eq(videos.status, "published"));
  }

  // Video-Brand associations
  async addVideoBrand(videoBrand: InsertVideoBrand): Promise<VideoBrand> {
    const [newVb] = await db.insert(videoBrands).values(videoBrand).returning();
    return newVb;
  }

  async getVideoBrands(videoId: string): Promise<VideoBrand[]> {
    return db.select().from(videoBrands).where(eq(videoBrands.videoId, videoId));
  }

  // Video-Product associations
  async addVideoProduct(videoProduct: InsertVideoProduct): Promise<VideoProduct> {
    const [newVp] = await db.insert(videoProducts).values(videoProduct).returning();
    return newVp;
  }

  async getVideoProducts(videoId: string): Promise<VideoProduct[]> {
    return db.select().from(videoProducts).where(eq(videoProducts.videoId, videoId));
  }

  // Brand Referrals
  async getReferrals(creatorId: string): Promise<BrandReferral[]> {
    return db.select().from(brandReferrals).where(eq(brandReferrals.creatorId, creatorId)).orderBy(desc(brandReferrals.createdAt));
  }

  async getReferral(id: string): Promise<BrandReferral | undefined> {
    const [referral] = await db.select().from(brandReferrals).where(eq(brandReferrals.id, id));
    return referral;
  }

  async createReferral(referral: InsertBrandReferral): Promise<BrandReferral> {
    const [newReferral] = await db.insert(brandReferrals).values(referral).returning();
    return newReferral;
  }

  async updateReferralStatus(id: string, status: string): Promise<BrandReferral | undefined> {
    const validStatus = status as "pending" | "sent" | "accepted" | "declined";
    const [updated] = await db.update(brandReferrals).set({ status: validStatus }).where(eq(brandReferrals.id, id)).returning();
    return updated;
  }

  // Brand Outreach
  async createBrandOutreach(outreach: InsertBrandOutreach): Promise<BrandOutreach> {
    const [created] = await db.insert(brandOutreachRequests).values(outreach).returning();
    return created;
  }

  async getBrandOutreach(id: string): Promise<BrandOutreach | undefined> {
    const [outreach] = await db.select().from(brandOutreachRequests).where(eq(brandOutreachRequests.id, id));
    return outreach;
  }

  async getBrandOutreachByToken(token: string): Promise<BrandOutreach | undefined> {
    const [outreach] = await db.select().from(brandOutreachRequests).where(eq(brandOutreachRequests.authToken, token));
    return outreach;
  }

  async getBrandOutreachesByCreator(creatorId: string): Promise<BrandOutreach[]> {
    return db.select().from(brandOutreachRequests)
      .where(eq(brandOutreachRequests.creatorId, creatorId))
      .orderBy(desc(brandOutreachRequests.createdAt));
  }

  async getAllBrandOutreaches(): Promise<BrandOutreach[]> {
    return db.select().from(brandOutreachRequests).orderBy(desc(brandOutreachRequests.createdAt));
  }

  async updateBrandOutreachStatus(id: string, status: string, authorizedAt?: Date): Promise<BrandOutreach | undefined> {
    const updateData: any = { status };
    if (authorizedAt) updateData.authorizedAt = authorizedAt;
    const [updated] = await db.update(brandOutreachRequests).set(updateData).where(eq(brandOutreachRequests.id, id)).returning();
    return updated;
  }

  async updateBrandOutreachAdmin(id: string, updates: Partial<Pick<BrandOutreach, "adminNotes" | "agreementStartedAt" | "agreementSignedAt" | "brandSubscribedAt" | "status">>): Promise<BrandOutreach | undefined> {
    const [updated] = await db.update(brandOutreachRequests).set(updates as any).where(eq(brandOutreachRequests.id, id)).returning();
    return updated;
  }

  async recordOutreachFollowUp(id: string, followUpType: string): Promise<BrandOutreach | undefined> {
    const existing = await this.getBrandOutreach(id);
    if (!existing) return undefined;
    const [updated] = await db.update(brandOutreachRequests).set({
      followUpCount: (existing.followUpCount ?? 0) + 1,
      lastFollowUpAt: new Date(),
      lastFollowUpType: followUpType as any,
    }).where(eq(brandOutreachRequests.id, id)).returning();
    return updated;
  }

  // Analytics
  async getAnalyticsEvents(videoId?: string): Promise<AnalyticsEvent[]> {
    if (videoId) {
      return db.select().from(analyticsEvents).where(eq(analyticsEvents.videoId, videoId));
    }
    return db.select().from(analyticsEvents);
  }

  async createAnalyticsEvent(event: InsertAnalyticsEvent): Promise<AnalyticsEvent> {
    const [newEvent] = await db.insert(analyticsEvents).values(event).returning();
    return newEvent;
  }

  async getVideoStats(creatorId: string): Promise<{ totalViews: number; totalClicks: number; totalRevenue: number; averageCTR: number }> {
    return { totalViews: 0, totalClicks: 0, totalRevenue: 0, averageCTR: 0 };
  }

  // Payouts
  async getPayouts(userId: string): Promise<AffiliatePayout[]> {
    return db.select().from(affiliatePayouts).where(eq(affiliatePayouts.userId, userId));
  }

  async createPayout(payout: InsertAffiliatePayout): Promise<AffiliatePayout> {
    const [newPayout] = await db.insert(affiliatePayouts).values(payout).returning();
    return newPayout;
  }

  // Campaigns
  async getCampaigns(brandId: string): Promise<Campaign[]> {
    return db.select().from(campaigns).where(eq(campaigns.brandId, brandId));
  }

  async getCampaign(id: string): Promise<Campaign | undefined> {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id));
    return campaign;
  }

  async createCampaign(campaign: InsertCampaign): Promise<Campaign> {
    const [newCampaign] = await db.insert(campaigns).values(campaign).returning();
    return newCampaign;
  }

  async updateCampaign(id: string, data: Partial<Campaign>): Promise<Campaign | undefined> {
    const [updated] = await db.update(campaigns).set(data).where(eq(campaigns.id, id)).returning();
    return updated;
  }

  async deleteCampaign(id: string): Promise<boolean> {
    await db.delete(campaigns).where(eq(campaigns.id, id));
    return true;
  }

  async getCampaignStats(brandId: string): Promise<{ totalCampaigns: number; activeCampaigns: number; totalBudget: number; totalSpent: number; totalRevenue: number; averageROI: number }> {
    const allCampaigns = await this.getCampaigns(brandId);
    return {
      totalCampaigns: allCampaigns.length,
      activeCampaigns: allCampaigns.filter(c => c.status === "active").length,
      totalBudget: allCampaigns.reduce((sum, c) => sum + parseFloat(c.budget || "0"), 0),
      totalSpent: 0,
      totalRevenue: 0,
      averageROI: 0,
    };
  }

  // Brand Kits
  async getBrandKit(userId: string): Promise<BrandKit | undefined> {
    const [kit] = await db.select().from(brandKits).where(eq(brandKits.userId, userId));
    return kit;
  }

  async createBrandKit(kit: InsertBrandKit): Promise<BrandKit> {
    const [newKit] = await db.insert(brandKits).values(kit).returning();
    return newKit;
  }

  async updateBrandKit(id: string, data: Partial<InsertBrandKit>): Promise<BrandKit | undefined> {
    const [updated] = await db.update(brandKits).set(data).where(eq(brandKits.id, id)).returning();
    return updated;
  }

  // Video Carousel Overrides
  async getVideoCarouselOverride(videoId: string): Promise<VideoCarouselOverride | undefined> {
    const [override] = await db.select().from(videoCarouselOverrides).where(eq(videoCarouselOverrides.videoId, videoId));
    return override;
  }

  async createVideoCarouselOverride(override: InsertVideoCarouselOverride): Promise<VideoCarouselOverride> {
    const [newOverride] = await db.insert(videoCarouselOverrides).values(override).returning();
    return newOverride;
  }

  async updateVideoCarouselOverride(videoId: string, data: Partial<InsertVideoCarouselOverride>): Promise<VideoCarouselOverride | undefined> {
    const [updated] = await db.update(videoCarouselOverrides).set(data).where(eq(videoCarouselOverrides.videoId, videoId)).returning();
    return updated;
  }

  // Video Detection Jobs
  async getDetectionJob(id: string): Promise<VideoDetectionJob | undefined> {
    const [job] = await db.select().from(videoDetectionJobs).where(eq(videoDetectionJobs.id, id));
    return job;
  }

  async getDetectionJobByVideoId(videoId: string): Promise<VideoDetectionJob | undefined> {
    const [job] = await db.select().from(videoDetectionJobs).where(eq(videoDetectionJobs.videoId, videoId));
    return job;
  }

  async createDetectionJob(job: InsertVideoDetectionJob): Promise<VideoDetectionJob> {
    const [newJob] = await db.insert(videoDetectionJobs).values(job).returning();
    return newJob;
  }

  async updateDetectionJob(id: string, data: Partial<VideoDetectionJob>): Promise<VideoDetectionJob | undefined> {
    const [updated] = await db.update(videoDetectionJobs).set(data).where(eq(videoDetectionJobs.id, id)).returning();
    return updated;
  }

  // Video Detection Results
  async getDetectionResults(jobId: string): Promise<VideoDetectionResult[]> {
    return db.select().from(videoDetectionResults).where(eq(videoDetectionResults.jobId, jobId));
  }

  async getDetectionResultsByVideo(videoId: string): Promise<VideoDetectionResult[]> {
    return db.select().from(videoDetectionResults).where(eq(videoDetectionResults.videoId, videoId));
  }

  async createDetectionResult(result: InsertVideoDetectionResult): Promise<VideoDetectionResult> {
    const [newResult] = await db.insert(videoDetectionResults).values(result).returning();
    return newResult;
  }

  // Video Product Overlays
  async getVideoProductOverlays(videoId: string): Promise<VideoProductOverlay[]> {
    return db.select().from(videoProductOverlays).where(eq(videoProductOverlays.videoId, videoId)).orderBy(videoProductOverlays.id);
  }
  async createVideoProductOverlay(overlay: InsertVideoProductOverlay): Promise<VideoProductOverlay> {
    const [created] = await db.insert(videoProductOverlays).values(overlay).returning();
    return created;
  }
  async updateVideoProductOverlay(id: number, data: Partial<InsertVideoProductOverlay>): Promise<VideoProductOverlay | undefined> {
    const [updated] = await db.update(videoProductOverlays).set(data).where(eq(videoProductOverlays.id, id)).returning();
    return updated;
  }
  async deleteVideoProductOverlay(id: number): Promise<void> {
    await db.delete(videoProductOverlays).where(eq(videoProductOverlays.id, id));
  }

  // Creator Invitations
  async getCreatorInvitations(brandId: string): Promise<CreatorInvitation[]> {
    return db.select().from(creatorInvitations).where(eq(creatorInvitations.brandId, brandId)).orderBy(desc(creatorInvitations.invitedAt));
  }

  async createCreatorInvitation(invitation: InsertCreatorInvitation): Promise<CreatorInvitation> {
    const [newInvitation] = await db.insert(creatorInvitations).values(invitation).returning();
    return newInvitation;
  }

  async createCreatorInvitationsBulk(invitations: InsertCreatorInvitation[]): Promise<CreatorInvitation[]> {
    if (invitations.length === 0) return [];
    return db.insert(creatorInvitations).values(invitations).returning();
  }

  async updateCreatorInvitationStatus(id: string, status: string): Promise<CreatorInvitation | undefined> {
    const [updated] = await db.update(creatorInvitations).set({ status: status as "pending" | "sent" | "accepted" | "declined" }).where(eq(creatorInvitations.id, id)).returning();
    return updated;
  }

  // Affiliate Invitations
  async getAffiliateInvitations(inviterId: string): Promise<AffiliateInvitation[]> {
    return db.select().from(affiliateInvitations).where(eq(affiliateInvitations.inviterId, inviterId)).orderBy(desc(affiliateInvitations.createdAt));
  }

  async getAffiliateInvitationByToken(token: string): Promise<AffiliateInvitation | undefined> {
    const [invitation] = await db.select().from(affiliateInvitations).where(eq(affiliateInvitations.inviteToken, token));
    return invitation;
  }

  async createAffiliateInvitation(invitation: InsertAffiliateInvitation): Promise<AffiliateInvitation> {
    const [newInvitation] = await db.insert(affiliateInvitations).values(invitation).returning();
    return newInvitation;
  }

  async createAffiliateInvitationsBulk(invitations: InsertAffiliateInvitation[]): Promise<AffiliateInvitation[]> {
    if (invitations.length === 0) return [];
    return db.insert(affiliateInvitations).values(invitations).returning();
  }

  async updateAffiliateInvitationStatus(id: string, status: string, acceptedByUserId?: string): Promise<AffiliateInvitation | undefined> {
    const updateData: Partial<AffiliateInvitation> = { status: status as "pending" | "sent" | "accepted" | "declined" };
    if (acceptedByUserId) updateData.acceptedByUserId = acceptedByUserId;
    const [updated] = await db.update(affiliateInvitations).set(updateData).where(eq(affiliateInvitations.id, id)).returning();
    return updated;
  }

  // Campaign Affiliates
  async getCampaignAffiliates(videoId: string): Promise<CampaignAffiliate[]> {
    return db.select().from(campaignAffiliates).where(eq(campaignAffiliates.videoId, videoId));
  }

  async getCampaignAffiliatesByUser(affiliateId: string): Promise<CampaignAffiliate[]> {
    return db.select().from(campaignAffiliates).where(eq(campaignAffiliates.affiliateId, affiliateId));
  }

  async createCampaignAffiliate(assignment: InsertCampaignAffiliate): Promise<CampaignAffiliate> {
    const [newAssignment] = await db.insert(campaignAffiliates).values(assignment).returning();
    return newAssignment;
  }

  async updateCampaignAffiliateStats(id: string, stats: Partial<CampaignAffiliate>): Promise<CampaignAffiliate | undefined> {
    const [updated] = await db.update(campaignAffiliates).set(stats).where(eq(campaignAffiliates.id, id)).returning();
    return updated;
  }

  async getAffiliatePublishersAnalytics(): Promise<{
    id: string;
    affiliateId: string;
    affiliateName: string;
    affiliateEmail: string;
    totalClicks: number;
    totalConversions: number;
    totalRevenue: string;
    totalEarnings: string;
    campaignCount: number;
  }[]> {
    const results = await db
      .select({
        affiliateId: campaignAffiliates.affiliateId,
        totalClicks: sql<number>`COALESCE(SUM(${campaignAffiliates.totalClicks}), 0)::int`,
        totalConversions: sql<number>`COALESCE(SUM(${campaignAffiliates.totalConversions}), 0)::int`,
        totalRevenue: sql<string>`COALESCE(SUM(${campaignAffiliates.totalRevenue}), 0)::text`,
        totalEarnings: sql<string>`COALESCE(SUM(${campaignAffiliates.totalEarnings}), 0)::text`,
        campaignCount: sql<number>`COUNT(*)::int`,
        affiliateName: users.displayName,
        affiliateEmail: users.email,
      })
      .from(campaignAffiliates)
      .leftJoin(users, eq(campaignAffiliates.affiliateId, users.id))
      .groupBy(campaignAffiliates.affiliateId, users.displayName, users.email);

    return results.map(r => ({
      id: r.affiliateId,
      affiliateId: r.affiliateId,
      affiliateName: r.affiliateName || "Unknown",
      affiliateEmail: r.affiliateEmail || "",
      totalClicks: r.totalClicks,
      totalConversions: r.totalConversions,
      totalRevenue: r.totalRevenue,
      totalEarnings: r.totalEarnings,
      campaignCount: r.campaignCount,
    }));
  }

  // Global Video Library
  async getGlobalVideoListings(category?: string): Promise<GlobalVideoLibrary[]> {
    if (category) {
      return db.select().from(globalVideoLibrary).where(eq(globalVideoLibrary.category, category));
    }
    return db.select().from(globalVideoLibrary);
  }

  async getGlobalVideoListing(id: string): Promise<GlobalVideoLibrary | undefined> {
    const [listing] = await db.select().from(globalVideoLibrary).where(eq(globalVideoLibrary.id, id));
    return listing;
  }

  async getGlobalVideoListingByVideo(videoId: string): Promise<GlobalVideoLibrary | undefined> {
    const [listing] = await db.select().from(globalVideoLibrary).where(eq(globalVideoLibrary.videoId, videoId));
    return listing;
  }

  async createGlobalVideoListing(listing: InsertGlobalVideoLibrary): Promise<GlobalVideoLibrary> {
    const [newListing] = await db.insert(globalVideoLibrary).values(listing).returning();
    return newListing;
  }

  async updateGlobalVideoListing(id: string, data: Partial<GlobalVideoLibrary>): Promise<GlobalVideoLibrary | undefined> {
    const [updated] = await db.update(globalVideoLibrary).set(data).where(eq(globalVideoLibrary.id, id)).returning();
    return updated;
  }

  // Video License Purchases
  async getVideoLicensePurchases(affiliateId: string): Promise<VideoLicensePurchase[]> {
    return db.select().from(videoLicensePurchases).where(eq(videoLicensePurchases.affiliateId, affiliateId));
  }

  async getVideoLicensePurchase(id: string): Promise<VideoLicensePurchase | undefined> {
    const [purchase] = await db.select().from(videoLicensePurchases).where(eq(videoLicensePurchases.id, id));
    return purchase;
  }

  async createVideoLicensePurchase(purchase: InsertVideoLicensePurchase): Promise<VideoLicensePurchase> {
    const [newPurchase] = await db.insert(videoLicensePurchases).values(purchase).returning();
    return newPurchase;
  }

  async updateVideoLicensePurchaseStatus(id: string, status: string, paymentIntentId?: string): Promise<VideoLicensePurchase | undefined> {
    const updateData: Partial<VideoLicensePurchase> = { status: status as "pending" | "paid" | "failed" | "refunded" };
    if (paymentIntentId) updateData.stripePaymentIntentId = paymentIntentId;
    if (status === "paid") updateData.purchasedAt = new Date();
    const [updated] = await db.update(videoLicensePurchases).set(updateData).where(eq(videoLicensePurchases.id, id)).returning();
    return updated;
  }

  // Video Publish Records
  async getVideoPublishRecord(videoId: string): Promise<VideoPublishRecord | undefined> {
    const [record] = await db.select().from(videoPublishRecords).where(eq(videoPublishRecords.videoId, videoId));
    return record;
  }

  async createVideoPublishRecord(record: InsertVideoPublishRecord): Promise<VideoPublishRecord> {
    const [newRecord] = await db.insert(videoPublishRecords).values(record).returning();
    return newRecord;
  }

  async updateVideoPublishRecord(id: string, data: Partial<VideoPublishRecord>): Promise<VideoPublishRecord | undefined> {
    const [updated] = await db.update(videoPublishRecords).set(data).where(eq(videoPublishRecords.id, id)).returning();
    return updated;
  }

  // Subscriber Intakes
  async createSubscriberIntake(intake: InsertSubscriberIntake): Promise<SubscriberIntake> {
    const [newIntake] = await db.insert(subscriberIntakes).values(intake).returning();
    return newIntake;
  }

  async getSubscriberIntakes(): Promise<SubscriberIntake[]> {
    return db.select().from(subscriberIntakes).orderBy(desc(subscriberIntakes.createdAt));
  }

  async getSubscriberIntakeByEmail(email: string): Promise<SubscriberIntake | undefined> {
    const [intake] = await db.select().from(subscriberIntakes).where(eq(subscriberIntakes.email, email));
    return intake;
  }

  // User Profiles
  async getUserProfile(userId: string): Promise<UserProfile | undefined> {
    const [profile] = await db.select().from(userProfiles).where(eq(userProfiles.userId, userId));
    return profile;
  }

  async createUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const [newProfile] = await db.insert(userProfiles).values(profile).returning();
    return newProfile;
  }

  async updateUserProfile(userId: string, data: Partial<InsertUserProfile>): Promise<UserProfile | undefined> {
    const existing = await this.getUserProfile(userId);
    if (existing) {
      const [updated] = await db.update(userProfiles).set({ ...data, updatedAt: new Date() }).where(eq(userProfiles.userId, userId)).returning();
      return updated;
    } else {
      return this.createUserProfile({ userId, ...data });
    }
  }

  // Creator Rewards
  async getCreatorRewards(creatorId: string): Promise<CreatorReward[]> {
    return db.select().from(creatorRewards).where(eq(creatorRewards.creatorId, creatorId)).orderBy(desc(creatorRewards.earnedAt));
  }

  async getCreatorRewardsSummary(creatorId: string): Promise<{ totalCredits: number; availableCredits: number; redeemedCredits: number; euroValue: number }> {
    const rewards = await this.getCreatorRewards(creatorId);
    const totalCredits = rewards.reduce((sum, r) => sum + (r.creditsAmount || 0), 0);
    const redeemedCredits = rewards.filter(r => r.status === "redeemed").reduce((sum, r) => sum + (r.creditsAmount || 0), 0);
    const availableCredits = rewards.filter(r => r.status === "credited").reduce((sum, r) => sum + (r.creditsAmount || 0), 0);
    const euroValue = availableCredits; // 1 credit = €1
    return { totalCredits, availableCredits, redeemedCredits, euroValue };
  }

  async createCreatorReward(reward: InsertCreatorReward): Promise<CreatorReward> {
    const [newReward] = await db.insert(creatorRewards).values(reward).returning();
    return newReward;
  }

  async redeemCreatorReward(rewardId: string, listingId: string): Promise<CreatorReward | undefined> {
    const [updated] = await db.update(creatorRewards).set({
      status: "redeemed",
      redeemedForListingId: listingId,
      redeemedAt: new Date(),
    }).where(eq(creatorRewards.id, rewardId)).returning();
    return updated;
  }

  // Embed Deployments
  async getEmbedDeployment(affiliateId: string, videoId: string, referrerDomain: string, utmCode: string): Promise<EmbedDeployment | undefined> {
    const [deploy] = await db.select().from(embedDeployments)
      .where(sql`${embedDeployments.affiliateId} = ${affiliateId} AND ${embedDeployments.videoId} = ${videoId} AND ${embedDeployments.referrerDomain} = ${referrerDomain} AND ${embedDeployments.utmCode} = ${utmCode}`);
    return deploy;
  }

  async getEmbedDeploymentsByAffiliate(affiliateId: string): Promise<EmbedDeployment[]> {
    return db.select().from(embedDeployments).where(eq(embedDeployments.affiliateId, affiliateId));
  }

  async createEmbedDeployment(deployment: InsertEmbedDeployment): Promise<EmbedDeployment> {
    const [newDeploy] = await db.insert(embedDeployments).values(deployment).returning();
    return newDeploy;
  }

  async incrementEmbedDeploymentLoads(id: string): Promise<EmbedDeployment | undefined> {
    const [updated] = await db.update(embedDeployments).set({
      totalLoads: sql`COALESCE(${embedDeployments.totalLoads}, 0) + 1`,
      lastSeenAt: new Date(),
    }).where(eq(embedDeployments.id, id)).returning();
    return updated;
  }

  // Commission Transactions
  async getCommissionTransactions(affiliateId: string): Promise<CommissionTransaction[]> {
    return db.select().from(commissionTransactions).where(eq(commissionTransactions.affiliateId, affiliateId)).orderBy(desc(commissionTransactions.createdAt));
  }

  async getCommissionTransactionsByVideo(videoId: string): Promise<CommissionTransaction[]> {
    return db.select().from(commissionTransactions).where(eq(commissionTransactions.videoId, videoId)).orderBy(desc(commissionTransactions.createdAt));
  }

  async createCommissionTransaction(transaction: InsertCommissionTransaction): Promise<CommissionTransaction> {
    const [newTx] = await db.insert(commissionTransactions).values(transaction).returning();
    return newTx;
  }

  async updateCommissionTransactionStatus(id: string, status: string): Promise<CommissionTransaction | undefined> {
    const [updated] = await db.update(commissionTransactions).set({ status: status as "pending" | "approved" | "paid" | "rejected" }).where(eq(commissionTransactions.id, id)).returning();
    return updated;
  }

  async getAffiliateEarningsFromLedger(affiliateId: string): Promise<{ totalSales: number; totalCommission: number; pendingCommission: number; approvedCommission: number; paidCommission: number; transactionCount: number }> {
    const [result] = await db.select({
      totalSales: sql<number>`COALESCE(SUM(${commissionTransactions.saleAmount}), 0)::float`,
      totalCommission: sql<number>`COALESCE(SUM(${commissionTransactions.commissionAmount}), 0)::float`,
      pendingCommission: sql<number>`COALESCE(SUM(CASE WHEN ${commissionTransactions.status} = 'pending' THEN ${commissionTransactions.commissionAmount} ELSE 0 END), 0)::float`,
      approvedCommission: sql<number>`COALESCE(SUM(CASE WHEN ${commissionTransactions.status} = 'approved' THEN ${commissionTransactions.commissionAmount} ELSE 0 END), 0)::float`,
      paidCommission: sql<number>`COALESCE(SUM(CASE WHEN ${commissionTransactions.status} = 'paid' THEN ${commissionTransactions.commissionAmount} ELSE 0 END), 0)::float`,
      transactionCount: sql<number>`COUNT(*)::int`,
    }).from(commissionTransactions).where(eq(commissionTransactions.affiliateId, affiliateId));
    return result || { totalSales: 0, totalCommission: 0, pendingCommission: 0, approvedCommission: 0, paidCommission: 0, transactionCount: 0 };
  }

  // UTM Resolution - looks up a UTM code across campaignAffiliates and videoLicensePurchases
  async resolveUtmToAffiliate(utmCode: string): Promise<{ affiliateId: string; campaignAffiliateId: string | null; videoId: string; commissionRate: string } | null> {
    const [caMatch] = await db.select({
      affiliateId: campaignAffiliates.affiliateId,
      id: campaignAffiliates.id,
      videoId: campaignAffiliates.videoId,
      commissionRate: campaignAffiliates.commissionRate,
    }).from(campaignAffiliates).where(eq(campaignAffiliates.utmCode, utmCode));
    if (caMatch) {
      return { affiliateId: caMatch.affiliateId, campaignAffiliateId: caMatch.id, videoId: caMatch.videoId, commissionRate: caMatch.commissionRate || "10.00" };
    }

    const [lpMatch] = await db.select({
      affiliateId: videoLicensePurchases.affiliateId,
      videoId: globalVideoLibrary.videoId,
      utmCode: videoLicensePurchases.utmCode,
      commissionRate: videoLicensePurchases.commissionRate,
    }).from(videoLicensePurchases)
      .leftJoin(globalVideoLibrary, eq(videoLicensePurchases.globalListingId, globalVideoLibrary.id))
      .where(eq(videoLicensePurchases.utmCode, utmCode));
    if (lpMatch && lpMatch.videoId) {
      return { affiliateId: lpMatch.affiliateId, campaignAffiliateId: null, videoId: lpMatch.videoId, commissionRate: lpMatch.commissionRate || "10.00" };
    }

    return null;
  }

  // Publisher Notifications — DatabaseStorage implementations
  async getPublisherNotifications(affiliateId: string): Promise<PublisherNotification[]> {
    return db.select().from(publisherNotifications)
      .where(eq(publisherNotifications.affiliateId, affiliateId))
      .orderBy(desc(publisherNotifications.createdAt));
  }
  async createPublisherNotification(data: InsertPublisherNotification): Promise<PublisherNotification> {
    const [n] = await db.insert(publisherNotifications).values(data).returning();
    return n;
  }
  async markPublisherNotificationRead(id: number): Promise<void> {
    await db.update(publisherNotifications).set({ isRead: true }).where(eq(publisherNotifications.id, id));
  }
  async getUnreadNotificationCount(affiliateId: string): Promise<number> {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(publisherNotifications)
      .where(and(eq(publisherNotifications.affiliateId, affiliateId), eq(publisherNotifications.isRead, false)));
    return count;
  }
  async getCampaignDetail(campaignId: string): Promise<any> {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!campaign) return null;
    const affiliateRows = await db.select().from(campaignAffiliates).where(eq(campaignAffiliates.videoId, campaign.videoId ?? ""));
    // Enrich affiliates with user info
    const enriched = await Promise.all(affiliateRows.map(async (ca) => {
      const [user] = await db.select({ id: users.id, name: users.name, email: users.email }).from(users).where(eq(users.id, ca.affiliateId));
      return { ...ca, user };
    }));
    return { ...campaign, affiliates: enriched };
  }
  async disableCampaignPublisher(campaignAffiliateId: string): Promise<CampaignAffiliate | undefined> {
    const [updated] = await db.update(campaignAffiliates)
      .set({ isDisabled: true, disabledAt: new Date() })
      .where(eq(campaignAffiliates.id, campaignAffiliateId))
      .returning();
    return updated;
  }
  async extendCampaignPublisher(campaignAffiliateId: string, hours: number): Promise<CampaignAffiliate | undefined> {
    const graceUntil = new Date(Date.now() + hours * 60 * 60 * 1000);
    const [updated] = await db.update(campaignAffiliates)
      .set({ isDisabled: false, graceUntil })
      .where(eq(campaignAffiliates.id, campaignAffiliateId))
      .returning();
    return updated;
  }

  // Brand Billing & Account — DatabaseStorage implementations
  async getBrandSubscription(userId: string): Promise<BrandSubscription | undefined> {
    const [sub] = await db.select().from(brandSubscriptions).where(eq(brandSubscriptions.userId, userId));
    return sub;
  }
  async upsertBrandSubscription(data: InsertBrandSubscription): Promise<BrandSubscription> {
    const [existing] = await db.select().from(brandSubscriptions).where(eq(brandSubscriptions.userId, data.userId));
    if (existing) {
      const [updated] = await db.update(brandSubscriptions).set(data).where(eq(brandSubscriptions.userId, data.userId)).returning();
      return updated;
    }
    const [created] = await db.insert(brandSubscriptions).values(data).returning();
    return created;
  }
  async getBrandBillingRecords(userId: string, type?: string): Promise<BrandBillingRecord[]> {
    if (type) {
      return db.select().from(brandBillingRecords)
        .where(eq(brandBillingRecords.userId, userId))
        .orderBy(desc(brandBillingRecords.createdAt));
    }
    return db.select().from(brandBillingRecords)
      .where(eq(brandBillingRecords.userId, userId))
      .orderBy(desc(brandBillingRecords.createdAt));
  }
  async createBrandBillingRecord(data: InsertBrandBillingRecord): Promise<BrandBillingRecord> {
    const [record] = await db.insert(brandBillingRecords).values(data).returning();
    return record;
  }
  async getBrandPayoutMethod(userId: string): Promise<BrandPayoutMethod | undefined> {
    const [method] = await db.select().from(brandPayoutMethods).where(eq(brandPayoutMethods.userId, userId));
    return method;
  }
  async upsertBrandPayoutMethod(data: InsertBrandPayoutMethod): Promise<BrandPayoutMethod> {
    const [existing] = await db.select().from(brandPayoutMethods).where(eq(brandPayoutMethods.userId, data.userId));
    if (existing) {
      const [updated] = await db.update(brandPayoutMethods).set({ ...data, updatedAt: new Date() }).where(eq(brandPayoutMethods.userId, data.userId)).returning();
      return updated;
    }
    const [created] = await db.insert(brandPayoutMethods).values(data).returning();
    return created;
  }
  async getBrandBillingProfile(userId: string): Promise<BrandBillingProfile | undefined> {
    const [profile] = await db.select().from(brandBillingProfiles).where(eq(brandBillingProfiles.userId, userId));
    return profile;
  }
  async upsertBrandBillingProfile(data: InsertBrandBillingProfile): Promise<BrandBillingProfile> {
    const [existing] = await db.select().from(brandBillingProfiles).where(eq(brandBillingProfiles.userId, data.userId));
    if (existing) {
      const [updated] = await db.update(brandBillingProfiles).set({ ...data, updatedAt: new Date() }).where(eq(brandBillingProfiles.userId, data.userId)).returning();
      return updated;
    }
    const [created] = await db.insert(brandBillingProfiles).values(data).returning();
    return created;
  }
  async getBrandApiKeys(userId: string): Promise<BrandApiKey[]> {
    return db.select().from(brandApiKeys)
      .where(eq(brandApiKeys.userId, userId))
      .orderBy(desc(brandApiKeys.createdAt));
  }
  async createBrandApiKey(data: InsertBrandApiKey): Promise<BrandApiKey> {
    const [key] = await db.insert(brandApiKeys).values(data).returning();
    return key;
  }
  async revokeBrandApiKey(id: number, userId: string): Promise<void> {
    await db.update(brandApiKeys).set({ isActive: false }).where(eq(brandApiKeys.id, id));
  }

  // Playlists — DatabaseStorage
  async getUserPlaylists(userId: string): Promise<Playlist[]> {
    return db.select().from(playlists).where(eq(playlists.userId, userId)).orderBy(playlists.createdAt);
  }
  async getPlaylist(id: number): Promise<Playlist | undefined> {
    const [pl] = await db.select().from(playlists).where(eq(playlists.id, id));
    return pl;
  }
  async createPlaylist(data: InsertPlaylist): Promise<Playlist> {
    const [pl] = await db.insert(playlists).values(data).returning();
    return pl;
  }
  async updatePlaylist(id: number, data: Partial<Playlist>): Promise<Playlist | undefined> {
    const [pl] = await db.update(playlists).set(data).where(eq(playlists.id, id)).returning();
    return pl;
  }
  async deletePlaylist(id: number, userId: string): Promise<void> {
    await db.delete(playlistItems).where(eq(playlistItems.playlistId, id));
    await db.delete(playlists).where(and(eq(playlists.id, id), eq(playlists.userId, userId)));
  }
  async getPlaylistItems(playlistId: number): Promise<PlaylistItem[]> {
    return db.select().from(playlistItems).where(eq(playlistItems.playlistId, playlistId)).orderBy(playlistItems.addedAt);
  }
  async addPlaylistItems(items: InsertPlaylistItem[]): Promise<PlaylistItem[]> {
    if (items.length === 0) return [];
    return db.insert(playlistItems).values(items).returning();
  }
  async removePlaylistItem(id: number): Promise<void> {
    await db.delete(playlistItems).where(eq(playlistItems.id, id));
  }

  async getUserWishlist(userId: string): Promise<Wishlist[]> {
    return db.select().from(wishlists).where(eq(wishlists.userId, userId));
  }

  async addToWishlist(data: InsertWishlist): Promise<Wishlist> {
    const [entry] = await db.insert(wishlists).values(data).returning();
    return entry;
  }

  async removeFromWishlist(userId: string, globalListingId: string): Promise<void> {
    await db.delete(wishlists).where(
      and(eq(wishlists.userId, userId), eq(wishlists.globalListingId, globalListingId))
    );
  }

  async isInWishlist(userId: string, globalListingId: string): Promise<boolean> {
    const [entry] = await db.select().from(wishlists).where(
      and(eq(wishlists.userId, userId), eq(wishlists.globalListingId, globalListingId))
    );
    return !!entry;
  }
}

// Initialize database storage
const storage = new DatabaseStorage();

export { storage };
