# Claude Code prompt: VBiz Pro UI/UX redesign (v2)

> Copy this whole `vbiz-redesign-kit/` folder into the repo at `docs/design/redesign-kit/`, then paste everything below the line into Claude Code at the repo root.

---

## 0. Role and ground rules

You are a senior product designer and front-end engineer. Redesign the UI and UX of **VBiz Pro**, a multi-business B2B distribution platform built with Next.js 16 App Router, React 19, Tailwind v4, Prisma and Postgres. Each distributor gets its own address, brand and catalogue. VBiz Pro has these apps:
- **Retailer**: the kirana shop that orders stock.
- **Sales**: field reps.
- **Delivery**: drivers.
- **Admin**: the distributor's office.
- **Team**: staff self-service.
- **Platform**: our own console.

Customers are FMCG distributors (soap, shampoo, detergent, biscuits, atta, tea, snacks). Many of them carry ITC and HUL brands, but **the product is brand-neutral**.

Goal: an international-grade interface. The Retailer app should feel as quick and delightful as a top Indian 10-minute grocery app. The staff apps should feel calm and dense.

Hard rules:
1. **Name and logo.** The product is **VBiz Pro** (`APP_NAME` in `src/lib/brand.ts`). The logo files in `public/brand/` and `src/components/BrandMark.tsx` stay byte-identical: no recolouring, redrawing or cropping. The reference images say "Seller's Setu" and show a "your logo" placeholder. Ignore that name and use the real VBiz logo.
2. **No business-logic changes.**
   - Don't touch `prisma/schema.prisma`, migrations, server actions, `src/app/api/**`, `src/lib/**` money, ledger, GST, pricing or permission code, or RLS.
   - This is a presentation-layer job. If a screen needs data that doesn't exist, put a clearly marked placeholder in the UI or hide that element, and add it to **"Data needed"** in your summary.
   - Only one `src/lib` file may change: `src/lib/money.ts` (§2.4). You may add new presentational files under `src/lib/ui/`.
3. **Keep every feature reachable.** You may restyle, regroup and re-sequence screens, but delete nothing users can do today.
4. **Brand-neutral.** Never hard-code ITC, HUL or any other company in product UI, tokens or charts.
   - Brand chips, filters and chart series come from each business's catalogue (`Brand` rows with `name` and `logoKey`).
   - Brand chips are neutral: logo plus name on `--surface-2`.
   - Chart series take `--cat-1…6` in catalogue order.
   - The files in `redesign-kit/demo-brands/` may appear **only** in the `/dev/ui` showcase and in screenshots of the demo business. Never use them as product UI art.
5. **White label still works.** Read `src/lib/branding.ts` (`themeCss`, `themeColour`) and `src/lib/chrome.ts` first. A tenant's colour must override the `--accent-*` tokens on every surface, including the retailer's green. The semantic colours (money, scheme, risk, success) never change.
6. **Read first, then reuse.** Read `AGENTS.md`. This Next.js version differs from what you know, so check `node_modules/next/dist/docs/` before using any Next API. Also read `README.md`, `docs/ROADMAP.md` and the last 3 `docs/PHASE*.md` files.
7. **Branch and commits.** Work on branch `feat/ui-redesign`, with one commit per step in §10. Don't push or open a PR unless asked.
8. **Checks after every step.** Run `npm run typecheck`, `npm run lint` and `npm run build` after every step. There are about 8 known `react-hooks/set-state-in-effect` lint errors in admin and sales pages; don't add new ones.

## 1. What already exists (restyle it; don't rebuild it)

| Thing | Where | Instruction |
|---|---|---|
| App shell: sidebar with groups, tablet rail, phone bottom tabs (4 + More), menu sheet, bell, jump-to search | `src/components/AppShell.tsx` | Keep the structure and behaviour. Restyle it per §2 and §6. |
| Global classes `.btn` `.btn-kesar/primary` `.btn-mor/secondary` `.btn-soft` `.btn-quiet` `.btn-danger` `.card` `.chip-*` `.st-*` `.dt` `.page-*` `.stat-*` `.icon-tile` `.panel-dark` | `src/app/globals.css` | These are used in hundreds of places. **Restyle the classes and keep their names** so pages change without edits. Point `.btn-primary`/`.btn-kesar` at `--accent`. Add `.btn-money`, `.btn-scheme`, `.chip-money`, `.chip-scheme`, `.chip-risk`. |
| Line icons | `src/components/Icon.tsx` (app) and `src/components/landing/pro/Icon.tsx` (landing) | Merge both into one set (§3.1). |
| Store pieces: `Sheet`, `QtyControl` (units/cases), `ProductThumb`, `StockChip` | `src/components/store/shared.tsx` | Upgrade them in place (§4). |
| Storefront, home shelves, product card and sheet, cart review, order by text or voice | `src/components/Storefront.tsx`, `src/components/store/*` | Restyle them per §6.2. |
| Money formatting | `formatINR` in `src/lib/money.ts` | Extend it (§2.4). Don't add a second formatter. |
| i18n | `src/lib/i18n/` (`LanguageProvider`, `dictionary`, `tr`) | Put all new copy here in English and Hindi. Don't add `next-intl`. |
| Tailwind v4 | `@theme inline` in `globals.css` | Map the tokens here. There is no `tailwind.config`. |
| Landing page | `src/components/landing/bt/BtLanding.tsx` + `bt.css` | Light touch only (§7). |

## 2. Foundations

### 2.1 Tokens
- Copy `redesign-kit/tokens.css` to `src/styles/tokens.css` and import it at the top of `globals.css`. Then map it in `@theme inline`:
  - surfaces: `bg-canvas`, `bg-surface`, `bg-surface-2`
  - text: `text-ink`, `text-ink-2`, `text-muted`
  - colours: `accent`, `money`, `scheme`, `risk`, `success`, `kesar`, `mor`, `genda`, `mint`, `cat-1…6`
- The old variables in `globals.css` (`--kesar`, `--mor`, `--genda`, `--mint`, `--brand`, `--gold`, `--app-ground`, `--app-line`) become aliases of the new tokens, so nothing breaks.
- **Migrate raw colours.** Grep `src/` for `#[0-9a-f]{3,8}` and `rgb(`/`rgba(` in `.tsx` files and move them to tokens. Known offenders:
  - `#a8281e` and `#fde4e1` become `--risk-*`.
  - `#9aaeaa` becomes `--faint`.
  - The hex values in the `BtLanding` mock-ups may stay, because they are decorative sample art.
- **Surface switch.**
  - Add `data-surface="retailer"` on the root element of `src/app/retailer/layout.tsx`. Every other app keeps the staff default.
  - Make sure the tenant theme from `themeCss` is applied *after* the surface rules, so a white-label colour still wins.

### 2.2 Colour meaning (enforce it everywhere)
- **Accent**: primary action, selected state, "added". It is green on the Retailer app and kesar (saffron) on staff apps.
- **Mor (teal)**: staff-app chrome (sidebar, dark panels, headers on sales and delivery).
- **Money (blue)**: khata, credit, dues, payments, invoices, wallet, cash collected.
- **Scheme (marigold)**: schemes, offers, slabs, free goods, margin badges.
- **Risk (red)**: overdue, credit breach, stock-out, failed payment or delivery. Never use it as decoration.
- **Success (mint)**: delivered, paid, verified.

### 2.3 Typography
- In `src/app/layout.tsx`, swap Funnel Display and Funnel Sans for **Poppins** (500–800) as `--font-heading` and **Manrope** (400–800) as `--font-body`. Use `next/font/google` and keep the same variable names so every existing `font-heading` use keeps working.
- **Keep Anek Devanagari** as `--font-deva`, because it pairs better with Poppins for Hindi than Noto does. Keep Geist Mono for invoice numbers, IDs and codes.
- Poppins is for headings, big money figures, banners and stat numbers. Everything else uses Manrope.
- Sizes: body text at least 13px on mobile, captions at least 11px. On desktop, keep lines to 70ch or less.

### 2.4 Money
- Extend `formatINR` with `{ compact?: boolean }`:
  - normal: `₹1,84,000`
  - compact: `₹4.82L` / `₹1.2Cr`
- Use `font-variant-numeric: tabular-nums` (the `.num` class) on every amount.
- Use compact amounts on cards and full amounts in detail views and tables.

### 2.5 Layout and touch
- Use a 4pt spacing grid. Gutters are 16px on mobile and 24–32px on desktop.
- Radius:
  - inputs and buttons: 12
  - cards: 16–20
  - sheets and hero cards: 28
  - chips: pill
- **Touch targets are at least 48px** on Retailer, Sales and Delivery, and **56px for the main buttons on Delivery**. Primary actions sit in a sticky footer in the thumb zone.
- **Today the stepper buttons are 32px (`h-8`). Fix them.**

## 3. Iconography

Read `redesign-kit/icons/ICON_AUDIT.md`. It lists every missing icon, every icon in bad shape and every file and line to fix.

### 3.1 Line icons (nav, buttons, tables, inputs, chips)
- Add `@phosphor-icons/react`. Rewrite `src/components/Icon.tsx` as a map from the **existing names** to Phosphor components, so the roughly 400 call sites don't change. Use the mapping table in the audit and add the new names it lists.
- Use weight `duotone` in nav and feature tiles (`side-link`, `tab-link`, `icon-tile`) and `regular` inline. Import the icons individually so tree-shaking works.
- Delete `landing/pro/Icon.tsx` and the inline `Svg`/`D` paths in `BtLanding`, and point the landing page at the shared `Icon`.
- Fix the misused icons from the audit:
  - Replace every `rotate-180` arrow or upload icon with `back` or `download`.
  - Use `sparkle` for AI features.
  - Use real Minus/Plus icons in the stepper.
  - Close sheets with an X icon button.

### 3.2 3D icons (category tiles, banners, empty and success states)
**The 68 final renders are in the kit.** Follow `redesign-kit/ICONS_3D_GUIDE.md` exactly: it has the install commands, the ready-made `Icon3D.tsx`, `icon3d.css`, `icons3d.ts` and `categoryIcons.ts`, the size table, and the screen-by-screen placement map. Don't generate placeholder SVGs and don't rewrite the supplied files beyond fixing imports or lint.
- `<Icon3D name size animate? tinted? alt? priority? />` renders `/icons3d/{name}.webp` with a `{name}-2x.webp` srcSet, a CSS shadow (`--icon3d-shadow`; the renders have **no baked shadow**) and a hue blob until it loads.
- **Motion is CSS only:** `.i3d-bob`, `.i3d-pop`, `.i3d-tap` (in `icon3d.css`).
- **`categoryIcon(name)`** maps any distributor's category name, English or Hindi, to an icon, falling back to `box-sealed`. Add unit tests for it.
- **Use 3D icons only in:**
  - category tiles and the category rail
  - scheme banners
  - the `ProductThumb` fallback, which shows the category's 3D icon instead of the first letter
  - empty states and success screens
  - login and role pickers
  - landing feature tiles

  **Never** in buttons, tabs, tables, chips or inputs.

## 4. Components

Build or upgrade these, then add a dev-only `/dev/ui` route that shows every component in every state, on both surfaces (staff and retailer). Each component must handle loading, disabled and error states.

- **Buttons** (the restyled classes):
  - Variants: primary (accent), secondary (outline), money, scheme (dark text), ghost, danger.
  - Sizes 40, 48 and 56.
  - The pressed state is scale .97. While loading, show a spinner and keep the button's width.
- **AddStepper** (upgrade `QtyControl`):
  - "Add" morphs into `− qty +` using `--ease-spring`.
  - Keep the units/cases toggle and the typed quantity.
  - Long-press repeats.
  - Buttons are at least 48px.
  - The first add flies a thumbnail to the CartBar (WAAPI) and calls `navigator.vibrate(10)` where supported.
- **CartBar**: a sticky accent bar above the bottom tabs showing "{n} items · ₹total · View cart →". It springs in and out, and the total counts up.
- **ProductCard**:
  - Add a **grid** variant (2 columns on mobile, matching `kit-a-category-rail.png`) next to the existing list layout.
  - Show the packshot on `--surface-2`, a neutral brand chip, the name clamped to 2 lines, the pack ("Case of 24"), the price, the struck-out MRP, a margin badge (scheme colour), a scheme ribbon when it applies, and the stepper.
  - Keep `StockChip`.
- **CategoryRail**: a left vertical rail of Icon3D tiles. The active tile gets an accent border and a sliding indicator.
- **BrandFilter**: segmented chips `All | {brands from catalogue}`.
  - It scrolls sideways when there are more than 4 brands.
  - It uses the existing `brand` filter in `StoreFilters` and keeps its state in URL search params.
  - On Admin it filters charts and tables.
- **StatCard**:
  - Tones: accent, money, scheme, neutral, risk.
  - Content: label, a big Poppins figure, a delta line and an optional sparkline drawn in inline SVG (no chart library).
- **SchemeBanner**: a scheme-coloured card built from `offers` and `banners`.
  - It shows a headline, an "ends {date}" line (use `endsLabel`) and a CTA, with Icon3D `gift-box` as the fallback art.
  - A progress variant ("Add 1 more case to unlock") appears only if the quote data already has the numbers; otherwise add it to "Data needed".
- **KhataCard**: pull it out of `src/app/retailer/page.tsx` into a component and give it the money tone. Due amounts turn risk-coloured when overdue.
- **CreditMeter**: credit used against the limit, if `khataSummary` exposes a limit. The bar turns scheme-coloured above 80% and risk-coloured above 100%.
- **Sheet** (upgrade the existing one):
  - Add a drag handle, snap points, a 22px backdrop blur and a focus trap.
  - It stays a centred dialog from `md` up.
- **Inputs**:
  - 48px fields with a floating label and an accent focus ring.
  - An OTP input with 4–6 boxes, auto-advance and paste support.
  - A search field with a mic button that opens the existing order-by-voice flow.
- **Others:**
  - Tabs (pill segmented control).
  - DataTable on top of `.dt` (sticky header, tabular numbers, row actions, CSV button where one exists today).
  - EmptyState (Icon3D, title, one line of text, one action).
  - Skeletons shaped like the real cards.
  - Toast.
  - StatusPill, mapped from the existing `STATUS_COLOR` and `.st-*` classes.

## 5. Motion

Use **CSS and the Web Animations API only**, with no Framer Motion and no Lottie, to stay inside the JavaScript budget. Put the shared presets in `src/lib/ui/motion.ts`: `fadeUp` (8px over 240ms), `stagger` (40ms), and `spring` (`--ease-spring`, 320ms).

| Moment | Spec |
|---|---|
| Add to cart | The button morphs into the stepper, a thumbnail flies to the CartBar along a curve, and the phone gives a light vibration. |
| 3D tile tap | `.i3d-tap` |
| Scheme unlocked | `gift-box` pops, a short CSS confetti burst plays (once per scheme per session), and a toast says "Scheme applied". |
| Order placed | Full-screen success: `box-sealed`, then `truck` slides off (1.6s), then the app goes to the order page. |
| Khata paid | The due amount counts down to ₹0 (600ms), then `all-paid` pops. |
| Page change on mobile | 16px slide plus fade (240ms) |
| Page change on desktop | Fade |
| Loading | Skeleton shimmer. No spinners on primary screens. |
| Lists | Stagger on first mount only. |

When the user prefers reduced motion, drop the flights and confetti and keep simple fades.

## 6. Screens

First, list every route under `src/app` by role in `docs/design/REDESIGN-CHECKLIST.md` (route → screen → status) and keep it updated as you work.

The reference images are approved for **layout and hierarchy**. Their name ("Seller's Setu"), the logo placeholder and the green on staff screens are outdated. Staff screens use the kesar and mor accents instead.

### 6.1 Shell
- **Retailer** (green surface):
  - White top bar with the next delivery date from `cart.deliveryDates`, the shop name, the bell and the avatar.
  - White bottom tabs; the active tab gets an accent pill.
- **Staff apps:**
  - Mor sidebar (keep the groups, the rail and search).
  - White top bar with breadcrumb, language toggle and bell.
  - On Admin, add the BrandFilter to the top bar on pages it affects.
  - Phone tabs: the active tab gets a kesar-tint pill.
- **Tab icons** are duotone. On selection the icon fills and bounces in scale (1.0 → 1.12 → 1.0).

### 6.2 Retailer (match `reference/02-retailer-home.jpg` and `03-inner-pages.jpg`)
- **Home, in this order:**
  1. Header.
  2. Search with mic.
  3. KhataCard and CreditMeter side by side.
  4. SchemeBanner carousel (offers and banners, advances every 5s, pauses on touch).
  5. BrandFilter, then the category grid of Icon3D tiles (4×2, then "All categories").
  6. "Order again": the existing `usual` and `buyAgain` lists with steppers.
  7. Latest order card, with the status timeline restyled.
  8. Announcements, referral and help.
  9. CartBar.
- **Catalogue:**
  - CategoryRail on the left and a 2-column ProductCard grid on the right.
  - Sticky chips: brand, scheme only, in stock.
  - Keep the list view as a toggle.
- **Search:**
  - Recent-search chips and results.
  - The empty state uses `no-results`.
- **Product sheet:**
  - Images, brand chip, pack and unit/case choice, price, MRP, margin, scheme block, and "Usually bought with" if the data exists.
  - Sticky "Add · ₹X" footer.
- **Cart and checkout** (`CartReview`):
  - Scheme nudge at the top, line items with steppers, savings in success colour, and a collapsible GST breakdown.
  - Payment: khata credit (money tone, shows credit left) / UPI / cash on delivery, using only the options the business has turned on.
  - Delivery date picker from `cart.deliveryDates`.
  - Sticky "Place order · ₹X".
  - Show the credit-limit or minimum-order warning *before* the button is pressed, using data already returned by the quote.
- **Orders:**
  - Tabs: Active / Past.
  - Active cards show a status timeline, ETA, and call and WhatsApp buttons.
  - Past cards show Reorder and an invoice link.
  - The empty state uses `empty-orders`.
- **Khata:**
  - A big due figure.
  - Ageing as a stacked bar, if the data exists.
  - The ledger grouped by date, with bill/payment filters.
  - Pay now and the statement.
  - When the balance is zero, show `all-paid`.
- **Invoices, Refer, Help, Account, Notifications:** restyle them with the shared components.

### 6.3 Sales (staff surface; match the Beat screen in `03-inner-pages.jpg`, using mor and genda instead of yellow and green)
- **Today / Beat** (`src/app/sales/beat`):
  - Mor header with the beat name, a visited/total progress bar and 3 mini StatCards: Orders, Collected (money), Target % (from `TargetsCard` data).
  - "Next on route" card with distance, overdue amount (risk), and big Check in / Navigate buttons.
  - The remaining shops; visited ones are dimmed and show their result.
- **Retailer detail and visit** (`RetailerDetail`, `components/field/*`):
  - Shop header with khata and credit.
  - Quick order with the usual SKUs pre-filled.
  - Collect payment (`PayLinkCard`).
  - Shelf audit (`ShelfAuditCard`, camera icon).
  - New shop form as a stepper.
- **Attendance and punch card:**
  - A big punch button with selfie and location confirmation.
  - A day timeline.
- **Targets:** a weekly ring and scheme-wise sales.

### 6.4 Delivery (staff surface, outdoors: high contrast, 56px main buttons)
- **Today:**
  - Duty switch.
  - Trip cards with numbered stops, a status pill, and COD amounts in money colour.
- **Order / stop** (`delivery/orders/[id]`):
  - Keep the existing `Stepper` and restyle it as a 3-step checklist: items checked (`LinesCard`), proof photo and signature (`ProofCard`), collect payment (`CollectCard`/`QrPayCard`: UPI QR, cash or khata). Returnables and crates come next, then "Mark delivered".
  - "Not delivered" stays in its sheet.
- **Cash handover, van stock, spot sale and history:** restyle them. Add the denomination counter or handover OTP only if the data exists; otherwise add them to "Data needed".

### 6.5 Admin (staff surface; match the layout of `04-admin-dashboard.jpg` with kesar and mor accents)
- **Overview:**
  - A greeting with live counts.
  - Four StatCards: Sales today (accent), Outstanding (money, with the 30+ day amount in scheme colour), Live schemes (scheme), Low-stock SKUs (risk).
  - "Sales by brand, 8 weeks": grouped bars in inline SVG, or the chart code that already exists, coloured `--cat-*` in catalogue order.
  - A "Needs attention" list with inline actions.
- **Tables** (orders, retailers, products, stock, invoices, khata, payments):
  - DataTable with filter chips and a side-panel detail on desktop where the page already has a detail view.
  - Keyboard: `/` focuses search, `j`/`k` move between rows.
- **Schemes:** the builder shows a live SchemeBanner preview.
- **Settings → Brand:** the white-label preview shows the tenant accent on both surfaces.
- **Other admin pages** (dispatch, stock, pricing, engage, integrations, billing, account, setup, complaints and the rest): bring them onto the shared components and tokens without changing layout logic.

### 6.6 Team, Platform and auth
- **Team and Platform console:** inherit the staff restyle. No new layouts.
- **Login, 2FA, forgot and reset:**
  - On the platform address, show the VBiz logo and the brand deco art (`deco-hub.svg`), with the form card.
  - On a business's address, show that business's logo and name (white label). **No company packshots** on either.
  - OTP boxes, a resend timer and the language toggle.

## 7. Landing page (light touch only)

`src/components/landing/bt/BtLanding.tsx` keeps its kesar, mor, genda and mint palette, layout and copy.
1. **Fonts:** it inherits Poppins and Manrope from the layout. Check that the headings still fit in English and Hindi at 390px and 1440px, and adjust `bt.css` sizes if needed.
2. **Icons:** switch to the shared `Icon` (§3.1).
3. **3D icons:**
   - In the "five problems" rings and the feature-grid tiles, replace the line icon with an `Icon3D` (`cart` → `kirana-shop`, `box` → `warehouse`, `pin` → `beat-map`, `truck` → `truck`, `bill` → `invoice`, and so on).
   - Put one `gift-box` on the retailer feature story.
4. **Remove dead CSS:**
   - `globals.css` imports `landing/landing.css` (62 KB) and `landing/pro.css` (68 KB). `BtLanding` only needs `bt.css`, plus the styles `ProFooter` uses under `.vp`.
   - Move the selectors `ProFooter` actually uses into `bt.css`, drop both imports, then delete the landing components nothing imports anymore (check with grep: `Visuals.tsx`, `LandingFx.tsx`, `use-landing.tsx`, the `pro/` sections other than the footer).
   - Keep `landing-content.ts` keys that are still read, such as the FAQ.
   - Prove it with a screenshot diff of the landing page before and after.

## 8. States and edge cases (every screen)
- **Loading:** skeletons. **Empty:** EmptyState with Icon3D and one helpful action. **Error:** an inline message with Retry, never a raw error string.
- **Offline:** a top banner reading "You're offline. Showing saved data." The service worker already exists. Disable actions that can't be queued and say why.
- **Permissions and plan locks:** keep the current lock behaviour in `AppShell`, and never show a disabled control without a reason.
- **Long names:** clamp to 2 lines.
- **Language:** every new string goes in English and Hindi.

## 9. Quality bars
- **Accessibility:**
  - WCAG AA. White on the green or kesar accent is for bold text of 14px or larger only; use `--accent-text` for small coloured text.
  - Visible focus rings, labelled icons, sheets that trap focus, and touch targets of at least 48px.
- **Performance (mid-range Android on 4G):**
  - LCP under 2.5s, CLS under 0.05, and no more than 180 KB of gzipped JavaScript per route. Report the before and after route sizes from `next build`.
  - 3D WebPs as supplied: 1x files 30 KB or less, `-2x` files 44 KB or less. Don't re-encode them.
  - Use `next/image` everywhere.
- **Dark mode:** out of scope for this pass. Keep the tokens ready for it.
- **Consistency:** no one-off colours, radii or shadows. Finish with a grep audit and report anything left over.

## 10. Execution order (commit after each step; take screenshots at 390×844 and 1440×900 into `docs/design/after/step-NN/`)
1. Read the docs, list the routes, write `REDESIGN-CHECKLIST.md`, and take "before" screenshots of every route into `docs/design/before/`.
2. Tokens, the surface switch, fonts, `formatINR` compact, motion presets.
3. Icons: Phosphor map, merge the landing icons, fix the misuses, then install the 3D set per `ICONS_3D_GUIDE.md` §2 (`Icon3D`, `categoryIcons` and tests).
4. Restyle the global classes and build the components, plus `/dev/ui`.
5. App shells on both surfaces.
6. Retailer screens (§6.2).
7. Sales screens (§6.3).
8. Delivery screens (§6.4).
9. Admin screens (§6.5), then Team, Platform and auth (§6.6).
10. Landing light touch (§7).
11. States (§8) and an i18n sweep.
12. QA: typecheck, lint, build, `npx vitest run`, and the final screenshots.

## 11. Definition of done
- Every route in the checklist is ✅ with before and after screenshots.
- One icon library; no raw hex colours in components (landing mock art excepted).
- Logo files are byte-identical. White label is checked on both surfaces with a test tenant colour.
- No company names hard-coded in product UI.
- Build, lint, typecheck and tests pass.
- Your summary covers: what changed per role, route bundle sizes before and after, **Data needed**, and open questions.
