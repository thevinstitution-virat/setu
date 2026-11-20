# Seller's Setu

Multi-business SaaS for distributors: orders, deliveries, GST invoices, collections and the shop ledger (khata), field sales, stock and AI helpers. Each business gets its own address (`<slug>.<PLATFORM_DOMAIN>`) and brand; shops order from their phones.

Plan: [docs/ROADMAP.md](docs/ROADMAP.md). What each phase built: `docs/PHASE0.md` to `docs/PHASE15.md`.

## Local development

```bash
cp .env.example .env          # set DATABASE_URL to a NON-superuser role (row-level security)
npm ci
npx prisma migrate deploy
npx prisma db seed            # demo business and test logins (development only)
npm run dev                   # http://demo.localhost:3100 (the demo business), http://platform.localhost:3100 (platform)
npm run worker                # background jobs, in a second terminal
```

Checks: `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (needs the seeded database), `npm run build`. CI runs the same on Postgres 16 (`.github/workflows/ci.yml`).

## Deploy

Docker image and Coolify compose file (web + worker), backups, the restore drill and the go-live checklist: [docs/DEPLOY.md](docs/DEPLOY.md). Before real use run `npm run golive:check` on the server.
