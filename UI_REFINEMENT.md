# UI/UX refinement: fit on every screen, more intuitive

The look stays. This is about content fitting at every width and the app
explaining itself. Patterns are borrowed from DegreeDesk
(~/student-management-system), minus the parts it does poorly.

## Shipped 2026-09-26 (objective bugs, no visual change on desktop)
- Shell `h-screen` -> `h-dvh` (iOS Safari hid page bottoms under the URL bar).
- `main` gets `overflow-x-hidden` (no sideways blow-out on phones).
- Landing pricing swipes until `lg` (tablet cards 231px -> 340px).
- Testimonial dots: 16x2px -> 30x32px tap targets.

## Shipped 2026-09-26/27, rounds 1 and 2 (all 46 portal routes audited locally)
- Sidebar: icon rail below 1280px in all three portals (tablet content
  564px -> 764px); full sidebar from 1280; publisher sidebar says
  "Publisher Portal" and uses the shared active state.
- One shared page width (max-w-7xl) for every page.
- Tab bars scroll instead of stretching the page (analytics, all portals).
- Dialogs are bottom sheets on phones (grab handle, safe area, larger close).
- Touch sizing by pointer type (filter chips, card menus).
- Grid children can shrink (wallet, rewards, inventory overflow gone).
- Brand inventory phone layout; labeled dashboard tabs; refined stat cards;
  referral promo sticks when dismissed, sits above the nav, links to Referrals.
- Result: 0 of 46 routes overflow at 375px.

## Audit findings (public pages measured at 375 / 820 / 1280)
- 21 tap targets under 36px on phones.
- 13 of 44 pages have no max width (stretch edge to edge on wide monitors);
  the rest use 7 different caps (sm, md, xl, 2xl, 3xl, 5xl, 6xl).
- Tablet (768-1023): the full 16rem sidebar leaves ~500px for content.
- QA 25 Sep: a promo popup covered the "Upload Video" button on a narrow
  screen and swallowed taps.
- Dialogs already cap at dvh and scroll (good). Tables already scroll
  inside their own wrapper (good).
- Dashboards not yet measured (behind login).

## Phase A: shell (~1.5 days, biggest leverage)
- Sidebar becomes an icon rail on tablets (shadcn `collapsible="icon"`),
  full width from 1280px. Tooltips carry labels in rail mode. All three
  portals (creator, brand, publisher).
- One page container in the shell: `mx-auto max-w-7xl` with a single
  padding scale, so every page shares edges; narrow forms keep their own
  inner cap.
- Bottom nav: safe-area insets, hides while the keyboard is open, and
  "More" lights up when the current page is not in the dock.
- Promos never cover primary actions on phones.

## Phase B: page primitives (~2 days)
- `PageHeader`: title + description + actions, wrapping cleanly on phones
  (`flex-col sm:flex-row`, `min-w-0`, `flex-wrap`).
- Tables: secondary columns hide in priority order and fold under the
  first cell on phones (inventory, pipeline, analytics, campaigns).
- Stat cards: one framed "instrument panel" with hairline dividers
  (no double borders at any column count), `clamp()` values,
  `tabular-nums`.
- Touch sizing by capability, not width: `(pointer: coarse)` grows
  controls to 40-44px; hover-only row actions are always visible on touch.

## Phase C: intuitiveness (~2 days)
- Upload and other big dialogs become bottom sheets on phones
  (CSS-driven, dvh; NOT DegreeDesk's JS isMobile switch, which remounts
  dialogs on resize).
- Skeletons only on first load; later fetches keep the page on screen.
- Empty states that say what to do next ("Upload your first video").
- First-run tour for trial signups, steps that pick whichever element is
  visible (sidebar on desktop, dock on phones).
- Optional: Cmd-K command palette from the same nav config.

## Not copying from DegreeDesk
- JS `window.innerWidth` breakpoints deciding which component renders.
- `vh` in bottom sheets (must be `dvh`).
- Central hard-coded title maps; duplicate token definitions.
