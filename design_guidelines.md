# Video Commerce SaaS Design Guidelines

## Design Approach
**System-Based with iOS Influence**: Leveraging Apple HIG principles for mobile-first design while incorporating contemporary SaaS aesthetics. Focus on clean information hierarchy, intuitive navigation, and seamless data visualization for Creator, Brand, and Affiliate Publisher dashboards.

## Typography System
**Primary Font Stack**: `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif`

**Hierarchy**:
- Dashboard Headers: `text-2xl` (24px), font-semibold
- Section Titles: `text-xl` (20px), font-semibold  
- Card Headers: `text-lg` (18px), font-medium
- Body Text: `text-base` (16px), font-normal
- Supporting Text: `text-sm` (14px), font-normal
- Captions/Labels: `text-xs` (12px), font-medium

## Layout System
**Spacing Primitives**: Use Tailwind units of **4, 6, 8, 12** for consistency
- Component padding: `p-6` for cards, `p-4` for nested elements
- Section gaps: `gap-8` for primary sections, `gap-6` for card grids
- Page margins: `px-4` mobile, `px-6` tablet, `px-8` desktop
- Vertical rhythm: `space-y-6` for stacked sections

**Container Strategy**:
- Max-width: `max-w-7xl mx-auto` for dashboard content
- Cards: Full-width mobile, grid layouts tablet/desktop
- Safe areas: `pb-safe` for iOS bottom navigation clearance

## Component Library

### Navigation
**Mobile Bottom Tab Bar**: Fixed iOS-style navigation with 5 core sections (Dashboard, Videos, Library, Analytics, More). Icons with labels, `h-16` height, rounded top corners `rounded-t-3xl`, backdrop blur effect.

**Desktop Sidebar**: Collapsible left sidebar `w-64`, persistent navigation, grouped sections with dividers.

### Cards & Surfaces
**Standard Card**: Rounded corners `rounded-2xl`, subtle shadow `shadow-lg`, padding `p-6`, background with opacity for glass effect in dark mode.

**Stat Cards**: Grid layout `grid-cols-2 md:grid-cols-4`, compact padding `p-4`, icon + number + label structure.

**Video Cards**: Aspect ratio `aspect-video`, thumbnail with gradient overlays, metadata overlay on hover/tap.

### Buttons
**Primary**: Fully rounded `rounded-full`, medium padding `px-6 py-3`, font-medium, solid background.

**Secondary**: Same rounding, outlined variant `border-2`, transparent background.

**Icon Buttons**: Square or circular `rounded-full`, `p-3`, icon size `w-5 h-5`.

**On-Image Buttons**: Backdrop blur `backdrop-blur-md`, semi-transparent background, no hover states needed (built-in).

### Forms
**Upload Area**: Large drop zone, dashed border `border-2 border-dashed`, rounded `rounded-xl`, padding `p-12`, centered content with icon + text.

**Dropdown/Select**: Rounded `rounded-lg`, height `h-12`, with search functionality, custom styling.

**Referral Form**: Stacked inputs, `space-y-4`, rounded inputs `rounded-lg`, clear labels above fields.

### Data Display
**Tables**: TanStack Table with sortable headers, row hover states, sticky headers, pagination controls. Rounded container `rounded-xl`, alternating row backgrounds in light mode, uniform in dark.

**Charts**: Recharts with smooth animations, tooltips, gradient fills. Contained in cards with titles and time range selectors.

**Video Player**: Custom controls, product carousel overlay at bottom, swipeable on mobile, click-through on desktop.

### Modals & Overlays
**Modals**: Centered, max-width `max-w-2xl`, rounded `rounded-2xl`, backdrop blur dark overlay.

**Product Carousel**: Bottom-anchored overlay on video player, horizontal scroll, card-based product tiles `rounded-xl`.

## Theme System

### Light Theme
- Background: Neutral warm tones (beige/cream)
- Surface: White with subtle shadows
- Text: Dark gray/charcoal
- Accents: Purple/violet gradient highlights

### Dark Theme  
- Background: True black to deep charcoal gradient
- Surface: Dark gray with subtle borders, glass effect
- Text: White/off-white
- Accents: Lighter purple/blue highlights

**Theme Toggle**: Prominent in header/settings, smooth transition animations `transition-colors duration-200`.

## Animations
**Purposeful Motion Only**:
- Page transitions: Subtle slide/fade `transition-opacity duration-300`
- Card reveals: Stagger animations on load
- Skeleton loaders: Pulse effect while loading data
- Number counters: Animate on dashboard stat updates
- NO excessive scroll animations or parallax effects

## Mobile-First Considerations
- Touch targets minimum `h-12 w-12`
- Bottom navigation always visible with safe area padding
- Swipe gestures for video carousel, table rows (delete action)
- Pull-to-refresh on data-heavy pages
- Haptic-like visual feedback (scale down `scale-95` on tap)
- Optimized image loading with lazy loading
- Fixed headers with backdrop blur when scrolling

## Images
**Dashboard**: No hero image needed. Focus on data visualization and metrics cards.

**Video Thumbnails**: User-uploaded video frames, aspect-ratio `16:9`, with gradient overlays for text readability.

**Brand Logos**: Small square logos `w-12 h-12 rounded-lg` in dropdowns and brand selection grids.

**Empty States**: Simple illustrations or icons for empty video libraries, no referrals yet, etc.