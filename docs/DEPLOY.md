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

1. New resource → **Docker Compose** → this repository, branch `main`, compose file `docker-compose.yml`.
2. Domains on the **web** service: `https://<PLATFORM_DOMAIN>`, `https://www.<PLATFORM_DOMAIN>`, `https://platform.<PLATFORM_DOMAIN>` and the wildcard `https://*.<PLATFORM_DOMAIN>`, port 3000. The wildcard needs a DNS `*` record to the server and a wildcard certificate (DNS challenge in Coolify's Traefik settings). The worker gets no domain.
3. Environment (Coolify → Environment variables). Everything is listed in `.env.example`; the ones that matter on day one:

| Variable | Value |
|---|---|
| `DATABASE_URL` | the app role, above |
| `SESSION_SECRET` | 32+ random characters (`openssl rand -base64 48`). The web service refuses to start without a good one |
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

   Leave empty in production: `DEFAULT_TENANT_SLUG`, `OTP_DEV_MODE`, `ALLOW_GATEWAY_SIMULATOR`, `ALLOW_PRIVATE_WEBHOOKS`, `JOBS_DISABLED`, and `AI_PROVIDER=fake`.
4. Deploy. Health check: `GET /api/health` (database ping), already in the image.
5. On the web container's terminal: `npm run golive:check`. Every **FAIL** must be fixed before real use; **warn** lines are choices (no WhatsApp yet, no maps key…).
6. Create our console owner on the web terminal: `npm run platform:user -- --email <you> --name "<name>" --password '<strong>' --role OWNER` (never run `prisma db seed` in production: it adds the demo business and test logins). Sign in at `https://platform.<PLATFORM_DOMAIN>/platform`. Console → Health shows the same readiness list.

Custom domains for businesses: `TLS_PROVIDER=coolify` with `COOLIFY_API_URL`, `COOLIFY_API_TOKEN`, `COOLIFY_APP_UUID` adds each verified domain to the app (not yet tried on a real proxy, see PHASE9.md).

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
- Pen test before the first paying external business (roadmap §8).
