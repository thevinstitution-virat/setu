# Phase 4 — Delivery operations

Branch: `feat/phase4-delivery` (cut from `feat/phase3-invoicing`).
Plan: `docs/ROADMAP.md` §6 Phase 4. Exit check: **every trip can be loaded, run stop by stop with line-level changes, and closed with load = delivered + returned and cash matching what was collected, with the ledger and GST documents still exact**. This is covered by `tests/delivery.test.ts` and by the seeded demo.

## How it works

- **Trips.** A `Trip` is one vehicle + driver + slot + day (`TRP2627-00001`, per tenant per financial year). Slots are a setting (`settings.delivery.slots`, default Morning / Evening). Status: `PLANNED` (office loads orders) → `STARTED` (the trip has left) → `CLOSED` (day close).
  - Stops are the existing `Delivery` rows (one per order), now with `tripId`, `seq` (stop number), `state` (`ASSIGNED` / `DELIVERED` / `FAILED`), the last failure reason, attempts and an optional delivery code.
  - **Loading** (`addOrders`): orders that are Placed, Confirmed or Packed, not on credit hold, and not on another open trip. An order that failed on a trip can go on a new trip only after that trip is closed, so day-close figures never move.
  - **Starting** (`startTrip`): every stop goes Out for delivery through `dispatchOrder`, which also issues the invoice when the business invoices at dispatch (Phase 3) and creates the delivery code for high-value drops. Orders added to a trip that has already left go out at once. Starting a trip puts the driver on duty.
  - The old single-order "assign to driver" still works (a delivery without a trip). It is refused for orders that are on an open trip, and it now also goes through `dispatchOrder`.
- **Route order.** The office (or the driver, on their own trip) can move stops by hand, or press "Auto route order" (`sequenceStops`): nearest next stop from the warehouse (`settings.delivery.depot`) for shops with a map pin, then the shops without a pin grouped by area and PIN code. This is plain maths with no maps service. Done stops keep their place.
  - **Shop map pins** (`RetailerProfile.lat/lng`) are taken from the first delivery with a GPS fix of 100 m or better, or set by the office on the khata page.
  - "Open route in Google Maps" builds a directions link through the open stops (up to 10). It opens in the phone's maps app, so no API key is needed.
- **Line-level delivery** (`deliverOrder` in `src/lib/delivery.ts`). The driver sends the quantity handed over for each line (0 up to what was ordered), with a reason for any line delivered short (`SHORT_REASONS`). Missing lines count as delivered in full, and handing over nothing is refused (use "Not delivered" instead). Money stays exact:
  - **Invoiced at dispatch:** a `return` credit note on the invoice for what wasn't handed over (Phase 3 rules, pro rata per line). The order keeps its ordered amounts, and the documents carry the money.
  - **Invoiced at delivery:** the order lines are cut to what was handed over, with the scheme discount in proportion and the same rounding as the cart quote (`repriceOrder` in `src/lib/delivery-math.ts`). The invoice is then issued for delivered goods only. `OrderItem.orderedQty` and `Order.orderedTotal` keep the original figures. The delivery charge stays.
  - **Prepaid wallet:** the wallet pays only the net amount (invoice minus the short-delivery credit), and the rest of the hold goes back to the wallet.
  - `OrderItem.deliveredQty` and `shortReason` are stored either way. The driver's screen previews the amount with the same pure functions (`delivery-math.ts`).
- **Not delivered** (`failDelivery`): reason (`FAIL_REASONS`) plus an optional note (required for "Other"). The stop becomes `FAILED` and the order goes back to Packed. Any invoice stays: the same invoice is used when it goes out again. Cancelling an order that is on a trip takes it off a planned trip, or closes its stop on a running one.
- **Proof.** Photo, signature, GPS position and accuracy, and time, as before.
  - `settings.delivery.photoRequired` makes the photo compulsory for drivers.
  - **Delivery code:** for orders at or above `settings.delivery.codeAbove`, a 4-digit code is created at dispatch. Only the retailer (and dispatch staff) can see it, in the app, and the driver must enter it. Order APIs never send the code to drivers.
  - After 5 wrong codes in an hour (logged as `delivery.code_wrong`), the driver is stopped and the office delivers from their side.
- **Crates and jars** (`Returnable`, `ReturnableMove`). Types with a charge per missing unit are a setting. Every movement is an append-only row (a trigger refuses edits and deletes): `DELIVERY` (given / taken at a drop), `PICKUP` (driver collects empties at a shop on their trip), `OPENING`, `ADJUST` (note required) and `CHARGE`. A shop's balance is given minus taken. "Charge for missing" bills units × charge as a penalty bill (it shows in khata and ageing) and takes those units off the balance.
- **Delivery preferences.** Each shop can choose how goods are handed over (ring the bell, at the door, in hand, keep in a bag) and leave a note for the driver. The retailer sets this in Account; the office can set it on the khata page. The driver sees both on every stop.
- **Duty.** The driver switches on and off duty (`DutyShift`). Location is recorded only when duty starts and ends, never in between (DPDP). Going off duty is refused while a trip is running.
- **Day close** (`closeTrip`, `tripSummary`). Shows the load sheet per product (loaded, delivered, returned), stops delivered / failed / open, value loaded versus delivered, collected per method at this trip's stops, cash expected, the driver's whole cash in hand, crates given and taken, and the failed stops with reasons.
  - Closing with open stops is refused unless forced; forcing marks them not delivered ("Ran out of time").
  - The figures are frozen in `Trip.closeSummary`.
  - The cash itself is received through the existing handover screen (Phase 1).
- **Events.** `trip.started` (with the order ids) is queued for Phase 7 notifications (ETA message to each retailer). `order.status` and `order.delivered` as before.

## Done

| Roadmap item | Where |
|---|---|
| 1. Trips + dispatch board | `src/lib/trips.ts`, `/api/trips/**`, Admin → Dispatch |
| 2. Line-level delivery with reasons, deliver-all | `src/lib/delivery.ts`, `/api/orders/[id]/deliver`, driver deliver screen |
| 3. Returnables, pickups, photo, shortage charge | `Returnable` / `ReturnableMove`, `/api/returnables/**`, deliver screen, khata |
| 4. Proof: photo + geo + time, signature, OTP to the retailer | delivery code (`settings.delivery.codeAbove`), photo-required setting |
| 5. Route order (manual + automatic), map link, call / directions | `sequenceStops`, `/api/trips/[id]/sequence`, Google Maps links |
| 6. Retailer delivery preferences shown to the driver | `RetailerProfile.deliveryPref/deliveryNote`, Account, khata, stop cards |
| 7. Driver on / off duty | `DutyShift`, `/api/delivery/duty`, driver home |
| 8. Day close per trip | `closeTrip` / `tripSummary`, trip page |

## Screens

- **Admin → Dispatch** (`/admin/dispatch`):
  - Date picker (`?date=`) and the day's trips by slot, with stops, delivered, not delivered, open and value.
  - "Ready to go": orders due that day or earlier, grouped by area, with select-all and "Tried before" / "No map pin" badges.
  - "New trip" (slot, driver, van, note, with the ticked orders), or "Add to trip".
  - Vehicles under `/admin/dispatch/vehicles`.
- **Trip page** (`/admin/dispatch/[id]`):
  - Header with an edit sheet.
  - Stops in route order: move up/down, auto route order, remove (while planned), mark not delivered, and a Google Maps route.
  - Start / Close (with "Close anyway").
  - Printable load sheet and the day-close card, with a link to Cash to receive the driver's cash.
- **Settings → Delivery**: slots, delivery-code amount, photo required, warehouse location; **Crates & jars** types.
- **Khata (retailer)**:
  - "Delivery" card: preference, driver note, map pin.
  - "Crates & jars held": charge for missing, adjust, opening count.
- **Driver home** (`/delivery`):
  - On/off duty switch, drops left and cash collected on the trip.
  - Today's trips (start a planned trip, sort by distance, route in Maps).
  - Stop cards with preference, note, "Code needed", Call and Directions.
  - Finished trips folded away; orders assigned without a trip listed separately.
- **Deliver screen**:
  - − / + per line with a reason when short, the amount recalculated live, and the delivery code.
  - Crates given / taken with the shop's balance, payment, signature and photo.
  - "Couldn't deliver" sheet; after delivery, the invoice / credit note to share.
- **Delivery history**: "Short: n lines" and stops not delivered, with the reason.
- **Retailer**:
  - Account → Delivery preferences.
  - The order page shows the delivery code while the order is out for delivery, and delivered vs ordered per line afterwards.
  - Khata → crates and jars with you.

Checked in the browser at 375 px (production build), with no horizontal scroll. The run:

1. Made a trip from the board, ran auto route order, started it (2 invoices issued).
2. As the driver, delivered one order 2 jars short with 3 crates and cash. The credit note (₹483.02) matched the screen's preview.
3. Marked the other stop "Shop closed".
4. Closed the trip: load 46 = delivered 36 + back 10, cash expected ₹4,407.30, 3 crates.
5. Checked the settings and khata cards.

The retailer screens (delivery code card, preferences) were checked only by type check and lint, not in the browser.

## Demo data (`npm run db:seed`)

- Two vans (MH02AB1234, MH04CD5678).
- Crate types: Crate (₹150 if missing) and 20 L jar (₹200).
- Warehouse location set; delivery code from ₹5,000.
- Agarwal General Store and Patel Kirana Store have map pins and delivery preferences. Sai Super Mart has no pin, so it gets one on its first delivery.

## Tests

`tests/delivery.test.ts` (8, real database). Full suite: **113 passing**; `tsc`, eslint (0 errors) and `next build` are clean.

- Route order (nearest first, then unlocated by area) and the reprice maths.
- A full trip invoiced at dispatch:
  - auto route order, start (invoices issued, driver on duty);
  - refused empty and reason-less deliveries;
  - a short delivery giving a return credit note and the exact receivable, with crates and cash;
  - a failed stop back to Packed, and the "already on trip" guard;
  - close with the load sheet, crates, cash and value;
  - the failed order re-sent on the same invoice.
- Close refused with open stops, then forced.
- Prepaid wallet settled for the net amount after a short delivery.
- Invoice at delivery: the order is cut, and the invoice equals the cut order, with `orderedTotal` and the load sheet still showing what left.
- Delivery code: created at dispatch; missing and wrong codes refused, the right one accepted.
- Crates: balance, the "holds only" guard, the charge bill on the receivable, history immutable.

## Still open

- **Spot sales from van stock, adding a new customer and quick orders from the driver's phone** need van stock (Phase 5, inventory) and the new-store approval queue (Phase 6). Not built here.
- **ETA SMS / WhatsApp** to retailers: the `trip.started` event is queued, but sending needs the SMS / WhatsApp provider (Phase 7).
- **In-app map view and road distances** need a maps provider (Phase 8). Today, route order is straight-line distance and the map is the Google Maps link.
- Scheme budgets are not given back when a line is delivered short. When invoicing at delivery, the discount is cut in proportion to the quantity, which is exact for per-unit offers but only approximate for slab and buy-X-get-Y offers. The free-goods line is whatever the driver hands over.
- The delivery charge stays as ordered even if a short delivery takes the goods below the free-delivery amount.
- Returned goods don't go back into stock yet (no stock until Phase 5).
- Hindi copy on the new screens (English only, like the other inner pages).

## Traps

- An order that failed on a trip can't go on a new trip until that trip is closed (on purpose: day-close figures must not move).
- Drivers never get `Delivery.code` from any API. If you add an API that includes `delivery`, use `omit: { code: true }` unless the reader is the retailer or dispatch staff.
- `ReturnableMove` is append-only (trigger). To fix a count, add an `ADJUST` move; `npm run db:seed` truncates, which works.
- `prisma generate` fails with EPERM on Windows while `npm run worker` (or a dev server) has the query engine loaded. The TypeScript client is still written; only the engine copy fails, and that is harmless when the Prisma version hasn't changed. Delete the leftover `query_engine-windows.dll.node.tmp*` files.
- Same as before: restart `next dev` after `prisma generate`, and heredocs containing an apostrophe fail in this repo's bash tool.
