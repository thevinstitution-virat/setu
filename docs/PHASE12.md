# Phase 12 — Forecast, AI gateway and catalogue assist

Branch: `feat/phase12-forecast-ai` (cut from `feat/phase11-automation`).
Plan: `docs/ROADMAP.md` §7, the AI layer: **A6** next-day load sheet and reorder suggestions (maths), one **AI gateway** that any feature can call, and **A13** catalogue assist (Hindi names, HSN/GST hints, tidying an imported product sheet). Exit check: **the load sheet for tomorrow and each product's demand forecast are on screen; each morning one reorder suggestion per supplier arrives, and accepting it makes a draft purchase order; catalogue assist proposes Hindi names and HSN codes that a person checks, edits and applies; a product sheet can be tidied before import; all of it works with no AI key, and turns to AI once a key is set and the plan allows it; every AI call is logged with its cost and credits, and a business can cap its credits**. Covered by `tests/forecast-math.test.ts`, `tests/catalogue-rules.test.ts` and `tests/forecast-ai.test.ts`.

## The guardrail

The same as Phase 11: nothing changes by itself. A reorder becomes a **draft** purchase order that someone still checks and sends; a catalogue suggestion changes a product only when someone applies it. The AI only ever proposes; the business's own HSN table always decides the GST rate.

## A6 — demand forecast (`src/lib/forecast-math.ts`, `src/lib/forecast.ts`)

- **Demand** = units on orders that weren't cancelled (`orderedQty`, else `quantity`), by the IST day the order was placed, for the **56 days** before today (today isn't over, so it's left out). Every day is present, zeros included.
- **Level**: an exponentially weighted average, each day's weight halving every **14 days** back.
- **Weekday pattern**: that weekday's average ÷ the overall average, pulled towards 1 when there are few such days (`(k × raw + 3) ÷ (k + 3)`), at most 3. Forecast for a day = level × that weekday's factor.
- **Spread** (sigma): how far each day was from the average × its weekday factor.
- **Reorder** ((s, S) policy, `reorderNeed`): reorder point = daily × lead days + z × sigma × √lead; order up to = daily × (lead + cover days) + z × sigma × √(lead + cover). Order only when available + on order is at or below the reorder point, enough to reach the order-up-to level, rounded up to whole cases. z comes from the service level (90% → 1.28, 95% → 1.64). If the product's own reorder level asks for more, that wins.
- **Available** is stock less what is already booked (as on the stock screen), so a product with open orders runs out sooner. **On order** = open purchase order lines (draft, sent, part received) not yet received.
- **Lead time**: new `Supplier.leadDays` (0–90, default 3), "Days to deliver" on the supplier form, "Delivers in N days" on the card. Products without an active supplier use 3 days and get no reorder suggestion.

### Load sheet (`loadSheet`)

- For a day (default tomorrow): the orders going out (the dispatch board's ready orders: placed / confirmed / packed, not on an unapproved credit hold, due that day or earlier or undated, not on a trip that has started) plus, with **top-up** on, extra up to the usual for that weekday for spot sales and late orders.
- The total is rounded up to whole cases only when the extra is at least **half a case** (a usual of 4 bottles doesn't load a case of 24). Never less than booked.
- With stock tracking on: what's in the warehouses and how many short. Grouped by category, CSV and print.

### Reorder suggestions (`reviewReorder`, `applyReorder`)

- Daily (part of the 06:00 job, and Run now): one `reorder` suggestion per supplier with the products to order, each line with qty, last cost, available, on order, daily demand and days left. Reasons: how many run out before the goods would arrive, and the first products with their days left. Needs the forecast on, the `inventory` module and stock tracking.
- One open suggestion per supplier: no second one until it's decided or expires (3 days). `dedupeKey` `reorder:<supplier>:<day>`.
- Accepting (`stock.manage`) makes a **DRAFT** purchase order through `createPo`, expected after the supplier's lead days, note "Drafted from a reorder suggestion". Inactive products are dropped; the draft then counts as on order, so the next review doesn't suggest it again.

## AI gateway (`src/lib/ai.ts`, `src/lib/ai-settings.ts`)

- One call for every feature: `aiJson({ tenantId, actorId, feature, system, prompt, schema, maxTokens })`. The model must answer with JSON that fits a zod schema. It **never throws for AI trouble**: it returns `ok: false` with a reason (`no_provider`, `plan`, `off`, `cap`, `refused`, `error`) so the caller falls back to its rules.
- **Provider** from the server's environment: `AI_PROVIDER` = `anthropic` (needs `ANTHROPIC_API_KEY`), `fake` (tests), or empty / `none` (default: rules only). `AI_MODEL` (default `claude-opus-5-5`; `claude-haiku-5-5` costs about 40 times less) and `AI_USD_PAISE` (paise per US$, default 8800). Listed in `.env.example`.
- The Anthropic call uses the official SDK (`@anthropic-ai/sdk` 1.10): `client.beta.messages.parse` with a zod output format, `effort: "low"`, and server-side fallback to another model if the chosen one is overloaded. Refusals and cut-off answers are reported, typed SDK errors (rate limit, bad key, others) give a plain message.
- **Personal data** is removed from every prompt before it leaves (`scrubPersonal`: phone numbers, emails, GSTINs, PANs). Catalogue prompts carry only product names, brands, categories and units.
- **Who can use it** (`aiStatus`), in this order: a provider is set; the plan includes the `ai` module (today only **premium**; trial, starter and growth don't — an owner decision, see Still open); the business hasn't switched AI off; it is under its monthly cap.
- **Cost and credits**: each call is written to `AiCostLog` (feature, provider, model, tokens, cost in paise, credits, who) and added to the month's `ai_credits` usage counter, even when the model refuses (the tokens were paid for). One credit per ₹0.50 of provider cost, at least one (`creditsFor`). Prices per million tokens in `PRICES` (Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50); an unknown model is priced like the default.
- Settings: `Tenant.settings.ai { on, monthlyCredits }` (on, no cap by default), saved through `PATCH /api/admin/settings { ai }`.

## A13 — catalogue assist (`src/lib/catalogue-assist.ts`, `src/lib/catalogue-rules.ts`)

- **Hindi names**: AI writes Devanagari names (generic words translated, brands spelt as said, sizes as digits with Hindi units). An answer with English letters is dropped. The rules (`hindiName`): a dictionary of about 120 grocery words, Hindi units (250 ग्राम, 1 किलो, 500 मिली), the rest spelt by sound (`latinToDevanagari`; silent final e, doubled last letter said once). Rules are "low" confidence: check the spelling.
- **HSN and GST**: AI gives the code (4 digits, or 6–8 if sure), the rate, its confidence and a reason. The rules: a built-in list of 36 product groups (tea 0902 5%, salt 2501 0%, detergent 3402 18%, cola 2202 40%…) with GST rates from 22 Sep 2025, else the code the business's own products in that category use most (none when two codes tie). **The business's HSN table, when it has the code, always sets the rate.** The built-in rates need an accountant's check before go-live.
- Runs on demand (Suggest), up to 100 products at a time in batches of 25. A batch the AI fails is done by the rules instead; products the AI skips get the rules too. Products with a suggestion waiting are skipped.
- Writes `catalogue` suggestions (expire after 30 days). These are **kept out of the main inbox** (`OWN_SCREEN_KINDS`) and decided on their own screen, in bulk, with edits. Applying checks the value again (Hindi name not empty; HSN 4–8 digits; rate one of the GST rates) and is audited as `product.update`.
- **Tidy a product sheet** (`tidyProductRows`, Import → Products → "Tidy the sheet first", on by default): extra spaces, ALL CAPS names, sizes ("250GM" → "250 g", "1 ltr" → "1 L"), "5 %" → 5, digits only in HSN, ₹ and commas out of prices, SKUs upper case without spaces, categories matched to existing ones by sound. Likely duplicates (same name within the sheet, or a product already in the catalogue with a different SKU; "250 g" = "250g") are flagged, not removed. The preview lists every change.

## API

- `GET /api/stock/load-sheet?date=YYYY-MM-DD&format=csv` and `GET /api/stock/forecast?format=csv` (`stock.view`).
- `GET /api/admin/catalogue-assist` → `{ items, missing, ai }`; `POST { field: "nameHi" | "hsn" }` runs it (audited `catalogue.assist`) (`catalogue.manage`).
- `POST /api/admin/catalogue-assist/decide { decisions: [{ id, accept, edit? }] }` (1–200, all in one transaction, only `catalogue` suggestions).
- `GET /api/admin/automation` now includes `ai { credits, costPaise, settings, available, message, model }`; `POST { feature: "reorder" }` runs the reorder review.
- `POST /api/admin/import` takes `tidy=1` for products and returns `tidy { changes, changeCount, duplicates }`.
- Suppliers take `leadDays`.

## Screens

- **Stock → Forecast** (`/admin/stock/forecast`, new StockNav item): tabs **Load sheet** (day picker, CSV, print; booked, usual, extra, load, in stock, short) and **Forecast** (a day ± spread, available and on order, days left and the day it runs out, supplier and lead time, order now; fewest days left first).
- **Products → Catalogue assist** (`/admin/products/assist`, link on the Products header): whether AI is on and why not; Suggest for Hindi names and for HSN codes with how many products lack each; suggestions grouped, each with a tick, an edit box (or HSN + GST select), source and confidence; Apply N ticked / Dismiss unticked. Rows not decided keep their tick and edits.
- **Suggestions**: the reorder card (lines table, value at last cost, "Draft the order"; decided cards link the purchase order).
- **Settings → Automation**: a **Demand forecast** card (on, top-up, cover days, service level) and an **AI** card (credits and cost this month, why AI is or isn't available, on/off, monthly cap).
- **Suppliers**: "Days to deliver". **Import**: "Tidy the sheet first" for products, with the changes and likely duplicates in the preview.

**Checked in a browser** (production build on port 3101, 20 Nov, seeded demo, local seed accounts, no AI key): the load sheet for tomorrow (94 orders, extras, one product short) and the forecast table (a product with 0 left but 96 on order: nothing to order); added two test products without Hindi names or HSN codes, Suggest for both (rules), unticked one, applied the other (HSN 0902 written), edited a Hindi name and applied both, dismissed the unticked one; settings cards; lowered a product's stock, Run now made one reorder suggestion, "Draft the order" made draft PO2627-00010 due in 3 days; supplier delivery time saved; import preview with tidy (5 changes, 2 duplicates of products already in the catalogue); 375 px with no sideways scroll on the two new pages. Found and fixed on the way: full-case top-ups for tiny usuals, the unticked row re-ticking after Apply, the "AI isn't set up" line shown twice, an HSN guess on a tie, "250 g" not matching "250g". The test products were deleted afterwards. Not checked: a real AI call (no key on this machine), the 06:00 job firing for real, Hindi on screen.

## Schema

Migration `20261120150000_forecast_ai` (applied locally): `Supplier.leadDays INTEGER NOT NULL DEFAULT 3`, checked 0–90. Nothing else: suggestions, runs and the AI cost log are Phase 11's tables.

## Tests

- `tests/forecast-math.test.ts` (11): flat demand, weekday pattern (shrunk and capped), recent weeks count more, no demand; z table; reorder at / above the reorder point, cases, on order, safety stock, a product nobody buys; load top-up (cases only for half a case or more).
- `tests/catalogue-rules.test.ts` (7): Hindi names and units, spelling by sound; HSN by keyword (whole words), by category (and none on a tie); tidying names; tidying a sheet with changes, category match and both kinds of duplicate; scrubbing personal data.
- `tests/forecast-ai.test.ts` (14), on a scratch business purged at the end: the load sheet (booked + usual, top-up off, a Thursday-only product); forecast and reorder (days left, 48 in cases, one suggestion per supplier, accept → draft PO with the lead time, then on order; off without the forecast or stock tracking); the AI gateway (why not, in order: no provider, plan, off, cap; prompt scrubbed; cost and credits logged; refusals logged; a wrong-shaped answer rejected); catalogue assist (missing counts, HSN by rules with the HSN table setting the rate, kept out of the inbox, edits checked, Hindi names by AI with rules for what it skips, falling back when the AI refuses).
- `tests/automation.test.ts`: admin now decides 8 kinds.
- Full suite: 326 tests in 21 files pass. `tests/analytics.test.ts` can fail now and then on a duplicate random shop phone in its own setup (Phase 10); it passes on a rerun.

## Still open

- **Which plans get AI** is the owner's call: today only premium has the `ai` module, so trial businesses (and the demo) always use the rules. A platform override (`Tenant.overrides.features.ai`) turns it on for one business.
- **Credits are counted, not billed yet**: the plan allowance and the price of extra credits belong with billing (Phase 9 usage counters already hold the numbers).
- The built-in **GST rates** and HSN codes need an accountant's check; the business's HSN table overrides them.
- The forecast ignores schemes, festivals and new shops; products with less than 8 weeks of history are forecast from what there is. No per-product service level.
- The load sheet doesn't plan by van or route (that's the trip's load plan from Phase 5).
- No real AI call has been made from this machine; the first one with a key should be watched in `AiCostLog`.
- Phases 13–14 (A1 WhatsApp / voice ordering, A3 payment screenshots, A8 photo proof checks, A10 shelf audit, A11 ask your business) will call `aiJson` and need images and audio added to it.

## Traps

- **`Product_case_valid`**: a product with `caseSize` needs `caseUnit` too (both or neither).
- **`Suggestion_decided_check`**: a suggestion that isn't open needs `decidedAt`, unless it's EXPIRED.
- **Available ≠ in stock**: stock levels take off what is booked; tests that set stock and also place orders must expect less available.
- **Entitlements are cached for 60 s**: after changing `Tenant.overrides`, call `invalidateEntitlements(tenantId)`.
- The trial plan has no `ai` module: set an override to test AI on a scratch business.
- **Don't pass the dev database as `--shadow-database-url`**; use `setu_shadow`. And don't let `tee` write CLI warnings into a migration file.
- The seed runs the daily automations, which now include the reorder review.
- Checking the screens adds rows to the demo (a stock count, a draft PO, decided suggestions): reseed before a demo. Products added to the demo break the fixed counts in `tests/tenant-isolation.test.ts`.
