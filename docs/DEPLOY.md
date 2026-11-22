# Deploying Seller's Setu (Coolify)

One Docker image runs two services: **web** (the app) and **worker** (background jobs and schedules). Postgres is a separate service. Owner decision 1: our Coolify VPS; managed Postgres in India is the safer option for backups (roadmap §12.1).

Files: `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `scripts/backup-db.sh`, `scripts/restore-drill.sh`, `npm run golive:check`.

## 1. Database

Create the database and two roles as the Postgres admin. The app must **not** connect as a superuser or a `BYPASSRLS` role: either one turns tenant isolation off (`golive:check` fails on it).

```sql
CREATE DATABASE setu;
CREATE ROLE setu_app LOGIN PASSWORD '<random 32+>' NOSUPERUSER NOBYPASSRLS;
ALTER DATABASE setu OWNER TO setu_app;          -- migrations create the tables as this role (as in CI)
CREATE ROLE setu_backup LOGIN PASSWORD '<random 32+>' BYPASSRLS;
GRANT pg_read_all_data TO setu_backup;          -- read-only, for pg_dump only
```

- `DATABASE_URL=postgresql://setu_app:...@<db-host>:5432/setu`
- `BACKUP_DATABASE_URL=postgresql://setu_backup:...@<db-host>:5432/setu` (worker only)

Migrations run on every web start (`npm run start:prod` = `prisma migrate deploy && next start`). Run the first one with a single web container.

## 2. Coolify application

1. New resource → **Docker Compose** → this repository, branch `master`, compose file `docker-compose.yml`.
2. Domains on the **web** service: `https://<PLATFORM_DOMAIN>`, `https://www.<PLATFORM_DOMAIN>`, `https://platform.<PLATFORM_DOMAIN>`, port 3000, with `https://<PLATFORM_DOMAIN>` **first**. The worker gets no domain. Coolify (4.7) can't route a wildcard to an app, so business addresses are routed by the proxy sync below.
3. Environment (Coolify → Environment variables). Everything is listed in `.env.example`; the ones that matter on day one:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the app role, above |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 48`). The web service refuses to start without a good one |
| `PLATFORM_SESSION_SECRET` | another random string of 32+ characters, different from `SESSION_SECRET` (signs the console cookie and support links). The app refuses to start without it |
| `SECRETS_KEY` | 32+ random characters; encrypts businesses' Razorpay and WhatsApp keys. **Never change it** once keys are saved |
| `PLATFORM_DOMAIN` | e.g. `sellerssetu.in` |
| `APP_ENV` | `prod` |
| `STORAGE_DRIVER` | `s3` with `S3_*`, or leave `local`: files go to the `setu-files` volume (`/data/storage`), which must then be backed up too |
| `PUBLIC_SCHEME` | `https` (default) |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | error alerts |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys` |
| `PLATFORM_LEGAL_NAME`, `PLATFORM_ADDRESS`, `GRIEVANCE_CONTACT` | shown on invoices and the terms / privacy pages |
| `BACKUP_DATABASE_URL` | the backup role, above |
| `NEXT_PUBLIC_WHATSAPP_NUMBER` | a **build** argument: changing it needs a rebuild |
| `TRUST_PROXY_HOPS` | `1` behind Coolify's Traefik; `2` if a CDN (e.g. Cloudflare proxy) sits in front. Wrong = rate limits and audit IPs use the wrong address |

   Leave empty in production: `DEFAULT_TENANT_SLUG`, `OTP_DEV_MODE`, `ALLOW_GATEWAY_SIMULATOR`, `ALLOW_PRIVATE_WEBHOOKS`, `JOBS_DISABLED`, and `AI_PROVIDER=fake`.
4. Deploy. Health check: `GET /api/health` (database ping), already in the image.
5. On the web container's terminal: `npm run golive:check`. Every **FAIL** must be fixed before real use; **warn** lines are choices (no WhatsApp yet, no maps key…).
6. Create our console owner on the web terminal: `npm run platform:user -- --email <you> --name "<name>" --password '<strong>' --role OWNER` (never run `prisma db seed` in production: it adds the demo business and test logins). Sign in at `https://platform.<PLATFORM_DOMAIN>/platform`. Console → Health shows the same readiness list.

### Business addresses and custom domains (proxy sync)

Every business lives at `<slug>.<PLATFORM_DOMAIN>`, and Premium businesses can add a verified custom domain. Both are served by `scripts/proxy-sync-tenants.sh`, run on the Docker host as root by a systemd service every 5 seconds. It reads the open businesses and verified domains from the database and writes one Traefik router per address to `/data/coolify/proxy/dynamic/setu-tenants.yaml`, only when the list changes. Traefik then gets each certificate with the ordinary HTTP check, about 15 s after a new address appears. No DNS-provider token is needed, but each address uses one certificate. Let's Encrypt allows 50 new certificates a week per registered domain, so past roughly 40 sign-ups a week switch to a wildcard certificate (DNS challenge).

- DNS: a `*` record for `<PLATFORM_DOMAIN>` pointing to the server, DNS only (not proxied).
- App env: `TLS_PROVIDER=sync`, so a verified custom domain shows "certificate within a minute".
- Sign-up waits for the new address to answer over a trusted connection before opening it, for up to 90 s.
- Server files (Webyne): the script and `proxy-sync.env` (`SETU_DB_CONTAINER`, `PLATFORM_DOMAIN`, `SETU_SERVICE`) are in `/root/setu/`, and the unit is `/etc/systemd/system/setu-proxy-sync.service`. Logs: `journalctl -u setu-proxy-sync`.
- `SETU_SERVICE` is Coolify's Traefik service for the first domain, `https-0-<app uuid>-web-<hash>@docker` (read it from the web container's labels). It stays the same across deploys, but it changes if `https://<PLATFORM_DOMAIN>` stops being the first domain.
- After changing the script in the repo, copy it to `/root/setu/`. The service picks it up within 5 s.
- The old `TLS_PROVIDER=coolify` path (`COOLIFY_API_*`) is still in the code but untested, and it would need a redeploy for every domain. Don't use it.

## 3. Backups and the restore drill

- **Nightly backup**: Coolify → the worker service → Scheduled tasks → `sh scripts/backup-db.sh`, every day at 00:30 IST (`0 19 * * *` UTC). It writes `/data/backups/setu-YYYYMMDD-HHMM.dump` on the `setu-backups` volume, checks that the dump lists at least 50 tables, and keeps the newest `BACKUP_KEEP` (14).
- **Off the server**: a backup on the same disk is not enough. Either copy `/data/backups` off the server (S3 / another machine), or also turn on Coolify's own scheduled Postgres backup to S3 (on the Postgres service; it runs as the admin, so row-level security doesn't stop it). Encrypt the bucket.
- **Files**: with `STORAGE_DRIVER=local`, back up the `setu-files` volume too (photos, invoices, exports). S3 storage needs bucket versioning instead.
- **Restore drill** (before go-live, then monthly): copy a dump to a machine with `psql` and run

  ```sh
  RESTORE_ADMIN_URL=postgresql://postgres:...@<db-host>:5432/postgres \
  BACKUP_DATABASE_URL=postgresql://setu_backup:...@<db-host>:5432/setu \
  sh scripts/restore-drill.sh setu-20261121-0030.dump
  ```

  It restores into a scratch database `setu_restore_drill`, prints the counts of the main tables next to the live ones, and drops the scratch database. Tried locally on 20 Nov: 130 tables restored in 7 s, counts matched. Write the date and result in the ops log.

**Real restore** (after a loss): stop web and worker, `pg_restore --clean --if-exists --no-owner --no-privileges --dbname=<app database> <dump>` as the admin, give the tables back to the app role (`REASSIGN OWNED BY postgres TO setu_app` only if the restore made the admin the owner), start web (migrations catch up), then worker.

## 4. Tenant #1 (our own business) dry run

Roadmap §10, weeks −2 and −1. Do it first on a staging copy (a second Coolify app on its own database and `PLATFORM_DOMAIN`), then for real.

1. Sign up at `/start` (or create it from the console). Settings → GST & invoices: legal name, GSTIN, state, address; invoice series.
2. Admin → Import, in this order, each with **Preview** first: products (by SKU) → price lists → retailers (by phone) → opening balances. Fix every row the preview rejects in the sheet and preview again; commit only a clean preview.
3. Check balances: Reports → outstanding, total and per shop, against the accountant's list **line by line**. Any difference: correct with a ledger adjustment, never by re-importing.
4. Staff: invite delivery agents, sales staff and supervisors; each signs in once on their phone (Android wrapper or Add to home screen).
5. Admin → Set up: every item green. Brand: logo, colours.
6. A dry-run day on staging with real routes: orders → trip → deliveries with photos → collections → day close. Day close must reconcile to the rupee.
7. On the real server: `npm run golive:check` with no FAIL, a backup taken and one restore drill done, then the pilot route (100 shops, old process in parallel).

## 5. Security notes

- Passwords: 5 wrong tries per login, or 30 per network address, in 15 minutes lock sign-in for the rest of the window (`AuthAttempt`, shared by every container). OTP has its own limits.
- Writes to `/api` from another site's pages are refused (403); webhooks and `/api/v1` (API keys) are exempt. The session cookie is `SameSite=Lax`, the console's `Strict`.
- Security headers on every response (`src/lib/security.ts`): no framing, no MIME sniffing, HSTS, camera / location / microphone on our own pages only.
- **`npm audit`** (20 Nov): 6 findings, none reachable in the running app. 4 high + 1 moderate in `effect`, used only by the Prisma CLI's config loader (a ReDoS in its own parsers, tooling only); 1 moderate in `uuid` under `exceljs` (a bounds check when a caller passes its own buffer, which exceljs doesn't). Both fixes are breaking downgrades / upgrades (`npm audit fix --force`); recheck when Prisma 7 / exceljs 5 are taken up.
- Security review of every API route (20 Nov): findings, fixes and what is still open are in `docs/SECURITY-REVIEW.md`. It added `TRUST_PROXY_HOPS` (above), the "UPI and bank taken in the field" switch (Settings → Money; on by default: field UPI / bank waits in Payments → To verify) and "Sign out" for a staff member on the Team page (ends their sessions on every device; `POST /api/auth/logout {"everywhere": true}` does the same for yourself, no button yet).
- Second pass (20 Nov): the review's open items are fixed (see `docs/SECURITY-REVIEW.md`); it adds `PLATFORM_SESSION_SECRET` (above) and migration `20261121180000_review_open_items`.
- **Two-step sign-in and Google** (migration `20261123090000_google_two_step`):
  - Every staff login (Admin, Supervisor, Sales, Delivery) and every console login needs a code from an authenticator app after the password, mobile OTP or Google. The first sign-in after this ships sets the app up (QR code) and shows 10 one-time recovery codes. Shops may turn it on under Security (lock icon in the menu, `/account/security`).
  - **Every staff and console session made before this ends at once**: they sign in again and set up the app. Tell staff before deploying.
  - Fallback on a business address: an SMS code to the phone on file (costs an SMS; not offered when step one was itself a mobile OTP). The console has no phone, so: recovery codes, or `npm run platform:user -- --email … --reset-2fa` on the server.
  - Lost phone (staff): the owner opens Team → **Reset 2-step**; they set it up again at the next sign-in. The owner's own: a recovery code, or a console support session (WRITE) → Team.
  - Google: set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see `.env.example`) and add `https://ss.vpd.ceo/api/oauth/google/callback` as the only redirect URI. Without them there is no Google button. Google signs in only to a login already linked (Security → Connect Google) or whose email is the Google address; it never makes one.
- Pen test before the first paying external business (roadmap §8).
