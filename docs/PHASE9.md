# Phase 9 — SaaS platform and white-label

Branch: `feat/phase9-saas` (cut from `feat/phase8-payments`).
Plan: `docs/ROADMAP.md` §6 Phase 9. Exit check: **a business can sign up on its own, try the app, pick a plan and be billed by us with a correct GST invoice; it can wear its own name, logo, colours and web address; modules and limits follow its plan; we can run every business from one console (support sessions audited, announcements, health, usage); a business can take its data away or be deleted completely; and the Phase 1–8 rules still hold**. This is covered by `tests/saas.test.ts` and by the seeded demo.

## How it works

### Two kinds of address

- **Tenant address**: `<slug>.<PLATFORM_DOMAIN>` or a verified custom domain. Everything a business uses.
- **Platform address**: the bare domain, `www.` or `platform.` (no tenant). Here: the landing page, the sign-up wizard `/start`, the console `/platform`, our Razorpay webhook and the TLS "ask" endpoint. In dev `DEFAULT_TENANT_SLUG=demo` makes the bare `localhost` act as the demo business, so use **http://platform.localhost:3100** for the platform address.

### Plans, modules and limits (`src/lib/plans.ts`)

- A **plan** (`Plan`, edited in the console) has prices (base fee, per staff login, per active shop, AI credits included and the price of extra ones), modules, limits (staff, retailers) and trial days. The seed makes `trial`, `starter`, `growth` and `premium` with **placeholder prices**: set the real ones in the console before the first paying business.
- **Modules**: `inventory`, `field`, `engage`, `gateway`, `bank`, `integrations`, `whiteLabel`, `customDomain`, `android`, `ai`. Everything else (orders, delivery, khata, invoices, payments, schemes) is core and always on.
- **Entitlements** = plan modules and limits + the business's **overrides** (`Tenant.overrides`, set in the console: a module on or off, a limit raised). During the trial the business tries the plan it picked. Cached for 60 s per web process (`invalidateEntitlements` on change).
- **One gate** (`src/lib/guard.ts` `gate()`): the proxy passes the request path and method (`x-setu-path`, `x-setu-method`, overwritten if a client sends them); `guard()` maps the path to a module (`featureForPath`) and answers **402 `upgrade`** when it is not in the plan. A route can't forget the check. Gateway webhooks are never gated: a payment made before a downgrade is still booked.
- Screens: the nav shows a lock on items not in the plan; opening one shows an upgrade card instead of the page (office: "See plans"; staff: "Ask the owner").
- **Limits** (`checkLimit`) are checked where logins are made: staff (Team, reactivating someone), shops (shop self-sign-up, import, a lead turned into a shop). Seats = active logins that are not shops and not the support login.

### Sign-up (`src/lib/signup.ts`, `/start`)

1. The phone gets a 6-digit code (`SignupChallenge`, HMAC-hashed; 3 per phone per 15 min, 10 per IP per hour, 5 wrong tries). In dev the code comes back as `devCode`.
2. `POST /api/signup` checks everything again (GSTIN check digit; the state comes from the GSTIN; the address is free and not reserved; password ≥ 10 characters and not containing the login id; terms accepted), uses the verified code once, and in one platform transaction makes the business (`TRIAL`), its subscription (trial, the picked plan as `nextPlanCode`) and the owner.
3. It answers with a **welcome link** on the new address (`/api/auth/welcome?token=…`: JWT, 10 minutes, single use through `HandoffUse`), which signs the owner in and opens **Set up** (`/admin/setup`).
- **Set up checklist** (`src/lib/onboarding.ts`): business details, brand, areas, products, shops (import), staff (invite), online payments, web address. A step is done when the data exists, or when the owner marks it done / skips it (`Tenant.onboarding`).
- The CLI (`npm run tenant:create`) uses the same `createTenantRecord` and also starts a trial.

### White-label (`src/lib/branding.ts`, `branding-server.ts`)

- `Tenant.brand`: app name, short name (launcher), tagline, logo, icon, colours (primary, accent, surface), invoice footer / terms, SMS and email sender name.
- **Name fields** are for every plan; **logo, icon and colours** need `whiteLabel` (without it they are kept but not shown).
- Colours map onto our tokens: primary → `--mor`, `--mor-mid`, `--mor-dark`; accent → `--kesar*`; surface → `--background`. **Contrast rules**: white text on the primary ≥ 4.5:1, accent ≥ 3:1 on white, the surface light (luminance ≥ 0.7) with body text ≥ 7:1 on it. Only `#rrggbb` reaches the CSS (`<style id="tenant-theme">` in the root layout).
- Per business, from the same code: page title and description, theme colour, favicon and app icons (`/brand/icon/{32,180,192,512}`, resized with sharp, ours when none), logo (`/brand/logo`), **PWA manifest** (`/manifest.webmanifest`), the login screen (`/api/brand`), the app header lockup, invoices (legal name, logo, footer) and the sender name on messages.

### Custom domains (`src/lib/domains.ts`)

- Up to 3 per business (`customDomain` module). The owner adds `order.theirbusiness.in`, creates **TXT `_setu-verify.<host>` = the code** and **CNAME `<host>` → `<slug>.<PLATFORM_DOMAIN>`**, then presses Check. On a match the domain is verified and the tenant cache cleared, so the host resolves at once.
- **TLS** (`TLS_PROVIDER`): `caddy` — on-demand TLS asks `GET /api/platform/tls/ask?domain=` (yes only for our own addresses and verified domains); `coolify` — the domain is added to the Coolify app through its API, which gets the certificate; empty — verified only, add it to the proxy by hand. The result is kept on the domain (`tlsStatus`).

### Android builds (`src/lib/android-kit.ts`)

- For `android` (premium). One codebase: a Capacitor wrapper loading the business's own address. Per business only the package id (`<ANDROID_APP_ID_PREFIX>.<slug>`), app name, server URL, theme and splash colours and the 512 px icon differ.
- The console shows the kit; `npm run android:config -- --slug <slug>` writes `android-builds/<slug>/capacitor.config.json` and `BUILD.md` (git-ignored). The wrapper project and the Play Store pipeline are not built yet (see Still open).

### Billing (`src/lib/billing.ts`)

- **Arrears, monthly, IST.** A subscription has a period `[periodStart, periodEnd)`; at its end we bill: the plan's base fee, **staff logins** (active, not shops, not support) × seat price, **active shops** (distinct shops with a non-cancelled order in the period) × shop price, and **AI credits** over the allowance. Usage counters (`UsageCounter`: `messages`, `api_calls`, `ai_credits`) are kept per month for the console.
- **Our GST invoice** (`PlatformInvoice`, number `SS/<fy>-00001` from `PlatformCounter`): SAC `PLATFORM_SAC` (default 997331), 18% — CGST + SGST when the business is in our state (`PLATFORM_STATE_CODE`), else IGST — **only when `PLATFORM_GSTIN` is set** (until we are registered the invoice carries no GST). Amounts never change once issued (trigger + checks); only payment and void fields do. One invoice per business per period. PDF from `/api/admin/billing/invoices/<id>/pdf` and the console.
- **Paying**: a Razorpay payment link on **our own account** (`PLATFORM_RAZORPAY_*`; none = pay by bank transfer and we mark it paid in the console). Our webhook `POST /api/platform/webhooks/razorpay` (`payment_link.paid`, short payments ignored) marks it paid.
- **Daily run** (worker job `billing.daily`, 06:00 IST; also "Run now" in the console):
  1. trials: ended with a plan picked → that plan starts from the trial's end; ended without → `PAST_DUE`, and **paused** 7 days later (`billing:trial-ended`) until a plan is picked;
  2. periods that ended → invoice (catches up if the job was down);
  3. **dunning** on unpaid invoices: reminders 7 days before the due date (due 7 days after issue), on it, 3 and 7 days after (office notification `staff.billing`, with WhatsApp / SMS per the business's message settings); overdue → `PAST_DUE`; **paused 14 days after the due date** (`billing:unpaid <number>`).
  4. Paying (or voiding) the last overdue invoice puts the business back to `ACTIVE` and lifts a billing pause by itself. A pause set by hand in the console is not lifted by a payment.
- **Changing plan**: in the trial, the picked plan starts when the trial ends; after it, at once (the whole month is billed on the new plan). A plan whose limits are below what is in use is refused.

### A paused business

- `SUSPENDED` still resolves (unlike `CLOSED`), so the owner can sign in to pay or take the data. Staff, shops and the API get **423**; the owner can open only Billing and Your data (every other page shows the paused card).

### Platform console (`/platform`, `src/lib/platform-auth.ts`)

- Our own logins (`PlatformUser`, roles **OWNER** and **SUPPORT**), separate cookie (`setu_platform`, 12 h), only on the platform address. Made with `npm run platform:user`. Every action goes to `PlatformAudit`.
- Tenants (list, detail, plan, trial extension, overrides, pause / un-pause, support session, Android kit, export, deletion), invoices (mark paid, void, pay link, PDF), plans (OWNER), announcements, usage and AI cost, health (job queue, failed messages and webhooks, overdue invoices, unverified domains), audit.
- **Support sessions** (`src/lib/support.ts`): a reason (≥ 5 characters), read-only or can change things, 5–120 minutes. The console gets a **single-use sign-in link** (5 minutes) on the business's own address; it signs in as a hidden support login (`User.isSupport`, not a seat, not listed). The business sees a banner while it lasts and every session under **Your data → Support access**, and can end it. Read-only sessions are refused any write (403) in `gate()`. Start and end go to the business's own audit log.
- **Announcements**: title, text, info / warning, to office logins or all staff, to every business or a list, from / until. Shown above every page; hideable for the visit.

### Data export and deletion (DPDP Act) (`src/lib/tenant-data.ts`)

- **Export**: every table with a `tenantId` column, found from the database catalogue (a table added later is included without code changes), read in one repeatable-read snapshot into a gzipped JSON file (`setu-export/1`). Left out: password hashes, API key hashes, webhook and gateway secrets, push keys, OTP codes and caches. Kept for 7 days. One per hour per business. Runs in the worker (`tenant.export`), or at once when there is no queue.
- **Deletion**: the owner types the business's address to confirm; a final export is made at once and everything is **deleted after 7 days** unless cancelled (banner with "Keep it"). The daily run purges: children first in an order worked out from the foreign keys (cycles broken by clearing nullable columns), with the append-only tables (audit log, journal, ledger) and the immutable invoice tables opened only for this business through `app.purge_tenant`. Files in storage are removed. Left: a `CLOSED` tombstone (address freed as `closed-<id>`), and our own records (`PlatformInvoice`, `Subscription` (cancelled), `UsageCounter`) for our accounts.
- **Pause / un-pause by hand** from the console, with a reason the owner sees.

## Environment

`PLATFORM_LEGAL_NAME`, `PLATFORM_GSTIN`, `PLATFORM_ADDRESS`, `PLATFORM_STATE_CODE`, `PLATFORM_SAC`, `PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_KEY_SECRET`, `PLATFORM_RAZORPAY_WEBHOOK_SECRET`, `TLS_PROVIDER` (`caddy` | `coolify` | empty), `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID`, `ANDROID_APP_ID_PREFIX`. See `.env.example`.

## Done

- Schema and migrations `20261119140000_saas_platform`, `20261119160000_platform_invoice_tax_check` (an invoice without GST was refused) and `20261119170000_platform_audit_target` (`PlatformAudit.tenantId` → `targetTenantId`, so our audit isn't treated as the business's data: not exported, not purged): 11 new tables (plans, subscriptions, usage, our invoices and counter, console users, support sessions, console audit, announcements, exports, sign-up codes); row-level security on the per-business ones; checks on invoice amounts, payment state and support windows; the invoice guard trigger; purge policies and the rewritten guards on the append-only tables.
- Plans, modules and limits with one gate; sign-up with the welcome link; white-label (theme, icons, manifest, login, invoices, sender); custom domains with TLS hooks; Android kit; billing, our GST invoices, pay links, dunning, pauses; console with support sessions and announcements; export and deletion; pause by hand.
- New worker jobs: `billing.daily` (06:00 IST, also runs the deletion purge and export expiry), `tenant.export`.
- New scripts: `npm run platform:user`, `npm run android:config`; `tenant:create` now starts a trial.

## Screens

- **Sign-up** (`/start`, platform address): 5 steps — business (GSTIN checked as you type; it sets the state), web address (suggested from the name, checked live), plan (₹ per month, per login, per shop, limits, modules; or "not sure yet"), mobile code, create (summary, login id and password, terms). Errors jump to their step and field. The welcome link signs the owner in and opens Set up. The landing page's main button is now **Start free trial**.
- **Login**: the business's name and logo, `?notice=` messages (support ended, welcome link used), a paused-business box on 423; on the platform address it points to the business's own address and the trial.
- **Office**:
  - every page: support banner (read only / can change, until when, End session), announcements, trial days left / bill overdue / deletion date with Keep it; locked nav items; an upgrade card on a page whose module is off; a paused card everywhere but Billing and Your data;
  - **Set up** (`/admin/setup`): progress, next step, each step with Open / Mark done / Skip / Undo, hide reminders;
  - **Plan & billing** (`/admin/billing`): current plan, period, logins and shops used against limits, this month's estimate, plan cards (confirm before changing), our invoices with Pay and PDF; when paused, why and what to pay;
  - Settings → **Brand** (`/admin/settings/brand`): names, logo, phone icon, colours (picker + hex, contrast errors from the server as you type, reset), invoice look, sender names, live preview (header, buttons, card, home-screen icon); locked parts without white-label;
  - Settings → **Web address** (`/admin/settings/domains`): add, the TXT and CNAME records to copy, Check now, status, certificate, remove; upgrade note without the module;
  - Settings → **Your data** (`/admin/account`): make a copy (list, size, download until), support access list with End now, close and delete (type the address; pending date and Cancel).
- **Console** (`/platform`, platform address): sign-in; Tenants (search, status filter, plan, trial end, logins / shops, orders, last order, overdue); a tenant (details, plan change, trial extension, module and limit overrides, pause / un-pause, support session with the single-use link to copy, past sessions, Android kit to copy or download, data copies, deletion, its invoices, a red banner when messages / webhooks / e-invoices fail); Invoices (filter, mark paid, void, pay link, PDF); Plans (₹ in, paise stored); Announcements (India time); Usage and AI cost; Health (database, jobs, problem businesses, paused, deletions due) with **Run daily billing now** (OWNER); Audit (filters, older entries). OWNER-only actions are hidden for SUPPORT.

**Checked in a browser** (production build on port 3101, 19 Nov): demo office dashboard with the announcement; Plan & billing (estimate ₹3,412, plan cards with struck-out modules); Set up (6/8); Web address (upgrade note on Growth); Your data; Brand (a too-light colour refused with its contrast; a saved colour and name change `--mor`, the page title and the manifest); console sign-in and Tenants; a read-only support session from the console — lands on the business's address with the banner, reads allowed, a write refused 403, End session signs out; sign-up through the APIs → welcome link → Set up with the trial banner, and `/start` at 375 px. Not clicked through: every console action, plan change, export download, deletion, custom domain with real DNS, the wizard's own buttons (its APIs were exercised).

## Demo data (`npm run db:seed`)

- Plans `trial`, `starter`, `growth`, `premium` (placeholder prices).
- **demo**: Growth, active; last month's invoice issued and paid (no GST: `PLATFORM_GSTIN` unset); some API and AI usage this month.
- **second**: in its free trial (9 days left), Starter picked.
- Console logins (local test only): `owner@setu.local` (OWNER) and `support@setu.local` (SUPPORT), password `platform123` — at http://platform.localhost:3100/platform.
- One announcement to office logins for the next two weeks.

## Tests

`tests/saas.test.ts` (22 tests; full suite 229 tests in 15 files pass on a freshly seeded database; billing and deletion run on scratch businesses made by the test, `runBilling(now, [ids])` leaves the demo data alone; the scratch businesses are purged at the end):

- the gate: pause (owner only, billing / export / account only, segment boundaries), read-only support, module 402; path → module mapping;
- entitlement overrides; brand contrast rules and hex-only CSS; invoice lines, GST split (none without GSTIN, CGST + SGST in state, IGST outside), IST month arithmetic; custom domain rules; purge order with cycles and self references;
- sign-up: code, wrong code, a verified code used once, address taken, trial with the picked plan, welcome link single use and bound to its business;
- staff limit; support sessions (reason, single-use link, other business, not a seat, audited, end, expiry);
- billing: trial → picked plan → invoice (idempotent, amounts fixed) → overdue pause → paid un-pauses; trial without a plan → past due → pause → picking a plan lifts it;
- custom domain verify through a stubbed DNS resolver, host owned by another business, removal;
- isolation of the new tables; export without secrets; purge leaves no row of the business but our own records.

## Still open

- **Prices**: the plan prices are placeholders; set them in the console (Plans) before charging anyone.
- **Our GSTIN and Razorpay account**: until `PLATFORM_GSTIN` is set our invoices carry no GST; until `PLATFORM_RAZORPAY_*` is set invoices are paid by bank transfer and marked paid by hand. Nothing was tried against a live Razorpay account (the webhook is checked by signature and amount).
- **SMS provider**: sign-up codes need one in production (`SMS_PROVIDER`); in dev the code is shown on screen.
- **TLS**: the Caddy / Coolify hooks are written but not tried against a real proxy; until then verify the domain here and add it to the proxy by hand.
- **Android**: the Capacitor wrapper project, signing keys and the Play Store pipeline are not built (only the per-business settings).
- **AI**: the `ai` module, credits and the AI cost view are ready, but no AI feature meters credits yet (Phase 10 / §7).
- Email sending (receipts of our invoices by email) is not wired; owners get in-app notifications and WhatsApp / SMS per their message settings.
- Entitlements are cached per web process for 60 s: a change from the console can take up to a minute on other containers.
- **Terms and privacy pages** don't exist yet, though sign-up requires accepting them (the box has no links). They need the owner's own text.
- Console gaps: announcements can't be edited (Edit publishes a new one and ends the old), no way to end a running support session from the console (the business can), the tenants list pages by raising `take` (max 500).
- A bare (apex) custom domain needs an A record; only the CNAME target is shown.
- Billing screen: no message / API-call counts, and no usage estimate during the trial. The checklist doesn't say whether a step is done from the data or ticked by hand; nothing shows a set-up card on the dashboard yet.
- The certificate status is a free-text line; the screen maps it to plain words.
- 23 lint warnings (0 errors), mostly `set-state-in-effect` on load-on-mount screens.

## Traps

- In dev the bare `localhost` is the demo business; the platform address is `platform.localhost:3100`.
- `SUSPENDED` resolves, `CLOSED` does not: never "close" a business to pause it.
- Our invoice amounts can't be updated (trigger); fix a wrong invoice by voiding it and issuing again.
- The purge needs `app.purge_tenant` set in the same transaction; don't delete a business's rows any other way (the audit log and the books refuse).
- The support login (`isSupport`) must stay out of seat counts, team lists and logins; `api/auth/login` and OTP verify exclude it.
- Tests leave purged `closed-…` tombstones: reseed (`npm run db:seed`) before a demo.
- **Never build a redirect or a link from `req.url`**: in `next start` and behind the proxy it carries the server's own host and port. Redirects use `localRedirect(path)` (relative `Location`), links use `publicTenantUrl` / `PUBLIC_SCHEME` / `PUBLIC_PORT` (`src/lib/redirect.ts`). Fixed here for support, welcome, handoff, the brand icon and the proxy's sign-in redirects.
- Reading per-business rows from the console (a tenant's `subscription`, a plan's subscription count) needs `asPlatform`; the plain client returns nothing because of row-level security, without an error.
- **Never pass the dev database as `--shadow-database-url`** to `prisma migrate diff`: Prisma wipes the shadow database. Use the `setu_shadow` database.
