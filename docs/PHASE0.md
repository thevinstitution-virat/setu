# Phase 0 — Production foundation: progress

Branch: `feat/phase0-foundation` (cut from `feat/sellers-setu-landing`, which is not merged yet).
Plan: `docs/ROADMAP.md` §6 Phase 0.

## Done (0a — tenancy core)

| Roadmap item | What shipped |
|---|---|
| 1. Postgres, money in paise | SQLite replaced by Postgres 16. Fresh migration `init_postgres_tenancy` (old SQLite migrations deleted; demo data only). All money columns are integer paise: `Product.price/mrp`, `Order.subtotal/gstAmount/totalAmount`, `OrderItem.price`, `Delivery.codAmount`. `src/lib/money.ts` (`toPaise`, `formatINR`, `gstOn`); GST rounded per line. |
| 2. Tenant model + RLS | `Tenant`, `TenantDomain`. Every other table has `tenantId`, defaulting to `current_setting('app.tenant_id')`, with `ENABLE` + `FORCE ROW LEVEL SECURITY` and a `tenant_isolation` policy. Without a tenant setting, queries return nothing (fails closed). `AuditLog` is append-only by policy. |
| | `src/lib/db.ts`: `tenantDb(id)` (each query runs in a tiny transaction that sets the tenant), `withTenantTx(id, fn)` for atomic multi-step work, `asPlatform(fn)` for cross-tenant platform jobs only. |
| | Per-tenant uniqueness: phone, email, loginId, sku, region name, order number. |
| Tenant from host | `src/lib/tenant.ts`: `<slug>.<PLATFORM_DOMAIN>` → tenant; verified `TenantDomain` → tenant; bare domain → platform site (or `DEFAULT_TENANT_SLUG` in dev). Reserved subdomains refused; suspended tenants refused. 60 s cache. |
| Sessions per tenant | Session JWT carries `tenantId`; `getSession()` rejects a session whose tenant ≠ the host's tenant. Cookie is host-only. `SESSION_SECRET` required in production. |
| 4. OTP (provider later) | `OtpChallenge` table: HMAC-hashed codes, 5-minute expiry, 5 wrong attempts max, 3 sends per 10 minutes, one-time "verified" proof for sign-up. `sendOtpSms()` is the provider hook; dev / `OTP_DEV_MODE=1` returns the code on screen; production without a provider refuses to send. |
| Order numbers | `Counter` table: gap-free `SO-<FY>-000001` per tenant per Indian financial year. Order + number + visit link are created in one transaction; unknown/inactive products and bad quantities are rejected; cash-on-delivery amount is now set by the server, not the phone. |
| 5. Audit log (part) | `src/lib/audit.ts`; written for retailer sign-up, staff create/(de)activate, product create/update (before/after), order status changes. |
| 7. Tests + seed | Vitest (`npm test`): 9 unit tests (host parsing, money, FY numbering) + 10 isolation tests against the real database (cross-tenant read/update/delete/insert blocked, fails closed, auto-stamping, append-only audit, gap-free numbers, platform bypass). Seed creates two tenants, `demo` and `second`, deliberately sharing an admin login id and a retailer phone. |

Checked in the browser: `demo.localhost:3100` admin dashboard shows demo data with correct ₹ totals; the same phone signs in as a different retailer on `second.localhost:3100`, which sees only its 2 products and 0 orders; the demo admin password is refused on `second`.

## Done (0b — platform services)

| Roadmap item | What shipped |
|---|---|
| 3. Permissions | `src/lib/permissions.ts` (13 permissions, role → permission map) and `src/lib/guard.ts`. Every API route calls `guard("<permission>")`, which checks tenant, session, that the user **still exists and is active** (deactivated staff are locked out immediately, not after the 30-day cookie) and the permission using the role stored now. Role layouts use `pageSession()` with the same checks. Data scopes (own orders, own beat) stay inside the routes. |
| 5. Jobs + events | pg-boss queue in Postgres (schema `pgboss`), `emit()` in `src/lib/jobs.ts` never fails the request. Events: `order.placed`, `order.status`, `order.delivered`, `retailer.registered`, `import.completed`; daily `otp.cleanup` (03:30 IST). Worker: `npm run worker` (`scripts/worker.ts`, handlers in `src/jobs/handlers.ts`), retries with backoff, alerts on failure. |
| Files | `src/lib/storage.ts`: local disk (dev) or any S3-compatible bucket. `POST /api/uploads` (3 MB, type detected from bytes: JPEG/PNG/WebP/PDF only), `GET /api/files/<key>` serves only the caller's tenant keys (`t/<tenantId>/…`). Delivery photo is compressed on the phone (≤1280 px JPEG) and the signature uploaded; the order stores only keys. |
| Audit (rest) | Also written for area/region create, retailer agent assignment, delivery assignment, delivery, product deactivate, imports. |
| 9. Importers | `/admin/import` (nav "Import"): retailers or products from `.xlsx` or `.csv`, up to 5,000 rows, template download. **Check file** runs the real import inside a transaction and rolls it back, so the preview is exactly what will happen; **Import now** is enabled only when there are zero errors, and saves all rows or none. Retailers match on phone (updated), new regions/areas are created, sales agent by login id; products match on SKU, rupees → paise, GST slab and price ≤ MRP checked. Errors use spreadsheet row numbers. |
| Platform | `npm run tenant:create -- --slug … --name … --admin-login … --admin-password …` creates a tenant and its first admin. |
| 6. Observability | `src/instrumentation.ts` `onRequestError` → `sendAlert()` (Telegram when `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` set; throttled; sends path/method/host only, never headers or bodies). `GET /api/health` for uptime monitors. |
| 7. CI | `.github/workflows/ci.yml`: Postgres 16 with a non-superuser app role, migrate deploy, schema-vs-migration drift check, seed, typecheck, lint, tests, build. |

Tests: 27 (`npm test`). Checked in the browser on `demo.localhost`: import preview/commit with bad rows, upload accepts a JPEG and refuses SVG, another tenant's file key → 404, a sales agent gets 403 on admin routes, a deactivated agent is refused at once (401), the worker logged `import.completed` and `order.placed`, `/api/health` up, production build passes.

## Still open (carried into the next phases)

1. **Staging on Coolify** — needs the server: app + worker services, Postgres with the non-superuser role, wildcard DNS + certificate, Telegram alert bot, uptime monitor on `/api/health`, scheduled Postgres backups with a restore drill.
2. Hard-coded English strings → dictionary (owner said "not now"; still pending).
3. Importers for opening balances (needs the Phase 1 ledger), price lists (Phase 2) and staff.
4. Web platform console (brand, custom domain verification) — Phase 9; the CLI covers tenant creation now.
5. Client pages still load data in `useEffect`; lint keeps this as a warning (8) until those screens move to server components.
6. Extra roles (accountant, warehouse, supervisor) — add enum values + `ROLE_PERMISSIONS` entries when Phase 1/5 need them.

## Local setup

```sh
docker run -d --name setu-pg -e POSTGRES_PASSWORD=<admin-pw> -p 55441:5432 --restart unless-stopped postgres:16
docker exec setu-pg psql -U postgres -c "CREATE ROLE setu LOGIN PASSWORD 'setu_local' CREATEDB NOSUPERUSER NOBYPASSRLS;" -c "CREATE DATABASE setu OWNER setu;"
cp .env.example .env        # then fill SESSION_SECRET
npx prisma migrate dev
npm run db:seed
npm run dev                 # http://demo.localhost:3100 and http://second.localhost:3100
npm run worker              # background jobs (separate terminal)
npm test
```

## Deploy notes (Coolify)

- The app must connect as a **non-superuser** role (superusers bypass row-level security). Create the role and database as above in the Coolify Postgres service; `CREATEDB` is only needed locally for Prisma's shadow database.
- Env: `DATABASE_URL`, `SESSION_SECRET`, `PLATFORM_DOMAIN=<platform domain>`, `DEFAULT_TENANT_SLUG` empty, `OTP_DEV_MODE` empty (or `1` on a demo server only).
- DNS: wildcard `*.<platform domain>` → the server; Coolify/Traefik needs a wildcard certificate (DNS challenge) for tenant subdomains.
- Run `npx prisma migrate deploy` on release.
- Second service from the same image for the worker: `npm run worker`.
- Files: set `STORAGE_DRIVER=s3` + bucket env, or mount a persistent volume at `STORAGE_DIR` for the local driver.
- Uptime monitor: `GET /api/health`. Alerts: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `APP_ENV=prod`.
