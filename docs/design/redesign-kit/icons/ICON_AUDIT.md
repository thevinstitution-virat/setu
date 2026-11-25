# VBiz Pro: icon audit and what to apply

Repo: `thevinstitution-virat/setu` @ master (read 24 Nov 2026).

## 1. What the app has today

- **One hand-drawn line set**: `src/components/Icon.tsx`. It has 55 SVG paths with a 2px stroke, used in about 400 places through `<Icon name="…" />`.
- **A second, separate line set** for the landing page: `src/components/landing/pro/Icon.tsx`. It has 21 icons with a 1.9px stroke, and several of them repeat the app set with different shapes (truck, cart, bell, pin, tag, wallet).
- **No 3D or illustrated icons anywhere.** `public/` holds only the VBiz logos, two decorative SVGs and the Next.js starter SVGs (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`).
- **No icon dependency** in `package.json`.

## 2. Missing icons

| Where | What it shows now | Problem |
|---|---|---|
| `store/shared.tsx` → `ProductThumb` | The first letter of the product name on a tinted square | Every SKU without a photo looks like an avatar. This is the biggest visual gap in the catalogue, "Buy again", the cart and orders. |
| Categories (`Category.imageKey`) | Nothing when there's no image | The category grid in `02-retailer-home` has nothing to show. |
| Banners with no `imageKey` | A dark panel with text only | Scheme banners have no visual. |
| Empty states (retailer home "no order yet", `admin/orders` empty, notifications, search) | Plain text, or a grey `box` line icon in hard-coded `#9aaeaa` | No visual and no warmth. |
| Order placed, khata paid, scheme unlocked | No success visual at all | The motion moments in the plan have no artwork. |
| Line icons the redesign needs but `Icon.tsx` lacks | n/a | `camera` (shelf audit; it exists only in the landing set), `whatsapp`, `handCoins` (cash handover), `gauge` (credit), `storefront` (retailers), `reorder`, `minus`, `back`, `calendar`, `filter`, `sort`, `barcode`, `crosshair`, `crate` (returnables), `target`, `trophy`, `van`, `heart` |

## 3. Icons in bad shape or used wrongly

- **Download shown as a flipped upload.** `admin/khata/page.tsx:213` uses `upload` with `rotate-180` for "Download CSV", although a `download` icon exists.
- **Back shown as a flipped arrow.** About 12 places use `arrow` + `rotate-180` instead of a proper back icon, for example `complaints/[id]`, `invoices/[id]`, `khata/[retailerId]`, `dispatch/vehicles` and `purchase-orders/[id]`. Some screens use `chevronLeft` instead, so back looks different from screen to screen.
- **Star for AI.** `admin/products/page.tsx:169` shows a `star` for "Catalogue assist". It should be `sparkle`, which is what "Ask" uses.
- **Overloaded icons.**
  - `box` stands for orders, packages and empty states.
  - `book` stands for khata.
  - `users` stands for both teams and price-list groups.
  - `eye` stands for both "support access" and "show secret".
- **Weak drawings.**
  - The `rupee` path is crude and reads as a "7" at 16px.
  - The `settings` gear clogs into a blob at 16–18px.
  - `stock` (house shape) and `home` look alike in the side rail.
- **Stepper uses typed characters.** `QtyControl` draws `−` and `+` as text in 32px buttons. That is below the plan's 48px touch target, and the two glyphs have different weights.
- **Close as text.** The sheet's close button is the word "Close" rather than an icon button.
- **Two stroke weights.** The landing set uses 1.9px and the app set uses 2px, so the landing and the app don't match.

## 4. What to apply

### Tier 1: line icons (nav, buttons, tables, inputs, chips)

Follow your plan in §3 Tier 2: **Phosphor** (`@phosphor-icons/react`), duotone for nav and feature tiles, regular for inline controls.

To avoid touching about 400 call sites, **keep the `<Icon name>` API**. Rewrite `Icon.tsx` as a map from the existing names to Phosphor components, then delete `landing/pro/Icon.tsx` and point the landing page at the same map.

| Existing name | Phosphor | | Existing name | Phosphor |
|---|---|---|---|---|
| home | House | | receipt | Receipt |
| bell | Bell | | wallet | Wallet |
| chat | ChatCircleText | | book (khata) | BookOpenText |
| cart | ShoppingCartSimple | | cash | Money |
| box (orders) | ClipboardText | | rupee | CurrencyInr |
| stock | Warehouse | | qr | QrCode |
| truck | Truck | | percent | Percent |
| route | Path | | settings | GearSix |
| pin | MapPin | | alert | WarningCircle |
| map | MapTrifold | | sparkle | Sparkle |
| tag (scheme) | Tag | | mic | Microphone |
| gift | Gift | | layers | Stack |
| users | UsersThree | | clipboard | ClipboardText |
| arrow | ArrowRight | | menu | List |

**New names:**

| Name | Phosphor | | Name | Phosphor |
|---|---|---|---|---|
| back | ArrowLeft | | sort | SortAscending |
| minus | Minus | | barcode | Barcode |
| camera | Camera | | crosshair | Crosshair |
| whatsapp | WhatsappLogo | | crate | Basket |
| handCoins | HandCoins | | target | Target |
| gauge | Gauge | | trophy | Trophy |
| storefront | Storefront | | van | Van |
| reorder | ArrowsClockwise | | heart | Heart |
| calendar | CalendarDots | | attendance | CalendarCheck |
| filter | FunnelSimple | | | |

Fix the misuses in §3 while you migrate: replace every `rotate-180` icon, change the AI star to `sparkle`, give the stepper real Minus/Plus icons in 48px buttons on mobile, and use an X icon button to close sheets.

### Tier 2: 3D icons (the new Gemini set, 68 icons)

Use the 3D icons **only** in:
- category tiles
- the category rail
- scheme banners
- the product image fallback
- empty states
- success screens
- onboarding and login
- role-picker cards

**Never** use them in buttons, the bottom tab bar, tables, chips or inputs. This is the same rule as in VMedics.

- **Product image fallback:** change `ProductThumb` so that a SKU with no photo shows the 3D icon of its category instead of a letter. Look the icon up in `categoryIcons.ts`, matched by category name, with a fallback to `box-sealed`.
- **Category image fallback:** use the same lookup for any category without an image.
- **Banner fallback:** a scheme banner with no image shows `gift-box` on the yellow card.

### Changes to your redesign PROMPT.md, based on what we learned in VMedics

1. **Shadow.** Your PROMPT.md asks for a "soft contact shadow" baked into each render. Change it to **no baked shadow**, and draw the shadow in CSS (`filter: drop-shadow(0 10px 14px rgb(16 24 17 / .14))`). Baked shadows looked dirty on dark mode and on coloured tiles in VMedics.
2. **Animation.** Gemini can't produce dotLottie files. Ship CSS motion (bob, wobble, tap-lift) on the WebP, the way the VMedics `animations.css` does, and keep Lottie as an optional later upgrade.
3. **Output.** Done (26 Nov 2026): the 68 renders are exported as `{name}.webp` (512 px) and `{name}-2x.webp` (1024 px) in `icons3d/`. See `ICONS_3D_GUIDE.md`.
4. **Names.** File names in the Gemini prompt match §3 of PROMPT.md exactly (`shampoo`, `gift-box`, `ledger`, `empty-cart` and so on), so the files can replace the placeholder SVGs one for one.
