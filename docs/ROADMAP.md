# Seller's Setu — Product & Platform Roadmap

> Status: draft v1, 19 Nov 2026. Owner sign-off needed on §12 (decisions) before Phase 0 starts.
> Scope: turn the current demo into a multi-tenant, white-label SaaS for FMCG / beverage / dairy
> distributors, with our own distribution business as tenant #1.

---

## 1. Where we are today

The app is a single Next.js 16 web app (installable PWA) with four roles — admin, retailer, sales
agent, delivery agent — sharing one database. Working today:

- Retailer OTP sign-up / login, catalogue, cart, order placement, order tracking.
- Sales agent: attendance check-in/out with GPS, today's beat, visits, ordering for a retailer.
- Delivery agent: assigned orders, proof-of-delivery photo/signature, cash-on-delivery amount.
- Admin: orders pipeline, products, regions/areas, team.
- GST-inclusive price breakup, EN/हिंदी toggle, branded landing page and inner pages.

### Foundation gaps that block real use (must fix before anything else)

| Gap | Why it matters at 1,000+ retailers |
|---|---|
| SQLite database | Single file, one writer at a time; no point-in-time backups. Not for production. |
| No tenant concept | Every table is global: `phone`, `sku`, `orderNumber`, `Region.name` are globally unique, so a second distributor cannot exist. |
| Money stored as `Float` | Rounding drift in totals, GST and balances. Accounting needs exact paise. |
| No ledger / balances | No outstanding, no credit, no part-payments — the core of a distributor's day. |
| No stock | Orders can be taken for goods that don't exist; no van load, no returns. |
| OTP not sent (demo code shown) | Retailers can't actually log in. |
| No offline support | Drivers and agents in low-signal areas lose work. |
| No background jobs, files store, audit log, monitoring, tests | Can't run reminders, can't trace who changed what, can't detect failures. |
| Fixed four roles | Real staff need warehouse, accountant, supervisor, area manager roles. |
| Much inner-page text hard-coded English | Hindi toggle only half works. |

**Our edge:** one codebase, one login, one live data set across all roles — a payment collected by a
driver is instantly on the retailer's balance and the owner's dashboard. The reference products
ship three separate apps; we keep one product and present it per role (and per tenant brand).

---

## 2. Vision and targets

**Vision:** the operating system for a distributor — order, deliver, collect, restock — that
automates the decisions, not just the paperwork, and that any distributor can launch under their own
brand in a day.

### Terms

| Term | Meaning |
|---|---|
| **Platform** | Us. Runs the SaaS, bills tenants, super-admin console. |
| **Tenant** | A distributor / seller company. Gets its own brand, domain, catalogue, staff, retailers, data. |
| **Retailer** | A shop that buys from a tenant. Gets prices, credit, schemes and preferences tailored to it. |
| **Staff** | Tenant users: owner, admin, accountant, warehouse, supervisor, sales agent, delivery agent… |

"Tailored for every retailer" is delivered at two levels: **per tenant** (brand, catalogue, rules,
features) and **per retailer** (price list, credit limit, payment mode, schemes, delivery slot and
preferences, visible products).

### Scale targets

| | Tenant #1 (go-live) | SaaS year 1 | Design headroom |
|---|---|---|---|
| Tenants | 1 | 50 | 500 |
| Retailers | 1,000+ | 50,000 | 500,000 |
| Staff (field + office) | ~30 (20 delivery) | 1,500 | 15,000 |
| Orders / day | ~300–600 | 25,000 | 250,000 |
| Peak window | 7–12 AM order rush before cut-off | same | same |

### Service targets

- Retailer catalogue loads in < 1.5 s on a mid-range Android over 4G; order placed in ≤ 3 taps from reorder.
- 99.9 % monthly uptime for the API; zero lost field actions (offline queue, §4.5).
- Every rupee traceable: each balance change is a ledger entry with actor, time, device and proof.
- New tenant from sign-up to first order in < 1 day, without our engineers.

---

## 3. Product principles

1. **One codebase, many faces.** Role-based and tenant-themed UI from the same app; no forks per customer.
2. **Configure, don't customise.** Every tenant difference is a setting, a feature flag or a template — never a code branch.
3. **Money is sacred.** Integer paise, double-entry ledger, append-only, reversals instead of edits.
4. **Field first.** Big touch targets, Hindi first-class, works offline, works on a ₹8,000 phone.
5. **Automate the decision.** Wherever staff decide something repetitive (route, reorder, reminder, reconcile), the system proposes and a human approves — then gradually auto-approves.
6. **AI behind a switch.** Every AI feature is per-tenant flagged, has a non-AI fallback, logs cost, and never moves money on its own.
7. **Facts, not names.** Reference products inform features; their names and branding never enter the app, docs, seeds or commits.

---

## 4. Target architecture

### 4.1 Shape

Stay a **modular monolith** (Next.js app + API routes + worker process) — the fastest path for a small
team and comfortably enough for the headroom targets. Split out services only when a module proves it
needs it.

```
            ┌──────────── Next.js app (web + PWA + Android wrapper) ────────────┐
 tenant  →  │  Retailer │ Sales │ Delivery │ Warehouse │ Admin │ Platform console │
 domain     └──────────────────────────────┬────────────────────────────────────┘
                                           │  API (route handlers, zod-validated)
            ┌──────────────────────────────┼───────────────────────────────────┐
            │ Domain modules: tenants · identity · catalogue · pricing · orders │
            │ ledger · payments · inventory · delivery · field · notify · ai    │
            └───────┬───────────────┬───────────────┬──────────────┬───────────┘
                Postgres         Job queue        Object store    Integrations
             (RLS per tenant)  (worker process)   (photos, PDFs)  (UPI, WhatsApp,
                                                                   SMS, GST, maps)
```

### 4.2 Stack decisions

| Area | Choice | Notes |
|---|---|---|
| Database | **Postgres 16** (managed, India region, PITR backups) | Prisma stays. Money as `BigInt` paise / `Decimal` for rates. |
| Tenant isolation | `tenantId` on every tenant-owned row + **Postgres Row-Level Security** | Prisma client extension sets `app.tenant_id` per request; RLS is the safety net if a query forgets the filter. |
| Jobs | **pg-boss** (queue inside Postgres) | No extra Redis to run; move to Redis/BullMQ only if throughput demands. |
| Files | S3-compatible bucket (e.g. Cloudflare R2 / MinIO on the VPS) | Photos compressed on device; signed URLs; per-tenant prefix. |
| Cache / rate limit | Postgres + in-memory first; Redis later | |
| Hosting | Docker on our VPS via Coolify (as for our other apps), India region | App + worker + Postgres; staging environment mandatory. |
| Mobile | PWA first; **Capacitor Android wrapper** for background GPS, reliable push, camera | Same code. White-label build per tenant later (§9). |
| Monitoring | Error tracking (GlitchTip/Sentry) → Telegram alerts, uptime checks, structured logs | |
| Tests | Vitest for domain logic (ledger, pricing, schemes), Playwright e2e for the four role journeys | Ledger and pricing need near-100 % unit coverage. |
| CI | GitHub Actions: lint, typecheck, tests, migration check, build on every PR | |

### 4.3 Multi-tenancy

- `Tenant` table: slug, legal name, GSTIN, state code, address, plan, status, settings JSON, brand JSON.
- Tenant resolved from the host: `<slug>.sellerssetu.in` or a verified custom domain (`order.agencyname.in`).
- Uniqueness becomes per tenant: `@@unique([tenantId, phone])`, `@@unique([tenantId, sku])`, order and invoice numbers per tenant **and per financial year series** (GST rule).
- One person may belong to several tenants (e.g. a retailer buying from two distributors): `User` is global identity, `Membership(tenantId, userId, role)` holds access.
- Platform super-admins act on a tenant only through an audited "support session".

### 4.4 Identity, roles, permissions

- Login: retailer by phone OTP (SMS + WhatsApp fallback); staff by phone OTP or ID+password; optional device binding for field staff.
- **Permission-based RBAC**: built-in roles (Owner, Admin, Accountant, Warehouse, Supervisor, Sales agent, Delivery agent, Retailer) map to permissions (`orders.approve`, `ledger.adjust`, `price.edit` …); tenants can clone and edit roles.
- Data scopes: a supervisor sees their team; an agent sees their beat; a retailer sees only their own data.
- Sessions: short-lived access token + refresh, revoke on device loss, force logout from admin.

### 4.5 Offline-first field apps

- Local store (IndexedDB) of today's work: route, orders, balances, catalogue, schemes.
- Every field action (deliver, modify line, collect payment, pickup crates, visit, check-in) is written
  locally as a command with a client-generated id, then synced; server applies idempotently.
- Conflicts: server is the source of truth for money and stock; UI shows "syncing / synced / needs attention".
- Photos queue separately, upload on Wi-Fi or good signal, compressed to ~150 KB.

### 4.6 Audit and events

- `AuditLog` for every create/update/delete on business records (who, when, before/after, device, IP).
- Internal domain events (`order.placed`, `payment.collected`, `delivery.completed` …) published to the
  job queue → feed notifications, webhooks, analytics and AI without coupling modules.

---

## 5. Domain model (target)

New or reshaped tables, grouped by module. All tenant-owned tables carry `tenantId`.

- **Tenancy:** Tenant, TenantDomain, TenantSettings, Plan, Subscription, UsageCounter, FeatureFlag.
- **Identity:** User (global), Membership, Role, Permission, Device, OtpChallenge, Session.
- **Geography & customers:** Region, Area, SubArea, Route (ordered stops), RetailerProfile (+ GSTIN, FSSAI, geo, photo, credit limit, payment mode prepaid/postpaid, price list, delivery slot, delivery preference, KYC status), RetailerContact.
- **Catalogue:** Brand, Category, Product, ProductVariant / PackUnit (piece ↔ box conversion), ProductImage, Banner.
- **Pricing:** PriceList, PriceListItem, RetailerPriceOverride, TaxRate (HSN), DeliveryChargeRule, MinOrderRule, CutoffRule.
- **Schemes:** Scheme (type: buy-X-get-Y, slab discount, % off with cap, flat off, free goods across SKUs), SchemeTarget (all / area / retailer group / retailer), Coupon, SchemeRedemption.
- **Orders:** Order, OrderLine (ordered / delivered / cancelled qty, reason), OrderStatusEvent, DeliverySlot, Cart (server-side, so the agent and retailer see the same cart).
- **Invoicing:** Invoice (series + FY number, e-invoice IRN, QR), InvoiceLine, CreditNote, DebitNote.
- **Ledger:** LedgerAccount (per retailer, per staff cash-in-hand, per wallet), LedgerEntry (double-entry, append-only, paise), Payment (cash / UPI / cheque / bank / wallet, proof, status), PaymentAllocation (which invoices a payment settles), CashHandover (driver → office), Cheque (status: received, deposited, cleared, bounced).
- **Wallet:** Wallet, WalletTransaction (recharge, hold for open order, release, debit).
- **Inventory:** Warehouse, Vehicle (van), StockLot (batch, expiry), StockMovement (purchase in, transfer to van, sale, return, damage, adjustment), LoadSheet, Returnable (crates/jars) + ReturnableBalance per retailer.
- **Delivery:** Trip (vehicle + driver + slot + date), TripStop (sequence, ETA), Delivery, ProofOfDelivery, PickupRecord, DeliveryException.
- **Field:** Beat, BeatPlan (dated), Visit (+ no-order reason), Attendance (all field roles, selfie + geo), LocationPing, StoreLead (new store from field), ShelfAudit, Target / Incentive.
- **Communication:** NotificationTemplate (per tenant, per channel, per language), Notification, Complaint / Ticket.
- **AI:** AiJob, AiCostLog, Suggestion (type, payload, status: proposed / accepted / rejected / auto-applied).

---

## 6. Phased roadmap

Estimates assume one full-time developer working with Claude; parallel work shortens them. Each phase
ends with a demo on staging, owner sign-off, then production.

### Phase 0 — Production foundation (≈ 3–4 weeks) · *blocks everything*

1. Postgres migration; money to paise; data migration script from the demo schema.
2. Tenant model, tenant resolution by host, `tenantId` everywhere, RLS policies, per-tenant uniqueness.
3. Global User + Membership; permission-based RBAC with the built-in roles; data scopes.
4. Real OTP via SMS provider (DLT-registered templates) + WhatsApp OTP fallback; rate limits; lockout.
5. Job queue worker, object storage for photos/PDFs, audit log, domain events.
6. Observability (errors → Telegram, uptime, slow-query log), daily backups + restore drill.
7. Staging environment, CI pipeline, seed data per tenant, Vitest + Playwright baseline.
8. Finish i18n: move every hard-coded string to the dictionary; Hindi complete.
9. **Bulk importers** (Excel/CSV with validation report): retailers, products, price lists, opening balances, staff. *Without this, onboarding 1,000 retailers is weeks of typing.*

**Exit:** two test tenants on staging fully isolated (verified by an RLS test suite); importing 1,000 retailers takes minutes.

### Phase 1 — Money: ledger, credit, payments (≈ 3 weeks)

1. Double-entry ledger; retailer running balance (khata) with ageing buckets (0–7, 8–15, 16–30, 30+ days).
2. Opening balances import; carry-forward shown everywhere (retailer, driver, agent, admin).
3. Payments: cash, UPI QR (static + dynamic), cheque, bank transfer, wallet; proof photo; note; part payments; allocation to oldest invoice first (editable).
4. Separate **today's COD** from **old dues collection**, as two lines on the driver's screen.
5. Credit control per retailer: postpaid limit, credit days, auto-hold of new orders beyond limit (override by permission).
6. Prepaid wallet: recharge, hold on order, release on cancel, debit on delivery.
7. Driver cash-in-hand ledger and **end-of-day cash handover** with variance.
8. Cheque lifecycle incl. bounce → automatic debit + penalty (configurable).
9. Retailer screens: balance, billing history, invoice history, statement PDF, pay-now.

**Exit:** every rupee in the pilot's day reconciles: deliveries − collections = change in outstanding.

### Phase 2 — Catalogue, pricing and schemes tailored per retailer (≈ 3 weeks)

1. Brands, categories, banners, pack units (box ↔ piece), HSN-based tax, product images.
2. Price lists (e.g. Wholesale, Retail, Key account) assigned per retailer; per-retailer overrides; margin % shown (`(MRP − rate) / MRP`).
3. Scheme engine: buy X get Y (same or cross-SKU), slab, % off with cap, flat off, coupons; targeting by area / group / retailer; date windows; stacking rules; budget caps.
4. Cart rules: minimum order value, delivery charge rules, order cut-off ("order before 12 PM for next-day morning"), delivery date choice, notes.
5. Retailer storefront: home with banners, brands, categories, "buy again", schemes for you, search with Hindi transliteration.
6. Per-retailer visibility (hide SKUs not sold in an area or to a group).

**Exit:** the same product shows different, correct prices and schemes to three test retailers.

### Phase 3 — Invoicing and GST compliance (≈ 2 weeks)

1. Invoice numbering per tenant per financial year series; tax invoice / bill of supply; CGST+SGST vs IGST by place of supply.
2. Invoice PDF (tenant-branded), shareable on WhatsApp; credit / debit notes for returns and modifications.
3. e-Invoice (IRN + QR) and e-Way bill through a GST provider API, when the tenant's turnover requires it.
4. Exports: Tally-compatible vouchers, GSTR-1 ready sales register, Excel reports.

### Phase 4 — Delivery operations (≈ 3–4 weeks)

1. Trips: vehicle + driver + slot (morning / evening) + date; dispatch board for the office.
2. **Line-level delivery**: deliver / modify qty / cancel each line with a reason list; deliver-all shortcut.
3. Returnables: crate/jar balances per retailer, pickup counts, photo proof, shortage charge rule.
4. Proof: photo + geo + time; optional signature / OTP-to-retailer for high-value drops.
5. Route sequencing (manual drag + automatic, §7), map view, call / directions, ETA SMS to the retailer.
6. Retailer delivery preferences (ring bell, at door, in hand, keep in bag) shown to the driver.
7. Driver: on/off duty, spot sales from extra van stock, add new customer, quick order / recharge.
8. Day close: load sheet vs delivered vs returned vs cash, per trip.

**Exit:** a full morning run (40+ drops) works offline end to end and reconciles at day close.

### Phase 5 — Inventory and warehouse (≈ 3 weeks)

1. Warehouse stock with batches and expiry (dairy/beverages need FEFO).
2. Stock movements: purchase in (from principal company), transfer to van, sale, return (good / damaged / expired), adjustment with reason.
3. Auto load sheet from confirmed orders + buffer; van stock = what the driver may spot-sell.
4. Reorder points, low-stock alerts, purchase order to principal.
5. Order-time stock check (soft warn or hard block per tenant).

### Phase 6 — Field sales force (≈ 3 weeks)

1. Attendance for all field roles: selfie + geo, calendar, hours, day summary; leave requests.
2. Dated beat plans; visit with order / no-order reason; ordering for any retailer (off-beat) by permission.
3. Add new store from the field (GSTIN, FSSAI, sub-area, photo, geo) → approval queue.
4. Distance travelled (background GPS in the Android wrapper), location pings during duty only.
5. Targets and incentives (value, volume, new outlets, collection), leaderboards.
6. Supervisor view: live team map, beat coverage, exceptions; date-wise downloadable reports.
7. Multi-distributor agents (an agent selling for several tenants via memberships).

### Phase 7 — Communication and engagement (≈ 2 weeks)

1. Notification centre with per-tenant templates in EN/HI (+ regional later) across push, SMS, WhatsApp, in-app.
2. WhatsApp Business API: order confirmations, invoice PDF, dispatch / ETA, payment receipts, statement, reminders.
3. Complaints / tickets with photo, SLA and status; retailer feedback after delivery.
4. Refer & earn for retailers; announcements and banners per area.

### Phase 8 — Payments and integrations (≈ 2 weeks)

1. Payment gateway with UPI collect / dynamic QR / payment links; webhook auto-posts to the ledger.
2. Bank statement import for NEFT/RTGS matching.
3. Outbound webhooks + public API keys per tenant (for their ERP).
4. Maps / geocoding provider for address → coordinates and route distances.

### Phase 9 — SaaS platform and white-label (≈ 3–4 weeks)

1. Self-serve tenant sign-up wizard: business details, GSTIN, brand (logo, colours, name), import data, invite staff.
2. White-label: per-tenant name, logo, colours (mapped onto our token system: primary/accent/surface), favicon, PWA manifest, login screen, invoice template, email/SMS sender, custom domain with automatic TLS.
3. Per-tenant Android builds from one codebase (app name, icon, package id, splash) for tenants on the premium plan.
4. Plans and billing: per-seat staff + per-active-retailer pricing, AI credits; trial; GST invoices for our own subscriptions; dunning.
5. Feature flags per plan and per tenant; usage limits.
6. Platform console: tenants, health, usage, AI cost, support sessions (audited), announcements.
7. Tenant data export and deletion (DPDP Act), tenant suspension.

### Phase 10 — Analytics and reporting (continuous, ≈ 2 weeks base)

- Owner dashboard: sales, collections, outstanding, ageing, stock value, delivery performance, agent performance.
- Retailer analytics: frequency, average order, churn risk, SKU mix.
- Scheme ROI, route profitability, returns/damage rate.
- Scheduled reports (daily WhatsApp summary to the owner at 9 PM).

---

## 7. AI and automation layer

Built on top of Phases 1–6 data. Each item: per-tenant flag, human-approval mode first, cost logged in
`AiCostLog`, plain non-AI fallback. Text tasks use low-cost models via a single provider-agnostic
gateway (so models can be swapped); route and forecast work is classic maths, not LLMs.

| # | Automation | What it does | Manual work saved | Needs |
|---|---|---|---|---|
| A1 | **WhatsApp / voice ordering** | Retailer sends "5 peti nimbu, 2 jeera" (text or Hindi voice note); AI maps to SKUs and pack units, builds the cart, retailer taps to confirm | Order-taking calls, many beat visits | Ph 2, 7 |
| A2 | **Smart reorder** | Predicts each shop's next order from history and day-of-week; one-tap "usual order" | Agent time per visit | Ph 2 |
| A3 | **Auto payment matching** | Gateway webhooks auto-settle; AI reads UPI screenshots, cheque photos and bank lines, proposes allocation | Accountant's daily reconciliation | Ph 1, 8 |
| A4 | **Collections autopilot** | Ageing-based WhatsApp reminders, payment links, escalation to agent's visit list, credit hold | Reminder calls | Ph 1, 7 |
| A5 | **Route optimisation** | Sequences drops by distance, slot and time windows; balances load across vans | Dispatcher's morning planning | Ph 4 |
| A6 | **Auto load sheet & demand forecast** | Next-day load from orders + forecast buffer; reorder suggestions to principal | Warehouse planning, stock-outs | Ph 5 |
| A7 | **Daily visit plan** | Picks shops to visit by days-since-order, dues, scheme expiry, churn risk | Supervisor planning | Ph 6 |
| A8 | **Proof checks** | Flags delivery photos that don't show a shop/goods, counts crates in pickup photos | Disputes, manual audit | Ph 4 |
| A9 | **Cash & fraud anomalies** | Flags cash variance, off-route deliveries, repeated "shop closed", unusual discounts | Leakage | Ph 1, 4 |
| A10 | **Shelf photo audit** | Counts our facings vs others on a shelf photo, spots empty slots | Merchandiser audits | Ph 6 |
| A11 | **Ask your business** | Owner asks in Hindi/English ("which shops owe > ₹20,000 for 30+ days?"); answers from read-only, tenant-scoped queries | Report building | Ph 10 |
| A12 | **Churn & credit risk score** | Scores each retailer weekly; suggests credit limit changes | Credit decisions | Ph 1, 10 |
| A13 | **Catalogue assist** | Writes product names in Hindi, suggests HSN/GST from description, cleans imported sheets | Data entry | Ph 0, 2 |

Guardrails: AI never posts a ledger entry, changes a price or sends money by itself; it creates a
`Suggestion` that a permitted user accepts (later: auto-accept rules per tenant, e.g. exact-amount UPI
matches). Retailer data never leaves the tenant scope; prompts exclude personal data where possible.

---

## 8. Security and compliance

- RLS-enforced tenant isolation + automated cross-tenant leak tests in CI.
- DPDP Act 2023: consent at sign-up, purpose notes for location/selfie, data export/deletion, breach process; location tracked only on duty.
- SMS DLT registration for OTP and transactional templates; WhatsApp template approval per tenant.
- GST: invoice series rules, e-invoice/e-way thresholds, record retention (8 years).
- Secrets in the deployment platform, never in the repo; encrypted backups; least-privilege DB users.
- OWASP basics: rate limits, CSRF on cookies, file-type checks on uploads, signed URLs, dependency audit.
- Pen-test before the first paying external tenant.

---

## 9. White-label and per-tenant tailoring — what is configurable

| Layer | Configurable per tenant | Configurable per retailer |
|---|---|---|
| Brand | Name, logo, colours, fonts (from a safe set), domain, app icon, invoice look, sender IDs | — |
| Language | Default language, enabled languages | Preferred language |
| Catalogue | Brands, categories, products, pack units, images | Visible products |
| Price | Price lists, tax, delivery charges | Assigned price list, overrides |
| Schemes | Scheme types enabled, budgets | Targeted schemes, coupons |
| Ordering | Cut-off time, slots, min order, who can order (retailer/agent/driver) | Slot, min order exception |
| Money | Prepaid/postpaid allowed, credit days, cheque rules, bounce penalty | Mode, credit limit, credit days |
| Delivery | Proof requirements, returnables, OTP-on-delivery threshold | Preference, time window, geo pin |
| Field | Attendance rules (selfie/geo), beat frequency, targets | Beat, assigned agent |
| Features | Modules on/off by plan (inventory, field, AI, WhatsApp) | — |
| Notifications | Templates, channels, timings | Opt-outs |

---

## 10. Go-live plan for tenant #1 (our own business)

Milestone **M1 — "Our business runs on Setu"** = Phase 0 + 1 + 2 + 3 (core) + 4.

1. **Week −2:** import 1,000+ retailers, products, price lists and opening balances; staff accounts; verify balances with the accountant line by line.
2. **Week −1:** train 20 delivery agents and sales staff (Hindi video + one-page guide), install the Android wrapper, dry-run on staging with real routes.
3. **Pilot (2 weeks):** one route / 100 retailers live, old process in parallel; daily reconciliation review.
4. **Rollout (2 weeks):** add routes in batches of ~200 retailers; retailer self-ordering enabled with WhatsApp onboarding message.
5. **Cut-over:** old process retired once 5 consecutive days reconcile to the rupee.

Success measures after 60 days: ≥ 60 % of orders self-placed by retailers, outstanding ageing 30+ days
down 25 %, day-close reconciliation < 30 minutes, zero lost deliveries/payments.

Milestone **M2 — First external tenant** = Phase 5–9 core. **M3 — AI autopilot** = A1–A7 on by default for new tenants.

---

## 11. Timeline (indicative)

| Months | Work | Milestone |
|---|---|---|
| 1 | Phase 0 | Production-ready core |
| 2 | Phases 1–2 | Money + tailored pricing |
| 3 | Phases 3–4 | **M1 pilot live** |
| 4 | Phases 5–6, A3–A5 | Full operations, first automations |
| 5 | Phases 7–8, A1–A2, A4 | WhatsApp ordering, collections autopilot |
| 6 | Phase 9–10 | **M2 first external tenant** |
| 7+ | A6–A13, regional languages, iOS wrapper, marketplace of integrations | **M3** |

---

## 12. Decisions needed from the owner

1. **Hosting:** our Coolify VPS (cheaper, we manage) vs managed cloud Postgres (safer backups) — recommendation: app on VPS, managed Postgres in India.
2. **SMS provider** (DLT) and **WhatsApp Business provider**.
3. **Payment gateway** for UPI / payment links.
4. **GST provider** for e-invoice / e-way bill (only if tenant turnover needs it now).
5. **Platform domain** for tenant subdomains.
6. **Pricing model** for SaaS tenants (per active retailer, per staff seat, AI credits).
7. **Android:** one shared app with tenant picker vs per-tenant branded builds (recommendation: shared app first, branded builds as premium).
8. **Tenant #1 process rules:** cut-off time, slots, credit days, cheque policy, returnable charges, approval of new stores.

---

### Owner decisions (19 Nov 2026)

| # | Decision |
|---|---|
| 1 | Hosting on the same Coolify server as our other apps (app + worker + Postgres). |
| 2 | SMS provider: owner adds later. OTP stays behind a provider interface; dev mode shows the code. |
| 3 | Payment gateway: **Razorpay**. |
| 4 | GST: **e-invoice** in scope (Phase 3). |
| 5 | Platform domain with tenant subdomains: yes (domain name to be set via `PLATFORM_DOMAIN`). |
| 6 | SaaS pricing on all three: per active retailer, per staff seat, AI credits. |
| 7 | Web app first, Android wrapper after. |
| 8 | Tenant #1 process rules: owner adds later; built as per-tenant settings with sensible defaults. |

## 13. Immediate next steps

1. Owner reviews this roadmap and answers §12 items 1, 2 and 8 (needed for Phase 0/1).
2. Collect tenant #1 data in Excel: retailer list (name, phone, address, area, GSTIN, current balance), product list with prices, staff list, routes.
3. Start Phase 0 on a new branch from `master` after the landing branch is merged.
