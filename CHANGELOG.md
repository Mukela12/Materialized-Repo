# Video Commerce Engine — Change Log

## Migration from Replit to Railway + Vercel

This document summarizes all changes made since the project was cloned from Replit and migrated to a production deployment on Railway (backend) and Vercel (frontend).

**Live URLs:**
- Frontend: https://materialized-app.vercel.app
- Backend API: https://backend-production-93717.up.railway.app
- GitHub: https://github.com/Mukela12/Materialized-Repo

**Test Accounts:**
- Creator: jessekatungu@gmail.com / Milan18$
- Brand: codelibrary21@gmail.com / Milan18$
- Affiliate: affiliate@test.com / Milan18$
- Admin: mukelathegreat@gmail.com (has admin flag)

---

## What's Working

### Authentication & Accounts
- [x] Email/password registration with role selection (Creator, Brand, Affiliate)
- [x] Email verification via Resend (branded email template with Materialized logo)
- [x] Login with email verification check (unverified accounts blocked)
- [x] Case-insensitive email login (Jessekatungu = jessekatungu)
- [x] Session-based auth with PostgreSQL session store
- [x] Role-based routing (Creator -> /creator, Brand -> /brand, Affiliate -> /affiliate)
- [x] Admin accounts with isAdmin flag

### Creator Portal (/creator)
- [x] Dashboard with real stats (views, clicks, revenue, CTR)
- [x] Video upload to Cloudinary with progress tracking
- [x] Video management (create, edit, delete)
- [x] Carousel customisation editor with live video preview
- [x] Global Video Library browsing with category filters
- [x] Playlists (create, add items, delete)
- [x] Wishlist (add/remove videos)
- [x] Affiliate invite (single + bulk CSV import)
- [x] Brand referral system
- [x] Rewards tracking
- [x] Analytics (real stats from database, no mock data)
- [x] Brand Kit customisation
- [x] Mailbox (real notifications from outreach/invitations)
- [x] Embed code modal with live iframe preview + copy buttons

### Brand Portal (/brand)
- [x] Dashboard with real stats from analytics_events table
- [x] Product inventory management (manual add with thumbnail upload)
- [x] Shopify integration (connect store, sync products)
- [x] WooCommerce integration (connect store, sync products)
- [x] Creator network management (invite creators)
- [x] Campaign management (create, edit, delete campaigns)
- [x] Campaign detail view with publisher management
- [x] Video library browsing
- [x] Playlists and Wishlist
- [x] Brand Kit with PDF guideline extraction
- [x] Mailbox (real notifications from creator invitations)
- [x] Settings: Subscription, Billing History, Transactions, Payout, Billing Address, API Keys
- [x] Billing history and transactions show real records (no mock data)

### Affiliate/Publisher Portal (/affiliate)
- [x] Dashboard with real earnings, campaigns, clicks, conversions
- [x] Video Library for browsing licensable videos
- [x] Campaign management with embed codes
- [x] Analytics (publisher view with real embed deployment data)
- [x] Payout Settings with Stripe Connect integration (ready when Stripe keys added)
- [x] Playlists and Wishlist
- [x] Brand Kit
- [x] Mailbox (real notifications from publisher_notifications table)

### Admin Dashboard (/admin)
- [x] Overview: total users, videos, brands, campaigns, subscriptions, role breakdown
- [x] User Management: table with Make Admin / Grant Free actions
- [x] Videos: all videos with creator name, status, views, clicks, revenue
- [x] Brands: all brands with category, website, active status
- [x] Pipeline: brand outreach CRM with follow-up emails, notes, stage tracking

### Video Embed System
- [x] Embed iframe page: GET /embed/:videoId — full-screen video player with product overlay
- [x] Embed widget.js: GET /embed/:videoId/widget.js — embeddable JavaScript for external sites
- [x] Product overlay carousel with responsive sizing (clamp CSS for mobile/desktop)
- [x] Loading spinner while video loads
- [x] Play button fallback when autoplay is blocked
- [x] Cloudinary video optimization (q_auto, f_auto, w_720)
- [x] UTM tracking on all embed loads (view events sent to analytics)
- [x] Product click tracking (click events with UTM attribution)
- [x] Embed code modal with live preview + copy to clipboard

### UTM & Affiliate Tracking
- [x] UTM code auto-generated per video and per affiliate assignment
- [x] UTM resolution: looks up campaign_affiliates then video_license_purchases
- [x] Analytics events: POST /api/analytics/events tracks views, clicks, purchases
- [x] Commission calculation: revenue * commission_rate on purchase events
- [x] Embed deployment tracking: records which domains load the embed
- [x] Affiliate earnings ledger with status breakdown (pending/approved/paid)

### Email System (Resend)
- [x] Verification email (branded, with verify button)
- [x] Brand outreach email
- [x] Brand agreement email (DocuSign link)
- [x] DocuSign reminder email
- [x] Video results excitement email
- [x] Global pitch email
- [x] Subscription nudge email
- [x] Contact enquiry email

### Media (Cloudinary)
- [x] Video upload to Cloudinary with signed params
- [x] Image upload for product thumbnails
- [x] Landing page videos hosted on Cloudinary CDN
- [x] Optimized video URLs for embed streaming (q_auto, f_auto, w_720)

### Database (Railway PostgreSQL)
- [x] 37 tables fully deployed via Drizzle ORM
- [x] Session table for express-session
- [x] All storage methods use DatabaseStorage (no in-memory)

---

## What's NOT Working (Requires Client Setup)

### Stripe Payments
- [ ] Stripe API keys not configured (STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY empty)
- [ ] Subscription checkout will fail until keys are added
- [ ] Stripe Connect for affiliate payouts will fail
- [ ] Webhook endpoint exists but STRIPE_WEBHOOK_SECRET not set
- **To fix:** Add Stripe keys as Railway environment variables

### AI Product Detection (Gemini)
- [ ] AI_INTEGRATIONS_GEMINI_API_KEY not configured
- [ ] Video frame analysis for auto-detecting products won't work
- **To fix:** Add Gemini API key as Railway environment variable

### Resend Email Domain
- [ ] Currently using degreedesk.app (developer test domain)
- [ ] Client needs to add their own domain to Resend and update RESEND_FROM_EMAIL
- **To fix:** Add domain in Resend dashboard, update Railway env var

---

## Infrastructure Changes

| Component | Before (Replit) | After (Production) |
|-----------|----------------|-------------------|
| Database | In-memory (MemStorage) | Railway PostgreSQL |
| Email | Gmail SMTP (Nodemailer) | Resend API |
| Media | Replit Object Storage | Cloudinary |
| Payments | Replit Connectors API | Direct Stripe env vars (ready) |
| Frontend | Same server | Vercel (CDN, auto-deploy) |
| Backend | Same server | Railway (Node.js, auto-deploy) |
| Auth | Demo user fallback | Real session auth + email verification |

## Code Cleanup

- Removed 9 dead code files (chat integration, image integration, unused components)
- Removed 14 unused shadcn/ui components
- Removed 15 unused npm dependencies (nodemailer, passport, memorystore, etc)
- Removed all 33 demo_creator fallbacks from routes
- Removed all hardcoded mock data from analytics, billing, dashboard
- Removed Replit-specific plugins and integrations
- Added requireAuth/requireAdmin/requireRole middleware
- Added case-insensitive email login
- Fixed brand sidebar logo size (200px -> 28px)
- Fixed responsive embed overlay for mobile/desktop
