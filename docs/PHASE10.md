# Phase 10 — Analytics and reporting

Branch: `feat/phase10-analytics` (cut from `feat/phase9-saas`).
Plan: `docs/ROADMAP.md` §6 Phase 10. Exit check: **the owner can see sales, collections, outstanding and ageing, stock value, delivery and team performance for any period up to a year, compared with the period before; each shop's buying rhythm, average order, product mix and churn risk; what each scheme cost and earned; what each area and trip earned after delivery cost; returns and damage; every report downloads as CSV; and an evening summary reaches the owner every day at the hour they pick (9 PM by default)**. This is covered by `tests/analytics.test.ts` and by the seeded 120-day history. The AI layer (§7) is not part of this phase: churn risk is plain maths.

## How it works

### What the numbers mean (`src/lib/analytics.ts`)

- **Sales** = invoices: tax invoices + bills of supply − credit notes + debit notes, by invoice date. Invoices are issued at delivery (or dispatch), so sales lag orders.
- **Orders booked** = non-cancelled orders by the day they were placed (their value at order time).
- **Collected** = confirmed payments against dues by the day received. "Received" leaves out the wallet and credit notes (they move money that was already in). Cash and online are split.
- **Outstanding** = open bills today, aged in the khata buckets (`ageBills`: not due, 1–30, 31–60, 61–90, 90+ days overdue), with the top debtors.
- **Stock value** = current lots × their cost (today's figure, not the period's).
- **Margin** = net taxable sales − cost of goods. Cost per line = the average cost on its sale stock moves, else the product's last cost; return and cancel credit notes take theirs back.
- **Delivery performance**: drops delivered and failed, on time (on or before the promised day), first attempt; trips; rates show "–" when there is nothing to divide by (never a false 0%).
- **Team**: each sales agent's orders, value, visits and strike rate (visits that ended in an order), collected, and the month's VALUE target; each driver's drops, failed, on time, cash taken.
- Days are IST (`"date" + interval '330 minutes'`). Periods (`src/lib/report-periods.ts`, safe for the browser): presets Today, Yesterday, 7 days, 30 days (default), This month, Last month, 90 days, This financial year, or any dates up to **366 days**. Each figure is compared with the period of the same length just before.

### Shops: rhythm and churn risk

- **Usual gap** = average days between a shop's orders over the last 180 days (`RHYTHM_DAYS`), at least 3.
- **Risk**: *high* when the days since the last order are ≥ 3 × the usual gap and > 14; *medium* when ≥ 1.8 × and > 7; else *low*. One order only: *new* if it was ≤ 30 days ago, else *high*. No orders: *none*.
- Per shop: orders, value, average order, orders a month, change against the period before, last order, usual gap, risk; the API filters by area and agent. The shop page adds a month-by-month trend (empty months shown), money owed with ageing, credit notes and their share of sales, visits, category and product mix.

### Scheme ROI

- **Cost** = discounts and free goods given (redemptions not reversed). **Sales on scheme orders** is shown, but it isn't the return: most of it would have happened anyway.
- **Extra sales** = what the shops on the scheme bought this period − what they bought in the period before × (1 + the growth of shops that used **no** scheme). **ROI** = extra sales ÷ cost.
- No fair answer, so "–" with the reason, when: every shop that bought used a scheme (no comparison group), or the records start inside the period before (`fullHistory` false, e.g. 90 days on a new business).

### Route profitability

- By area and by trip: revenue = net taxable sales; cost of goods as above; **delivery cost** = a cost per drop + a cost per trip shared over the trip's drops; result = revenue − goods − delivery.
- The two costs are the owner's own estimates, typed on the Routes page (`settings.reports.tripCost`, `dropCost`, in paise). Without them the page shows the gross margin only and asks for them.

### Returns and damage

- Goods returned as a share of sales; all credit notes by kind (goods returned, rate or discount change, invoice cancelled) and the reasons written on them; lines short at delivery and why; stock moved to damaged and why, with write-offs; the products and shops with the most.

### The evening summary (`src/lib/daily-summary.ts`)

- Worker job `reports.daily_summary` runs **every hour** (`0 * * * *`); for each trial or active business whose `summaryHour` (IST, default 21) it is, it sends one message to every active admin: invoiced, new orders and their value, collected (cash), delivered / not delivered, outstanding and overdue, orders waiting to be confirmed. The key `daily_summary:<day>` makes it once a day, whatever the retries.
- Event `staff.daily_summary` (English and Hindi), with a link to today's reports. In the app and on push always; **WhatsApp** when the owner turns it on for "Daily summary (owner)" in Settings → Messages and the business's WhatsApp channel is set up.
- Staff messages never go on WhatsApp, except events marked `ownerWhatsapp` (only this one): `channelAllowed()` in `notify-events.ts`, used by `notify` and the Messages screen.
- "Send it now" sends at once (its own key, so it can be repeated). Off: `settings.reports.dailySummary = false`.

### Settings, permission, API

- `Tenant.settings.reports` = `{ dailySummary, summaryHour, tripCost, dropCost }` (`src/lib/report-settings.ts`; hour 0–23, costs whole paise up to ₹1,00,000). Saved through `PATCH /api/admin/settings` `{ reports: … }` (needs `settings.manage`).
- Permission `reports.view`: office (admin) only for now.
- `GET /api/admin/reports/<report>?preset=… | from=…&to=…` for `dashboard`, `sales`, `retailers`, `team`, `stock`, `delivery`, `schemes`, `routes`, `returns` (shops: `&areaId=`, `&salesAgentId=`); `&format=csv` downloads it (audited `report.export`). Unknown report 404, bad or over-a-year period 400.
- `GET /api/admin/reports/shop/<id>` one shop. `GET /api/admin/reports/summary` today's preview and settings; `POST` sends it now (audited `report.summary_sent`; 409 when there is no active admin).
- Reports read inside the business's own row-level-security transaction with a 45 s timeout.

## Done

- Analytics library, period helpers, CSV for every report, report settings, the evening summary and its hourly job, the owner WhatsApp exception, permission, APIs and screens. No schema change, no migration.
- Demo history (`prisma/seed-analytics.ts`, called by `npm run db:seed`): 120 days through the real ledger — sales booked and delivered on past dates, payments, credit notes, trips with short and failed drops, scheme redemptions, visits, cash handed over.
- **Bug fixed from Phase 9**: a signed-out visit to `/admin`, `/sales` etc. answered 500 ("Invalid URL '/login'"): the proxy refuses a relative `Location`. `src/proxy.ts` now redirects to an absolute URL built from `X-Forwarded-Host` / `Host` and `X-Forwarded-Proto` (checked: 307 to `http://demo.localhost:3101/login`, and to `https://demo.setu.app/login` behind forwarding headers).

## Screens

- **Reports** (`/admin/reports`, nav item and a button on the dashboard): tabs Overview, Sales, Shops, Team, Schemes, Routes, Returns; period chips, custom dates, CSV of the tab. Each KPI shows its change against the period before (green / red by whether up is good).
  - **Overview**: sales, orders, collected, outstanding, margin, stock value; sales per day (weekly beyond 62 days) with hover amounts; collections by method; ageing; top debtors; stock by category; sales by category; delivery; sales team; the evening-summary card (preview of today, on/off, hour, Send it now, where to turn on WhatsApp).
  - **Sales**: net with and without GST, days with sales, best day; per day (or week); by category, by brand; products net of returns.
  - **Shops**: shops that ordered, average order, at risk or slipping and what they bought before; a table with risk chips, search and sort; a shop's page as above.
  - **Team**: sales team (strike rate, collected, against target), drivers (on time, cash).
  - **Schemes**: cost, sales on scheme orders, extra sales, ROI, each scheme with before → now and budget used, and the reason when ROI can't be worked out.
  - **Routes**: the two cost boxes, by area and by trip.
  - **Returns**: as in *Returns and damage* above.
- Charts are one series in the brand teal (no legend; the title names it), values in ink, hover titles; tables scroll sideways on a phone.

**Checked in a browser** (production build on port 3101, 19 Nov, as admin on the seeded history): Overview (chart, bars, tables), Send it now (arrived in the bell), Shops with the risk filter and a shop page (empty months filled), Schemes (90 days gives the "records start inside the period before" note; 30 days shows figures, negatives as "−₹"), Routes cost form (saved; a trip cost of ₹600 + 3 drops × ₹20 = ₹660 a trip), Team, Returns, Sales; all 9 CSV downloads; unknown report 404; over a year 400; 375 px with no sideways scroll. Not checked: the hourly job firing at 9 PM for real, WhatsApp delivery (needs a live channel), Hindi text on screen.

## Demo data (`npm run db:seed`)

- **demo**: 120 days of trade (about 179 orders, 93 trips). Shops numbered `i % 4 == 3` never get schemes (the comparison group for ROI). One shop stopped ordering 45 days ago (at risk), one 10 days ago (slipping). Visits only on days older than 14. Stock lots are not touched by the history (stock value is today's).
- The seed now takes about 30 s (e-invoice sandbox calls for the history included).

## Tests

`tests/analytics.test.ts` (31 tests; full suite 260 tests in 16 files pass):

- periods: IST periods and the one before, bad or over-a-year periods refused, presets, % change only when there is something to compare;
- churn risk against the shop's own rhythm, a short silence not flagged high;
- report settings defaults and checks; only the owner's summary allowed on WhatsApp for staff; reports for admins only; the IST hour;
- on a scratch business (made by the test, purged at the end) with known trades in Aug–Oct: invoices less credit notes in the period only, booked orders without the cancelled ones, IST days, products and categories netted; money received by method without wallet or credit notes; ageing; delivery on time / first attempt / failures; agent and driver ranking; the regular, at-risk and silent shop; area filter; scheme ROI against shops without a scheme and the refused before-and-after; margin and delivery cost by area and trip; returns, credit notes and shorts; stock with no lots; every report loaded and turned into CSV rows; one business's figures kept from another;
- the evening summary: once a day at the business's hour to the owners, on WhatsApp only when turned on, turned off, sent by hand.

## Still open

- **Plans**: reports aren't gated by plan (core for every plan). Decide whether the deeper pages (schemes, routes, shop analytics) belong to Growth and up.
- **Permission**: only admins see reports; a supervisor or accountant view (area-limited) isn't there.
- Stock value is today's, not the value at the end of the period; no stock ageing or dead-stock report yet.
- Scheme uplift is a simple before / after against shops with no scheme; a shop on two schemes counts for both. Good enough to rank schemes, not an audit figure.
- Route costs are one trip cost and one drop cost for the whole business (no per-vehicle or per-area costs, no fuel from trips).
- The summary is one fixed text; no weekly or monthly report, no email, no PDF.
- Reports run live queries (45 s limit); fine on the demo's history, but a business with years of data may need pre-computed daily totals. Not load-tested.

## Traps

- **`npm run typecheck` missed a duplicate object key** (TS1117 in the dictionary) that `next build` caught: run the build before calling a change done.
- **The proxy must redirect to an absolute URL** (the Phase 9 sign-in redirect returned 500). Build it from `X-Forwarded-Host` / `Host`, never from `req.url` (that carries the server's own host and port).
- Keep the period helpers in `report-periods.ts`: `analytics.ts` imports Prisma, and a client component importing it breaks the browser bundle.
- Sales follow invoices, orders follow order dates: on a day with deliveries of yesterday's orders the two don't match, by design. The summary says both.
- The seed is slower (about 30 s); tests that purge leave `closed-…` tombstones — reseed before a demo.
- Editing `src/lib/i18n/dictionary.ts` with `sed` turns its CRLF line endings into LF: edit it with the editor tools.
