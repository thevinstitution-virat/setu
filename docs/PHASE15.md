# Phase 15 — Go-live hardening

Branch: `feat/phase15-golive` (cut from `feat/phase14-photos`).
Plan: `docs/ROADMAP.md` §8 (security and compliance) and §10 (go-live for tenant #1). Every roadmap phase and AI item (A1–A13) is built; this phase gets the server ready for real use. Exit check: **CI green; password guessing locked out across containers; cross-site writes refused; security headers on every response; the image builds and serves; a backup taken by a least-privilege role restores with matching counts; `npm run golive:check` lists everything unsafe or missing; terms and privacy pages linked from sign-up**. Covered by `tests/golive.test.ts` (14).

## CI

CI had been red since Phase 7: the engage test expected a broken push device to fail, which only happens when VAPID keys are set, and CI has none. The test now makes throwaway VAPID keys for itself and restores the environment afterwards (`onTestFinished`).

## Security (`src/lib/security.ts`, `src/lib/login-limit.ts`)

- **Password sign-in limits** (business staff and the console): 5 wrong passwords for one login, or 30 from one network address, within 15 minutes lock sign-in until the oldest try leaves the window ("Too many wrong tries. Try again in N minutes.", 429). A right password clears that login's wrong tries. Kept in the new platform table `AuthAttempt` (scope = business id or `platform`), so every web container shares it; the console's old in-memory limiter is gone. The daily `otp.cleanup` also deletes tries older than a day. OTP sign-in keeps its own limits.
- **Cross-site writes**: a POST / PUT / PATCH / DELETE to `/api` whose `Origin` is another host (or `null`, or junk) is refused in the proxy with 403. Requests without an `Origin` pass (webhooks, API keys, curl), and so do `/api/webhooks/`, `/api/platform/webhooks/` and `/api/v1/`. This is a second lock behind the `SameSite=Lax` session cookie.
- **Headers** on every response (`next.config.ts`): `nosniff`, `X-Frame-Options: DENY`, CSP `frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'` (no script rules: Next inlines its own), `Referrer-Policy`, `Permissions-Policy` (camera, location, microphone, payment on our own pages only), HSTS one year. `X-Powered-By` is off.
- **Session secret**: in production the server refuses to start (`src/instrumentation.ts`) when `SESSION_SECRET` is unset, the development default, or shorter than 32 characters. The build itself doesn't need it.
- **Uploads** were already checked by content (magic bytes) and size, and served through `/api/files` with access checks; nothing changed.
- **Dependency audit**: 6 findings, none reachable at run time (Prisma CLI's config loader, and exceljs's `uuid`); details and when to recheck in `docs/DEPLOY.md` §5.

## Deploy (`Dockerfile`, `docker-compose.yml`, `docs/DEPLOY.md`)

- One image (Node 22, non-root user `setu`, `postgresql-client` for backups) for **web** (`npm run start:prod`: `prisma migrate deploy`, then `next start` on `$PORT`) and **worker** (`npm run worker`). Health check `/api/health`. `NEXT_PUBLIC_WHATSAPP_NUMBER` is a build argument; Prisma gets a placeholder database address while building.
- Compose for Coolify: both services share one environment block (every variable from `.env.example`), files on the `setu-files` volume, backups on `setu-backups` (worker).
- `docs/DEPLOY.md`: database roles, Coolify steps (wildcard domain, variables, which to leave empty), console owner, backups, restore drill, the tenant #1 dry run, security notes.
- Tried locally: the image built, started against the local database ("No pending migrations", healthy), sent the headers, refused a cross-site POST with 403, ran `golive:check` and the worker inside the container.

## Backups (`scripts/backup-db.sh`, `scripts/restore-drill.sh`)

- The app's role **cannot** back up: every tenant table forces row-level security, so `pg_dump` stops. Backups use a read-only `setu_backup` role with `BYPASSRLS` + `pg_read_all_data`.
- `backup-db.sh`: custom-format dump to `.part`, renamed when complete, refused if it lists fewer than 50 tables, keeps the newest 14. Meant as a Coolify scheduled task on the worker.
- `restore-drill.sh`: restores a dump into a scratch database, prints the main tables' counts next to the live ones, drops the scratch database. Tried on 20 Nov: 130 tables, 7 s, counts equal.

## Readiness (`src/lib/golive.ts`, `npm run golive:check`, Console → Health)

Each check is ok / warn / fail; the script exits 1 on any fail. Fails: the app's database role is a superuser or `BYPASSRLS`; migrations missing; no job finished in 10 minutes (worker down); bad session secret; no `SECRETS_KEY`; no or local `PLATFORM_DOMAIN`; `OTP_DEV_MODE`, `ALLOW_GATEWAY_SIMULATOR`, `ALLOW_PRIVATE_WEBHOOKS`, `JOBS_DISABLED` on; `AI_PROVIDER=fake`; files in the app folder (no volume, no S3); no SMS provider. Warnings: `DEFAULT_TENANT_SLUG` set, `PUBLIC_SCHEME=http`, local storage on a volume (back it up), no Telegram alerts, `APP_ENV` not `prod`, no VAPID / WhatsApp / maps keys, no platform GSTIN or Razorpay, draft legal text, no grievance contact. The console's Health page shows the same list, failing first.

## Terms and privacy (`/legal/terms`, `/legal/privacy`, `src/lib/legal.ts`)

- Readable pages on every address, linked from the sign-up box ("I accept the terms of service and the privacy notice"), the sign-in card and the landing footer. On a business's address they name that business.
- The privacy notice (DPDP Act 2023) lists what the app actually keeps and why (from the data model: contacts, shop details and map pin, the ledger, photos, check-in selfie and position, on-duty positions only when turned on, message logs, sign-in tries), who handles data for us, how long it's kept (the business keeps invoices for GST's 8 years; closing an account deletes everything 7 days after a final download), rights, the grievance contact (`GRIEVANCE_CONTACT`) and breach notice.
- **Draft**: `LEGAL_DRAFT = true` shows a "Draft" banner and makes the readiness check warn. The owner's lawyer-checked text replaces the wording; then set it to false.

## Checked in a browser

Production build on port 3101, 20 Nov: `/legal/privacy` on the demo address (names the business, draft banner, data table at phone width); five wrong passwords for one login answered 401, the sixth 429 "Try again in 15 minutes"; `X-Frame-Options` and CSP on a page response; Console → Health with the readiness list (5 failing, 9 to look at on the dev setup), failing first; the landing page and sign-in card link both pages (the sign-up box is client-rendered: its links are in the bundle). The test sign-in tries were deleted afterwards. Not clicked: the sign-up wizard's last step.

## Not done / owner's part

- **SMS provider** (owner decision §12.2): without it shops can't get sign-in codes in production; the readiness check fails until one is built in.
- Final legal text and the grievance contact.
- Real Coolify deploy, wildcard certificate, off-server copy of backups, and the first restore drill on the server.
- Pen test before the first paying external business.
