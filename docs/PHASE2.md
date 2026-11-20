# Phase 2 — Catalogue, pricing, schemes, storefront

Branch: `feat/phase2-catalogue` (cut from `feat/phase1-money`).
Plan: `docs/ROADMAP.md` §6 Phase 2. Exit check: **the same product shows different, correct prices and schemes to three test retailers** — covered by `tests/pricing.test.ts` and by the seeded demo (see below).

## How pricing works

- **One quote for everything.** `quoteCart()` (`src/lib/pricing.ts`) prices a cart for one retailer: rates, schemes, free goods, delivery charge, GST, minimum order, delivery days. The cart preview (`POST /api/cart/quote`), the sales agent's order screen and order placement (`placeOrder()` in `src/lib/order-place.ts`) all call it, so the billed total is the total the retailer saw. The client only sends product ids and quantities (or cases), never a price.
- **Rate for a retailer** = their special rate (`RetailerPrice`) ?? their price list's rate (`PriceList` → `PriceListItem`, if the list is active) ?? the product's default rate. `priceSource` says which.
- **Margin** shown to retailers = (MRP − rate × (1 + GST)) / MRP.
- **Visibility and targeting.** A product, scheme or banner with no areas / groups (/ retailers) set is for everyone; otherwise a retailer sees it when their area, any of their groups (or, for schemes, the retailer itself) is listed.
- **Order amounts.** `grossAmount − discountAmount + deliveryCharge = subtotal` (taxable), `subtotal + gstAmount = totalAmount`. GST is per line on the discounted value; delivery charge has its own GST rate (setting). Free goods are order lines at price 0 with `freeSchemeId`. The ledger books Sales = subtotal, so discounts reduce sales directly (no separate discount entry).

## Schemes (`src/lib/schemes.ts`, pure and unit tested)

| Type | Params | Example |
|---|---|---|
| Buy X get Y | buy qty, free qty, free product (blank = same product, per line; set = cross-SKU, pooled over the scope), max sets | Masala Chai buy 12 get 1; 6 soaps → 1 dish wash free |
| Slab | basis quantity or value; slabs of min → % or ₹ off; cap | Snacks 20+ units 2%, 50+ 4% |
| Percent | %, cap, min qty, min value | Key accounts 3% off, up to ₹500 |
| Flat | ₹ off (per order or per unit), min qty, min value | Coupon WELCOME50: ₹50 off ₹1,000+ |

Scope = products / brands / categories (sub-categories included); empty = whole cart. Rules:
- Run in priority order (lower first). Percent and slab work on what is left of each line after earlier schemes, so stacking never takes a line below zero; discounts round down to the paisa and are split over lines by value.
- **Non-stackable** schemes skip lines another scheme already touched, and lock their own lines.
- **Coupon** schemes apply only with the code (case-insensitive) and are not advertised. A wrong / used-up / not-qualifying code is a problem that blocks placing the order.
- **Budget**: a scheme gives at most what is left (discount cut down, free goods drop whole sets). Spending is an atomic `UPDATE … WHERE spent + value <= budget` at order time; if another order used the budget since the preview, the order is refused (409) and the cart re-quotes. **Max uses per retailer** counts non-reversed redemptions (under the per-retailer lock).
- Cancelling an order reverses its redemptions and gives the budget back.

## Done

| Roadmap item | What shipped |
|---|---|
| 1. Brands, categories, banners, pack units, HSN tax, images | `Brand`, `Category` (tree), `Banner` (targeting + date window), `HsnCode` (rate by code; changing it updates every product with the code). Product: brand, category, HSN, Hindi name, search aliases, description, case unit + size (order in units or cases; quantity stored in base units), MOQ, up to 6 photos, visibility by area / group, sort. Migration `catalogue_pricing_schemes` backfills one category per old category string and moves `imageUrl` into `images`. |
| 2. Price lists, per-retailer rates, margin % | `PriceList` + items (create / copy / edit / import), `RetailerPrice` special rates, retailer groups. Admin "view as retailer" shows each rate's source and margin. |
| 3. Scheme engine | See above. Admin list shows state (running / upcoming / ended / budget used / off), orders, spent vs budget. |
| 4. Cart rules | `Tenant.settings.cart` (`src/lib/cart-settings.ts`): minimum order value, delivery charge + free-delivery threshold + its GST, cut-off time (IST), lead days, closed weekdays, holidays, retailer chooses the delivery day (N days ahead), notes. |
| 5. Storefront | Banners, schemes for you, buy again, categories, brands, Hindi ↔ English search (`src/lib/translit.ts`: "chai" finds "मसाला चाय"), product sheet, cart with coupon / delivery day / notes. Same storefront for the sales agent (retailer's own rates). |
| 6. Per-retailer visibility | Products hidden from retailers outside their areas / groups — in the catalogue and refused in the quote. |
| Import | Products import gains brand, hsn_code, name_hi, case_unit, case_size, moq (new categories / brands are created). New **Prices** import: `price_list` or `phone`, `sku`, `price`. |

Screens:
- **Retailer:** Catalogue = storefront (`src/components/Storefront.tsx`, `src/components/store/*`), home shelves (banners, schemes for you, buy again), order pages show discount, FREE lines, delivery charge, coupon, delivery day. Draft cart kept per retailer in the browser.
- **Sales agent:** the retailer page uses the same storefront with that retailer's rates.
- **Delivery:** order screen lists free goods in a "hand these over too" box.
- **Admin:** Products (tabs Products · Categories · Brands · HSN codes · Banners), Pricing (price lists + list editor, retailer groups, retailer rates with **View as this retailer**), Schemes (list with state, builder with live preview), Settings → Cart rules. Shared admin widgets in `src/components/admin/AdminKit.tsx`.

Fixed on the way: `GET /api/admin/users` sent users' password hashes to the browser (now omitted); demo MRPs raised so every product leaves the retailer a positive margin.

New APIs: `GET /api/catalogue`, `POST /api/cart/quote`; admin `brands`, `categories`, `hsn`, `banners`, `price-lists`, `groups`, `schemes`, `retailers/[id]/pricing`; `settings` takes `{ cart }`. `POST /api/orders` now needs `orders.place` and prices through the quote. `GET /api/products` is now admin-only (catalogue.manage); everyone else uses `/api/catalogue`.

Permissions: `pricing.manage` (price lists, retailer rates, groups, schemes) added; `catalogue.manage` now also covers brands, categories, HSN and banners. Both admin-only.

Security: foreign keys and id arrays are not filtered by row-level security, so every id a client sends (category, brand, product, price list, group, area, retailer, free product, banner link) is checked to belong to the tenant (`ownIds` in `src/lib/catalogue-api.ts`). New tables have the same RLS policy as every tenant table; CHECK constraints keep prices, discounts, budgets and case sizes sane.

## Demo data (`npm run db:seed`)

Same product (Masala Chai 250g, MRP ₹95) for the three demo retailers:

| Retailer (OTP phone) | Rate | Why | Schemes |
|---|---|---|---|
| Agarwal, Andheri (9876543210) | ₹82.00 | special rate | Chai 12 + 1 |
| Patel, Bandra (9123456780) | ₹85.00 | default | Chai 12 + 1; Bandra soap → dish wash free; Bandra banner |
| Sai Super Mart, Dadar (9988776655) | ₹81.50 | "Wholesale" price list | Chai 12 + 1; Key account 3% off |

Plus: snacks slab, coupon `WELCOME50` (once per retailer), cart rules (min ₹500, ₹30 delivery under ₹2,000, cut-off 18:00, closed Sunday, choose a day up to 5 ahead), 10 HSN codes, made-up brand names, Hindi names.

Tests: `tests/schemes.test.ts` (18, pure: every scheme type, stacking, budgets, cart settings, IST delivery days, visibility, margin, Hindi search) and `tests/pricing.test.ts` (8, real database: the exit check, offers per retailer, visibility, cases / MOQ / minimum / delivery charge, order = quote with free lines, budget spent and returned on cancel, coupon once, budget race refused, discounted sale in the ledger). Total suite 72.

## Still open

- Stock / inventory and "out of stock" (Phase 3+); free goods are not checked against stock.
- Scheme claims to the brand company (secondary-scheme reimbursement reports) — redemptions are recorded per order, no report yet.
- Banner and product photos are not resized server-side (client compresses before upload).
- Hindi copy on the new admin screens (English only, like the other inner pages); storefront product names show the Hindi name when set.
- Category / brand deletion (deactivate only).
- GST e-invoice still Phase 1 open item.

## Traps

- `pricing.test.ts` creates its own products, price list, group and schemes every run and switches them off afterwards (inactive, so they never show in the demo storefront). `tenant-isolation.test.ts` counts only seeded products (names not starting "Test ").
- Prisma `String[] @default([])` columns are nullable in SQL; Prisma always writes arrays, so this is harmless.
- In this repo's bash tool, heredocs containing an apostrophe fail to parse; write scripts to a file instead.
- Same as Phase 1: restart `next dev` after `prisma generate`, and `rm -rf .next` after adding page folders while dev runs (missing Tailwind classes).
