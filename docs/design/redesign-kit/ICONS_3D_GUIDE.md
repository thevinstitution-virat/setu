# VBiz Pro: 3D icon guide for Claude Code

The 68 Gemini renders are finished and in this kit. This guide covers installing them, the component, where every icon goes, and how to check the result. It replaces the "ship placeholders" step in `PROMPT.md` §3.2.

Read `icons/ICON_AUDIT.md` first for the line-icon (Phosphor) half of the work. 3D icons and line icons are separate systems and never mix.

## 1. What's in the kit

| Path | What it is |
|---|---|
| `icons3d/{name}.webp` | 68 icons at 512 × 512, transparent, 10–27 KB each |
| `icons3d/{name}-2x.webp` | The same at 1024 × 1024, 27–43 KB each |
| `icons3d/manifest.json` | Code (C01…E08), group, English and Hindi label, dominant hue, file sizes, category keywords |
| `code/Icon3D.tsx` | The component |
| `code/icon3d.css` | Placeholder blob, tinted tile, dark-ground shadow, motion, reduced-motion rules |
| `code/icons3d.ts` | Typed name list generated from the manifest (`Icon3DName`, `ICON3D`) |
| `code/categoryIcons.ts` | Category name (English or Hindi) → icon, with `box-sealed` as fallback |
| `code/build-icons3d.mjs` | Re-export script for adding or replacing icons later |
| `reference/icons3d-contact-sheet.png` | All 68 on one sheet, with codes |
| `icons/PASTE_INTO_GEMINI.md` | The prompt the set was made with. Use it for any new icon so it matches. |

All files are already trimmed and re-centred so every object fills 84 % of its square. Different icons sit at the same visual size in a grid without per-icon tweaks.

The files use `-2x`, not `@2x`, in their names. Keep it that way: `@` needs escaping in some CDNs and in `srcSet` parsing.

## 2. Install (part of step 3 in PROMPT.md §10)

```bash
mkdir -p public/icons3d src/components/icons3d src/lib/ui src/styles scripts
cp docs/design/redesign-kit/icons3d/*.webp            public/icons3d/
cp docs/design/redesign-kit/code/Icon3D.tsx           src/components/icons3d/Icon3D.tsx
cp docs/design/redesign-kit/code/icons3d.ts           src/lib/ui/icons3d.ts
cp docs/design/redesign-kit/code/categoryIcons.ts     src/lib/ui/categoryIcons.ts
cp docs/design/redesign-kit/code/icon3d.css           src/styles/icon3d.css
cp docs/design/redesign-kit/code/build-icons3d.mjs    scripts/build-icons3d.mjs
```

Then:
1. In `globals.css`, `@import "../styles/icon3d.css";` directly after the tokens import. It needs `--icon3d-shadow`, `--ease-spring`, `--ease-out`, `--dur-base` and `--mor` from `tokens.css`.
2. In `next.config.*`, add a long cache header for `/icons3d/:path*` (`public, max-age=31536000, immutable`). If an icon is ever redrawn, give it a new file name rather than overwriting it.
3. Do **not** generate placeholder SVGs. The real art is here.
4. Do **not** commit the 1024 px source PNGs to the repo. They are about 35 MB in total. They stay in the design drive; `build-icons3d.mjs` reads them from any folder.
5. Run `npm run typecheck`. `Icon3DName` is a string union, so a mistyped name fails the build.

## 3. The component

```tsx
import { Icon3D } from "@/components/icons3d/Icon3D";
import { categoryIcon } from "@/lib/ui/categoryIcons";

<Icon3D name="gift-box" size={96} animate="pop" />
<Icon3D name={categoryIcon(category.name)} size={56} tinted />
```

| Prop | Default | Notes |
|---|---|---|
| `name` | required | `Icon3DName`. An unknown name renders `box-sealed`. |
| `size` | 64 | Box size in px. Use only the sizes in §4. |
| `animate` | `"none"` | `bob` (idle float), `pop` (entrance), `tap` (lifts when the parent with `.i3d-host` is pressed). |
| `tinted` | false | Pale tile of the icon's own hue behind it. For category tiles and the rail. |
| `alt` | `""` | Leave empty when visible text sits beside the icon (almost always). Set it to the label from `ICON3D[name].en`/`.hi` when the icon stands alone. |
| `priority` | false | Eager load with high fetch priority. Only for icons above the fold on the first screen. |

Rules for the component:
- It renders a plain `<img>` with a 1x/2x `srcSet`, not `next/image`. The files are already optimised; the optimiser would only re-encode them and add a request hop. The ESLint rule is disabled for that one line with a reason.
- The shadow is CSS (`--icon3d-shadow`). The renders have no baked shadow. Never add one with `box-shadow` on the tile.
- The placeholder blob takes the icon's hue from `icons3d.ts`, so there is no layout shift and no grey box.
- `ProductThumb` and category tiles from the database can't know the name at build time. Always pass them through `categoryIcon()`. Never build a name from user data with string concatenation.

## 4. Where each icon goes

Use 3D icons **only** in the places below. Never in buttons, the bottom tab bar, the sidebar, tables, chips, inputs, toasts or form labels: those use Phosphor line icons.

### 4.1 Sizes

| Place | Size | Treatment |
|---|---|---|
| Category grid tile (retailer home, 4 × 2) | 56 | `tinted`, `animate="tap"`, tile has `.i3d-host` |
| Category rail (catalogue, left) | 40 | `tinted`; the active item gets the accent border, not a bigger icon |
| `ProductThumb` fallback | 60 % of the thumb | on `--surface-2`, not tinted |
| Scheme banner | 96 (mobile) / 120 (desktop) | right-aligned, bleeding 8 px off the card edge, `bob` |
| Feature tile (role picker, admin setup, landing) | 64 | `tinted` on white cards; plain on the dark band |
| Empty state | 120 | centred above the title, `pop` |
| Success screen | 160 | `pop`, then the sequence in PROMPT.md §5 |
| Login / onboarding | 120 | one per screen at most |

Never show more than **one** animated (`bob`) icon on screen at a time, and never more than 12 3D icons above the fold.

### 4.2 Categories (C01–C33)

Used through `categoryIcon(category.name)` only. Never hard-code a category to a business: every distributor names categories differently.

Examples of what the matcher returns:

| Category name in the catalogue | Icon |
|---|---|
| "Shampoo", "शैम्पू", "Hair Care – Shampoo" | `shampoo` |
| "Cream Biscuits" | `cream-biscuits` (the longer phrase wins over `biscuits`) |
| "Liquid Detergent" | `detergent-liquid` |
| "Atta, Rice & Dal", "आटा" | `atta` |
| "Namkeen & Snacks" | `chips` |
| "Pooja Samagri", "अगरबत्ती" | `agarbatti` |
| "Personal Care", "Misc", anything unknown | `box-sealed` |

If a demo business has a category that lands on `box-sealed` but clearly has a match, add the keyword to `categoryIcons.ts` in English and Hindi. Add a unit test for it in the same commit.

### 4.3 Features (B01–B27) and states (E01–E08)

| Icon | Use it for | Screens |
|---|---|---|
| `gift-box` | Schemes, offers, scheme unlocked | Retailer home banner fallback, scheme unlocked toast art, admin schemes empty-builder |
| `ledger` | Khata | Retailer khata header when balance > 0, role picker "Khata", landing khata tile |
| `truck` | Delivery, order on the way | Order placed sequence (slides off), delivery role card, landing |
| `box-sealed` | Order placed; unknown category | Order placed success, `ProductThumb` and category fallback |
| `kirana-shop` | Retailers, shops | Retailer role card, admin retailers empty state, landing "five problems" ring |
| `wallet` | Prepaid wallet | Wallet page header (retailer) |
| `upi-phone` | UPI payment | Checkout payment choice art (not the radio itself), delivery `QrPayCard` header |
| `invoice` | Invoices, GST | Invoices empty state, landing bill tile |
| `cash-stack` | Cash handover | Delivery cash handover header |
| `credit-gauge` | Credit limit | `CreditMeter` empty or "no limit set" state |
| `beat-map` | Sales beat | Sales Today header art, sales role card, landing |
| `calendar-slot` | Delivery slot | Checkout delivery-date block header |
| `megaphone` | Announcements | Retailer announcements card, admin engage empty state |
| `bell` | Notifications | Notifications page header art only (the top-bar bell is a line icon) |
| `target` | Targets | Sales targets card |
| `trophy` | Leaderboard | Sales leaderboard, target hit celebration |
| `camera` | Shelf audit | `ShelfAuditCard` header |
| `mic` | Voice order | Order-by-voice sheet hero |
| `chat-order` | Order by message | Order-by-text sheet hero, landing |
| `crate` | Returnables | Delivery returnables step header |
| `warehouse` | Stock | Admin stock empty state, landing "stock" tile |
| `clipboard` | Purchase orders, checklists | Admin purchase orders empty state, delivery checklist header |
| `van` | Van sales | Delivery van stock and spot sale header |
| `attendance` | Attendance | Sales/Team punch card header |
| `percent-tag` | Margin, discount | Product sheet margin block, pricing empty state |
| `sparkle` | Ask your business (AI) | Ask sheet hero, catalogue assist empty state |
| `referral` | Refer a shop | Retailer refer page |
| `empty-cart` | Cart empty | Cart and CartReview empty |
| `empty-orders` | No orders | Retailer orders, admin orders, retailer home "no order yet" |
| `no-results` | Search found nothing | Search, filtered tables with zero rows |
| `offline` | Offline | Full-screen offline fallback only (the top banner uses a line icon) |
| `success-tick` | Generic success | Payment done, form submitted, setup complete |
| `all-paid` | Khata cleared | Khata when balance is ₹0, khata-paid sequence |
| `no-notifications` | Inbox empty | Notifications empty |
| `no-schemes` | No live schemes | Retailer schemes list empty, admin schemes empty |

Shop-facing icons (categories, states, `gift-box`, `box-sealed`, `kirana-shop`, `chat-order`) use the retailer green. Staff icons use mor and kesar. Don't move a staff icon onto a retailer screen if a shop-facing one fits.

### 4.4 Landing page (PROMPT.md §7)

| Current line icon | Replace with |
|---|---|
| cart | `kirana-shop` |
| box | `warehouse` |
| pin | `beat-map` |
| truck | `truck` |
| bill | `invoice` |
| wallet / khata | `ledger` |
| chat | `chat-order` |
| spark / AI | `sparkle` |

One `gift-box` on the retailer feature story. On the dark mor bands, wrap the section in `data-ground="dark"` so the shadow deepens.

## 5. Backgrounds

The set was checked on three grounds (see `reference/icons3d-contact-sheet.png`):
- **White and `--surface-2`:** default. Use `tinted` on white cards so tiles don't float.
- **Dark mor (`.panel-dark`, staff headers, landing bands):** add `data-ground="dark"` on the container. The CSS switches to a deeper shadow and a mor-mixed tint.
- **Scheme-yellow card:** icon untinted, default shadow.
- **Accent green or kesar fills:** don't put 3D icons on solid accent. Use a white circle behind it, or move it to a neutral card.

## 6. Motion

All CSS, in `icon3d.css`. No Lottie, no Framer Motion.

| Class | Effect | Where |
|---|---|---|
| `i3d-bob` | 4 px float, 3 s loop | One banner or hero at a time |
| `i3d-pop` | Scale 0.8 → 1 with spring, 420 ms | Empty and success states, scheme unlocked |
| `i3d-tap` | Lift 6 px and tilt 8° while the `.i3d-host` parent is pressed | Category tiles, feature tiles |

Motion starts only after the image has loaded. Everything stops under `prefers-reduced-motion`.

## 7. Accessibility and performance

- 3D icons are decorative wherever text sits next to them: `alt=""`, `aria-hidden`. That is the default.
- Standalone use (an icon-only role card): pass `alt={ICON3D[name][lang]}`.
- Lazy-load by default. Mark `priority` only on the home category grid's first row and on success screens.
- A home screen loads at most 8 category icons plus 1 banner icon above the fold: about 160 KB at 1x, 320 KB at 2x. Check the Network panel on a throttled 4G profile and include the number in your summary.
- No 3D icon should be the LCP element. If one is, lower its priority or size.

## 8. Adding or replacing an icon later

1. Use `icons/PASTE_INTO_GEMINI.md`, attach the four anchors (`shampoo`, `biscuits`, `gift-box`, `truck`) as style reference, and ask for the new icon with a new file name.
2. Run `node scripts/build-icons3d.mjs ~/path/to/pngs new-name`.
3. Add the name, hue and labels to `src/lib/ui/icons3d.ts` (hue: pick the main body colour of the render).
4. If it is a category, add English and Hindi keywords to `categoryIcons.ts` and a test.

## 9. QA checklist (add to `REDESIGN-CHECKLIST.md`)

- [ ] `ls public/icons3d | wc -l` prints 136.
- [ ] No `.svg` placeholder icons left in `public/icons3d/`.
- [ ] `grep -rn "Icon3D" src/components/AppShell.tsx` finds nothing (no 3D icons in nav).
- [ ] `grep -rnE "<Icon3D[^>]*name=\"[a-z-]+\"" src/` lists only feature and state icons; categories always go through `categoryIcon()`.
- [ ] `ProductThumb` with no image shows the category icon, never a letter.
- [ ] A test catalogue with Hindi-only category names shows the right icons.
- [ ] An unknown category shows `box-sealed`, no broken image.
- [ ] Icons look right on white, `--surface-2` and a `data-ground="dark"` panel.
- [ ] With reduced motion on, nothing moves.
- [ ] `/dev/ui` has an "Icons 3D" section showing all 68 at 56 and 120 px on both surfaces.
- [ ] Unit tests for `categoryIcon()` cover every row in §4.2 plus five Hindi names.
