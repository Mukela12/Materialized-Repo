# Video Commerce SaaS Platform

## Overview

This is a Video Commerce SaaS platform that enables content creators to upload videos, tag brand products, and earn affiliate commissions. The platform features AI-powered product detection, affiliate link management, brand referral systems, and comprehensive analytics. It's built as a mobile-first application with iOS-inspired design principles.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript, using Vite as the build tool
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack React Query for server state management and caching
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with custom design tokens for theming (light/dark mode support)
- **Design System**: iOS-inspired mobile-first design with a responsive sidebar for desktop and bottom tab navigation for mobile

### Backend Architecture
- **Runtime**: Node.js with Express.js
- **API Design**: RESTful API endpoints under `/api/*` prefix
- **Database ORM**: Drizzle ORM with PostgreSQL
- **File Uploads**: Uppy with AWS S3-compatible presigned URL upload flow via Google Cloud Storage
- **AI Integration**: Google Gemini API (via Replit AI Integrations) for chat, image generation, and batch processing

### Data Storage
- **Primary Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` contains all table definitions
- **Key Entities**: Users (with role-based access and Stripe Connect), Brands, Products, Videos, Video-Brand associations, Brand Referrals, Analytics Events, Affiliate Payouts, Affiliate Invitations, Campaign Affiliates, Global Video Library, Video License Purchases, Video Publish Records
- **Object Storage**: Google Cloud Storage for video and image uploads

### Affiliate System
- **Three User Roles**: Creator, Brand, Affiliate - each with dedicated portal and navigation
- **Affiliate Invitations**: Manual single invite or CSV bulk import (max 200 per batch)
- **Campaign Affiliates**: Link affiliates to specific video campaigns with unique UTM codes
- **Global Video Library**: Creators pay €45 to list videos; affiliates pay €45 to license
- **Video Publishing**: Generate embeddable widget code with UTM tracking
- **Stripe Integration**: Connect accounts for affiliate payouts, payment intents for licensing
- **Video Product Overlays**: Per-video timeline overlays table (`video_product_overlays`) with position, startTime/endTime; CRUD API at `/api/videos/:id/overlays`; VideoDetailSheet "Timeline Overlays" section; VideoPlayerWithCarousel renders one carousel per position group simultaneously filtered by current playback time; AI import endpoint converts detection results to overlays

### Payment Flow
- **Stripe Connect**: Affiliates onboard to receive payouts directly
- **Listing Fee**: Creators pay €45 to list videos in Global Library
- **License Fee**: Affiliates pay €45 to license videos for their campaigns
- **Commission Tracking**: Automatic calculation and distribution via Stripe Connect

### Code Organization
```
├── client/           # React frontend application
│   └── src/
│       ├── components/   # Reusable UI components
│       ├── pages/        # Route page components
│       ├── hooks/        # Custom React hooks
│       └── lib/          # Utilities and query client
├── server/           # Express backend
│   ├── routes.ts         # API route definitions
│   ├── storage.ts        # Data access layer interface
│   └── replit_integrations/  # AI and storage integrations
├── shared/           # Shared code between client and server
│   └── schema.ts         # Database schema definitions
└── migrations/       # Database migration files
```

### Free Trial System
- **Trial rules**: 1 video max, 120 seconds max, fully functional (shoppable, analytics, affiliate payouts ledger)
- **Backend enforcement**: `POST /api/videos` checks video count and returns `TRIAL_EXHAUSTED` error code
- **Client enforcement**: `VideoUploadModal` reads duration client-side and blocks oversized uploads; shows trial-exhausted gate when limit is reached
- **Trial status endpoint**: `GET /api/users/me/trial-status` returns `hasActiveSubscription`, `videoCount`, `isTrialExhausted`, `trialVideosAllowed`, `trialMaxDurationSeconds`
- **Creator subscription page**: `/creator/settings/subscription` — free trial banner, plan selector (€249 Starter / €499 Pro), surplus calculator, Stripe checkout/portal/surplus-invoice
- **Schema additions**: `durationSeconds` and `isTrial` columns on `videos` table

### Key Design Patterns
- **Storage Interface Pattern**: `IStorage` interface in `server/storage.ts` abstracts data access, allowing for different implementations (in-memory or PostgreSQL)
- **Schema-First Design**: Database schemas defined with Drizzle, with Zod schemas auto-generated for validation using `drizzle-zod`
- **Path Aliases**: TypeScript path aliases (`@/` for client, `@shared/` for shared code) for clean imports

## External Dependencies

### Database
- **PostgreSQL**: Primary relational database (configured via `DATABASE_URL` environment variable)
- **Drizzle Kit**: Database migrations and schema pushing via `npm run db:push`

### AI Services (Replit AI Integrations)
- **Google Gemini API**: Powers chat functionality, image generation, and batch processing
- **Environment Variables**: `AI_INTEGRATIONS_GEMINI_API_KEY` and `AI_INTEGRATIONS_GEMINI_BASE_URL`
- **Models Used**: `gemini-2.5-flash` (fast), `gemini-2.5-pro` (advanced), `gemini-2.5-flash-image` (image generation)

### Object Storage
- **Google Cloud Storage**: File storage for video uploads
- **Replit Sidecar**: Local proxy at `http://127.0.0.1:1106` for credential management
- **Upload Flow**: Presigned URL pattern - client requests URL, then uploads directly to storage

### Frontend Libraries
- **Uppy**: File upload widget with S3-compatible multipart uploads
- **Radix UI**: Headless UI primitives for accessible components
- **TanStack Query**: Data fetching and caching
- **date-fns**: Date formatting utilities
- **Recharts**: Charting library for analytics visualizations

### Development Tools
- **Vite**: Frontend build tool with HMR
- **esbuild**: Server bundling for production
- **TypeScript**: Full type safety across the stack