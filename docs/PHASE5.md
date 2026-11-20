# Phase 5 — Inventory and warehouse

Branch: `feat/phase5-inventory` (cut from `feat/phase4-delivery`).
Plan: `docs/ROADMAP.md` §6 Phase 5. Exit check: **stock on screen always equals the sum of its moves, nothing goes below zero, every unit that leaves the warehouse ends up sold, back on the shelf, in the damaged bin or explained by a reasoned adjustment, and the Phase 1–4 money and delivery rules still hold**. This is covered by `tests/stock.test.ts` and by the seeded demo.

Stock tracking is **off by default** (`settings.inventory.enabled`). With it off, nothing in Phases 1–4 changes.

## How it works

- **Places** (`StockLocation`): warehouses (one is the loading warehouse, `isDefault`), one van place per vehicle (made the first time that van is loaded), and one damaged bin. "Main warehouse" and the bin are created on first use.
- **Batches** (`StockLot`): product + batch + expiry + place, with quantity (never below zero, a database check), cost per unit and received date. Products without batches use one lot with no batch name.
- **Moves** (`StockMove`): append-only (a trigger refuses edits and deletes). Every change to a lot is a move with a kind, quantity, from / to place, reason, note, cost and the order / trip / purchase it belongs to. Kinds: `OPENING`, `PURCHASE`, `TRANSFER`, `LOAD`, `UNLOAD`, `SALE`, `RETURN`, `DAMAGE`, `WRITE_OFF`, `SUPPLIER_RETURN`, `ADJUST`.
- **Locking.** Each change takes a transaction lock per place + product (`pg_advisory_xact_lock`, keys sorted), so two vans loading at once can't both take the last case.
- **FEFO.** Stock always leaves first-expiry-first (`pickFefo` in `src/lib/stock-math.ts`). Expired batches (expiry before today, India time) are never picked for loading or selling; they can only go to the damaged bin.
- **Available to sell** = sellable warehouse stock + van stock − quantity on open orders (Placed, Confirmed, Packed, Out for delivery).

### Buying

- **Suppliers** (the principal companies): name, contact, phone, email, GSTIN, address. A product can have a usual supplier, a reorder level, a reorder quantity and "expiry date needed when receiving" (`trackExpiry`).
- **Purchase orders** (`PO2627-00001`, per financial year): Draft → Sent → Partly received → Received, or Cancelled. Only drafts can be edited. Printable, and can be copied as text for WhatsApp.
- **Receiving goods** (`receiveGoods`, a GRN `GRN2627-00001`): supplier, warehouse, optional purchase order, supplier bill number and date, and lines with quantity, batch, expiry, manufacture date and cost. Expiry is required when the product tracks it, and already-expired batches are refused. The purchase order's received quantities and status update, and the product's last cost is kept for valuation and the next order.
- **Reorder** (`reorderList`): products whose available + on order is at or below the reorder level. The suggestion is the reorder quantity, or enough to reach twice the level, rounded up to whole cases. "Draft purchase orders" makes one draft per supplier; products without a usual supplier are listed as skipped.

### Vans

- **Load plan** (`loadPlan`): per product, what the trip's open stops need, what is already in the van (minus what other open trips on that van need), the buffer for spot sales (`settings.inventory.bufferPct`, default 10 %, rounded to cases) and the suggested quantity to load, with the batches FEFO would pick.
- **Loading** (`loadVan`) moves goods from the loading warehouse to the van. It is refused (409 with the shortage list) when the warehouse records are short; "Load anyway" books the missing units in first as an `ADJUST` "loaded_unrecorded", so the records catch up with what is on the shelf. Starting a trip and adding orders to a running trip top the van up to what the stops need (`ensureLoaded`), with the same refuse / override rule.
- The van can't be changed on a trip once something has been loaded onto it.
- **Selling.** Delivering an order takes the delivered quantity out of the van, FEFO, as `SALE` moves linked to the order lines. Deliveries never fail because of stock: missing units are first booked in as `ADJUST` "sold_unrecorded" and show in the history for the office to look at.
- **Van stock free to sell** = on hand − expired − what open stops on running trips still need.
- **Unloading** (`unloadVan`, after day close): per product, good units back to the warehouse, damaged units to the bin (expired go first) and units kept in the van for tomorrow. Any gap between what the van should hold and what was counted is booked as `ADJUST` "van_shortage" or "van_found".

### Spot sales (from Phase 4's open list)

A driver on a running trip can sell from the free van stock to any shop (and, while a trip is on the road, read that shop's dues to collect) (`spotSale` in `src/lib/spot-sale.ts`), in one transaction: place the order with the normal prices, schemes and credit rules (`order.spot = true`), refuse a shop on credit hold, check against free van stock, add it as a stop on the trip, dispatch it (invoice) and deliver it with optional payment, crates and photo. The quote endpoint shows the same figures first.

### Returns, damage and adjustments

- **Returns.** A `return` credit note on a delivered order can put the goods back: Good (back to the warehouse, into the batch they were sold from), Damaged or Expired (to the bin). It is capped at what was sold minus what has already come back.
- **Damage** moves goods to the bin with a reason (`DAMAGE_REASONS`). "Move expired to damaged" moves every expired warehouse batch at once. From the bin, goods are written off (`WRITE_OFF`) or returned to the supplier (`SUPPLIER_RETURN`).
- **Adjustments** (`adjustStock`) add or remove units with a reason (`ADJUST_REASONS`: stock count, found, lost, sample, own use, opening, other — note required for other). Transfers move goods between warehouses.

### Order-time stock check

`settings.inventory.orderCheck`: `off`, `warn` (default: the cart and order show "Only N in stock" but the order goes through) or `block` (the same message stops the order). It runs in `quoteCart`, so the retailer app, sales agents and the office all get it. Spot sales skip it (they check van stock instead).

### Alerts

`stockAlerts`: products to reorder, batches expiring within `settings.inventory.expiryAlertDays` (default 7) and expired batches still in stock. The storefront shows "Out of stock" and "Few left" badges (`stockBadges`).

## Done

| Roadmap item | Where |
|---|---|
| 1. Warehouse stock with batches and expiry, FEFO | `StockLocation` / `StockLot` / `StockMove`, `src/lib/stock.ts`, `src/lib/stock-math.ts` |
| 2. Stock moves: purchase in, to van, sale, return (good / damaged / expired), adjustment with reason | `receiveGoods`, `loadVan` / `unloadVan`, `sellDelivered`, `restockReturn`, `adjustStock` / `damageStock` / `clearDamaged` |
| 3. Auto load sheet from orders + buffer; van stock for spot sales | `loadPlan`, `/api/trips/[id]/load`, `spotSale`, `/api/delivery/van`, `/api/delivery/spot-sale` |
| 4. Reorder points, alerts, purchase order to the principal | `reorderList`, `draftReorderPos`, `/api/purchase-orders/**`, `stockAlerts` |
| 5. Order-time stock check, warn or block per tenant | `settings.inventory.orderCheck`, `quoteCart` |

## Screens

- **Admin → Stock** (`/admin/stock`, with a sub-menu on every stock page):
  - Overview: stock value, to reorder, expiring soon and expired tiles; filter chips (`?filter=low|out|expiring|expired`) and search; per product available, warehouse / vans / on open orders, next expiry, "Reorder" / "Out" badges.
  - Product sheet: batches first-expiry-first, the last moves, Adjust stock (reasons split by + / −) and Move to damaged.
  - "Move expired to damaged" with a confirm.
  - When tracking is off, one card pointing to Settings.
- **Receive goods** (`/admin/stock/receive`, `?poId=` prefills): supplier, open purchase order, warehouse (hidden with one), bill number and date, lines in units or cases, batch, expiry ("needed" when tracked), mfg date, "Another batch", running total, then the GRN number.
- **Purchase orders**: list (Open / All, by supplier); new / edit draft (supplier's products first, cost from last cost, units or cases); detail with ordered vs received, receipts, Mark sent, Cancel, Receive goods, Print (a clean printable order) and Copy for WhatsApp.
- **Reorder**: products to reorder grouped by supplier, all ticked → "Draft purchase orders", with links to the new drafts and the skipped products.
- **Goods received**: list and receipt detail. **Suppliers**: list, add / edit, turn off. **History**: every move with filters (product, kind, place, dates) and "Load more". **Places**: warehouses (add, edit, loading warehouse, turn off when empty), vans, the damaged bin with Write off / Return to supplier, and a transfer between warehouses.
- **Trip page**: "Van stock" card (need / in van / buffer / to load, first-expiry batches, Load van, "Load anyway" on a shortage); Start trip and the board's "Add to trip" show the shortage with "Start anyway" / "Add anyway"; after closing, "Unload the van" (good / damaged / keep, live missing count, result).
- **Credit note** (return): "Goods back in stock?" Good / Damaged / Expired / Don't put back, then how many units went where.
- **Settings → Stock**: track stock, order check (don't check / warn / refuse), van buffer %, expiry warning days. **Product form**: reorder level, reorder quantity, usual supplier, expiry needed when receiving. **Pipeline**: a stock alert strip.
- **Driver**: "Van" in the bottom menu and "Van stock" / "Spot sale" on the trip card (only with stock tracking on and a van). Van stock shows on hand / for stops / free to sell and batches (expired in red). Spot sale on one screen: shop search, products from free van stock (capped), live bill with problems and warnings, payment, crates, signature and photo, then the invoice to share.
- **Retailer storefront** (and the sales agent's order screen): "Out of stock" (card muted, still orderable) and "Few left" chips; the cart shows stock warnings in amber and "Only N in stock" on the line. **Admin → Orders**: "Spot sale" chip.

Checked in the browser at 375 px (production build), with no horizontal scroll on all 12 admin pages. The run:

1. Moved the 10 expired cookies to the bin (stock value −₹460).
2. Received 3 boxes (72) against the sent purchase order: GRN2627-00005, order Partly received.
3. Made a trip, the van card suggested 21 units (3 + a case of buffer, 5 + 1), loaded, started (no second load).
4. As the driver: van stock 15 / 3 held / 12 free; spot sale to Sai Super Mart (minimum order applied, then ₹818.12 cash, INV2627-00003); delivered the planned stop.
5. Closed and unloaded 5 good + 2 damaged: 1 bottle booked missing. Oil loaded 15 = 7 sold + 5 back + 2 damaged + 1 missing.
6. Return credit note for 2 dal put back on the shelf.
7. "Few left" chips on the sales agent's storefront; a cart quote over stock gave the warning and `stockShort`.

The retailer's own storefront was checked through the shared component (the production build doesn't hand out the dev OTP).

## Demo data (`npm run db:seed`)

- Stock tracking on, "warn" when short.
- Bhiwandi warehouse (loading warehouse) and five suppliers with made-up names.
- Four goods receipts with batches. Potato Chips has a batch expiring in 5 days; Chocolate Cookies has 10 packs already expired (to move to damaged).
- Basmati Rice and Bathing Soap are below their reorder level; Dish Wash Liquid is out of stock.
- Reorder purchase orders drafted for the low items; the first is marked sent.

## Tests

`tests/stock.test.ts` (16, real database), plus a tenant-isolation test that every table with a `tenantId` has forced row-level security and a policy. Full suite: **130 passing**; `tsc`, eslint (0 errors; the 16 warnings are all in older files) and `next build` are clean.

- FEFO picking (expired skipped, no-expiry last), load sheet, buffer and reorder maths.
- Receiving: expiry required when tracked, expired batches refused; a purchase order received in two deliveries, batch by batch.
- Order check: warn, refuse or ignore per the setting, counting open orders.
- Load plan with buffer, loaded FEFO; starting doesn't load twice; delivery sells from the van.
- Spot sale only from free van stock; the driver sees a new shop's dues only while on the road.
- Close then unload: damaged to the bin, the rest back, the gap booked as missing.
- Return into the batch it was sold from, never more than sold.
- Start refused when the warehouse can't cover it, unless overridden; an office delivery with no stock recorded books the gap and still delivers.
- Tracking off moves no stock.
- Adjust with a reason, expired to the bin, write-off; reorder list and one draft PO per supplier.
- History append-only, lots never below zero.

## Still open

- **Adding a new customer and quick orders from the driver's phone** need the new-store approval queue (Phase 6).
- **Low-stock and expiry notifications** (SMS / WhatsApp / push) need Phase 7; alerts show in the app only.
- No stock valuation report by period (FIFO cost of goods sold) yet; the overview shows value at last cost.
- Purchase bills are recorded as goods received only; supplier payables and input GST are not in the ledger.
- Stock counts are adjustments one product at a time; there is no full stock-take sheet yet.
- **Van-sales-only runs:** a trip can't start with no orders, so a driver can't go out just to spot-sell. Allowing it needs a choice of what to load (a fixed van list or last week's sales).
- A shop on credit hold is refused a spot sale even if it pays cash on the spot (the order is placed before the payment). Paying first would need a "collect, then sell" order of steps.
- Expired stock in vans is not swept by "Move expired to damaged" (warehouses only); it goes to the bin at unload.
- Purchase order drafts from Reorder use the suggested quantity; change them on the draft.
- Hindi copy on the new screens (English only, like the other inner pages). The driver's "Van" menu label has Hindi.

## Traps

- `StockMove` is append-only (trigger). To fix stock, add an `ADJUST` move; `npm run db:seed` truncates, which works.
- Read stock levels through `stockLevels` / `vanStock`, never by summing lots in a route: reserved and expired quantities are subtracted there.
- `src/lib/stock.ts` is server-only. Client components use `src/lib/stock-math.ts` and `src/lib/inventory-settings.ts`.
- `prisma migrate dev` once created an empty duplicate migration and then hung holding the migrate lock. Use `migrate dev --create-only`, check the SQL, then `migrate deploy`.
- Same as before: restart `next dev` after `prisma generate`; `prisma generate` EPERM on Windows is harmless (delete the `.tmp*` files).
