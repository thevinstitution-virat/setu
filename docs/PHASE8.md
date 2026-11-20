# Phase 8 — Payments and integrations

Branch: `feat/phase8-payments` (cut from `feat/phase7-engagement`).
Plan: `docs/ROADMAP.md` §6 Phase 8. Exit check: **money paid online reaches the shop's khata on its own, exactly once, however often the gateway calls; the gateway's payout and fee land in the books; a bank statement upload confirms or books each money-in line at most once; the business's own software can read its data with a key and hear about changes through signed webhooks; route distances work with or without a maps provider; and the Phase 1–7 rules still hold**. This is covered by `tests/payments.test.ts` and by the seeded demo.

## How it works

### Online payments (`src/lib/gateway.ts`, `src/lib/razorpay.ts`, `src/lib/gateway-settings.ts`)

- Each business uses **its own Razorpay account** (owner's choice, ROADMAP §12). It saves its key id, key secret and webhook secret under Settings → Online payments; the secrets are encrypted (`src/lib/secrets.ts`, AES-256-GCM with `SECRETS_KEY`) and never sent back to a screen or into the audit log.
- A **payment request** (`PaymentIntent`) is a payment link (`LINK`) or a single-use UPI QR (`QR`), for all dues (default), a typed amount, a wallet top-up, or what is left on one order. Who can make one: the shop itself (links, when "Shops can pay online" is on), field staff for shops they serve, the office for anyone. The row is saved first, the gateway is called with no transaction open, then the row gets the gateway's id and URL; a second tap for the same thing returns the open request.
- **Webhook** `POST https://<business>.<domain>/api/webhooks/razorpay`: the raw body is checked against `X-Razorpay-Signature`; each event is stored once (`GatewayEvent`, by `X-Razorpay-Event-Id`). Events used: `payment_link.paid` / `partially_paid`, `qr_code.credited`, `payment.captured` (backup, only for our own requests via `notes.setu_intent`), `settlement.processed`, `payment_link.expired` / `cancelled`, `qr_code.closed`. Answers 200 when handled or ignored, 401 for a bad signature, 500 when processing failed (Razorpay retries).
- A captured payment becomes a **confirmed payment, method `ONLINE`**: Dr *Online payments to be settled* (`GATEWAY_CLEARING`) / Cr the shop, allocated to bills as usual, with the receipt message. The gateway's payment id is unique per business, so a repeated webhook, the sync and a second event about the same payment never book twice.
- **Settlement** (the gateway paying our bank): Dr Bank (net) + Dr *Payment gateway fees* (`GATEWAY_FEES`, fee incl. GST) / Cr *to be settled* — once per settlement id. A payout the webhook missed can be booked from the bank statement with its fee.
- **Lost webhooks**: worker job `gateway.sync` (every 10 minutes) asks Razorpay about open requests from the last 3 days and expires older ones. Screens can ask for one request with `?sync=1`.
- **Practice gateway** (`provider: "simulator"`, dev and demo only unless `ALLOW_GATEWAY_SIMULATOR=1`): links open `/pay/sim/<id>`, where a button pays (all or part). It goes through the same booking code.
- **Delivery QR**: the driver shows a single-use QR for what is left on the order; the screen polls until it is paid; the delivery is then finished with no collection and is marked paid online.

### Bank statement import (`src/lib/bank.ts`)

- Upload a CSV or Excel statement as the bank gives it (header found below the account details; debit / credit columns or amount + Dr/Cr; Indian date and amount formats). Each line has a fingerprint, so uploading overlapping statements imports each line once. Money-out lines are set aside.
- Each money-in line gets suggestions; a line with **exactly one sure match** (same amount and its reference in the narration or reference column) is matched on import:
  - `VERIFY` — a UPI / bank payment a shop reported that is waiting: confirmed (UPI also moves from *UPI to be banked* to Bank);
  - `UPI_CLEAR` — a confirmed UPI payment reaching the bank: Dr Bank / Cr UPI to be banked;
  - `BANK_LINK` — a confirmed bank transfer: linked only (already in Bank);
  - `CHEQUE_CLEAR` — a cheque (deposited if needed, then cleared);
  - `SETTLEMENT` — a gateway payout: linked, or booked here with its fee;
  - `CASH_DEPOSIT` — office cash paid in: Dr Bank / Cr Office cash (suggested when the narration says cash; always offered);
  - `NEW_PAYMENT` — money from a shop nobody recorded: a bank payment for that shop (shop suggested by GSTIN, phone or name in the narration).
- One payment / cheque / payout matches one line (unique per kind and id). Matches that booked an entry are not undone from here (reverse the payment instead); link-only matches can be undone. "Match again" re-runs suggestions after payments are recorded.

### API keys and the read-only API (`src/lib/api-keys.ts`, `src/lib/public-api.ts`, `/api/v1/...`)

- Keys look like `setu_<prefix>_<secret>`; only the SHA-256 is stored; the key is shown once. Scopes: `retailers:read`, `products:read`, `orders:read`, `invoices:read`, `payments:read`, `stock:read`. 120 requests a minute per key (per web process). Last use (time, IP) is shown.
- `GET /api/v1/{retailers|products|orders|invoices|payments|stock}` with `limit` (1–200), `cursor` (`next_cursor`), `updated_since` (ISO; payments: created); `GET /api/v1/<resource>/<id>`. JSON in snake_case, money in paise with `_paise` in the name. These shapes are a contract: add fields, never rename.

### Outbound webhooks (`src/lib/webhooks.ts`)

- Events: `order.placed`, `order.status_changed` (with `previous_status`), `invoice.issued`, `payment.received`, `retailer.created`. Payloads use the same shapes as the API.
- An outbox: rows are written in the same transaction as the change (or in the worker job that follows it), so nothing is sent for a change that rolled back. Worker job `webhooks.flush` sends after a change and sweeps every minute.
- Headers: `Setu-Event`, `Setu-Delivery` (same on retries; use it to drop repeats), `Setu-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>`.
- Retries after 1 m, 5 m, 30 m, 2 h, 6 h, 12 h, then given up (`DEAD`, can be sent again by hand). An address is turned off after 20 failed sends in a row. 10-second timeout, redirects not followed.
- Address safety: https only, no user/password in the URL, and the name must not point into a private network (checked when saved and again before each send). `ALLOW_PRIVATE_WEBHOOKS=1` lifts this for local testing.

### Maps (`src/lib/maps.ts`)

- `MAPS_PROVIDER=google` + `GOOGLE_MAPS_API_KEY` (Geocoding and Directions APIs on the key): shops without a pin get one from their address (`locationSource: "address"`; rough locality-level answers are not used), and trips get road distance and time per leg. Answers are cached per business (`GeoCache`: addresses 180 days, routes 30 days). Only the shop's address is sent.
- Without a provider: no address lookup; distance = straight line × 1.3 at 20 km/h.
- Pins are looked up after sign-up and approval of a field-proposed shop (job `geo.locate`) and from the office's button. Route order now also untangles the nearest-neighbour path (2-opt).

## Settings (`settings.gateway`)

`provider` (none / razorpay / simulator), `keyId`, `keySecret` and `webhookSecret` (encrypted), `acceptPartial` (shops may pay part of a link), `retailerPay` (shops can pay online from the khata; default on), `linkDays` (1–90, default 7), `qrMinutes` (5–240, default 30). Saved through `/api/admin/settings/gateway`, not the general settings route, so secrets stay out of its payload and audit.

## Environment

`SECRETS_KEY` (32 bytes as 64 hex characters, `openssl rand -hex 32`; required in production; changing it makes saved secrets unreadable), `ALLOW_GATEWAY_SIMULATOR`, `MAPS_PROVIDER`, `GOOGLE_MAPS_API_KEY`, `ALLOW_PRIVATE_WEBHOOKS`. See `.env.example`.

## Done

- Schema and migration `20261119120000_payments_integrations`: 9 new tables with row-level security; checks on request amounts, one-sided bank lines, settlement amounts, delivery attempts and the location source. New ledger accounts `GATEWAY_CLEARING`, `GATEWAY_FEES`; entry kinds `BANK_MATCH`, `GATEWAY_SETTLEMENT`; payment method `ONLINE`.
- Gateway (links, QR, webhooks, settlements, sync, cancel, practice gateway); bank import and matching; API keys and `/api/v1`; outbound webhooks; maps with fallback; route estimate `GET /api/trips/<id>/route-estimate`.
- New worker jobs: `gateway.sync` (every 10 minutes), `webhooks.flush` (after a change and every minute), `geo.locate`.
- New permissions: `gateway.manage`, `bank.reconcile`, `integrations.manage` (admin).

## Screens

- **Office**: Settings → **Online payments** (provider Off / Razorpay / Practice gateway, key id with test/live badge, secrets as "Saved" + Replace, the webhook URL and events to copy into the Razorpay dashboard, shops-pay-online and part-payment switches, link days and QR minutes). **Bank** (`/admin/bank`): upload a statement, the summary (matched / need a look / money out / already imported), tabs Needs a look / Matched / Set aside, search, statement filter, suggestions with "Sure match", fee box for an unrecorded payout, cash deposited, new payment from a shop (shop search, dues or wallet), set aside / bring back, undo a link, Match again. **Integrations** (`/admin/integrations`): API keys (scopes, shown once, revoke, last used, base URL and a curl example), Webhooks (add, secret shown once, on/off, test event, deliveries with the body and Send again, edit, show / new secret, delete, the signature explained), Maps (provider, shops without a pin, Find pins). A shop's khata has a **Payment link** card (amount or all dues, copy, Send on WhatsApp, recent requests with Check now / Cancel).
- **Retailer**: khata **Pay online** (amount defaults to all dues; prepaid shops can top up the wallet) opening the gateway's page; back on the khata with `?paid=1` a thank-you banner and a few refreshes; recent online payments with Open for a link still open.
- **Practice gateway** page `/pay/sim/<id>` (no sign-in): "Practice payment — no real money moves", Pay ₹X, paid / closed / expired states.
- **Driver**: on the delivery screen, **Shop pays by QR** (QR from Razorpay, or drawn from the link for the practice gateway), checked every 4 s; when paid in full the collection is hidden and the delivery finishes with no collection (marked paid online); a part payment moves the amount box to what is left. The trip card shows **About X km · Y min** (straight-line estimate without a maps provider, and stops with no pin).
- **Sales agent**: on the shop page, **Send payment link** (copy, WhatsApp to the shop's number, check if paid).
- **Dispatch** trip page: the same route estimate.

Not yet checked in a browser: the screens type-check and lint, but the preview server could not be started in this session (the folder's server slots were all in use by other chats). Do a 375 px pass before merging.

## Demo data (`npm run db:seed`)

- Practice gateway on, shops can pay online, part payments allowed.
- Agarwal: a ₹1,500 link with ₹500 paid. Sai Super Mart: a ₹800 link not yet paid, and a reported ₹420 UPI payment.
- A bank statement (`demo-statement.csv`): Sai's UPI confirmed on import; a cash deposit and Patel's IMPS (found by phone) suggested; an unknown NEFT not matched; SMS charges set aside.
- No API keys or webhook addresses (a key is shown only once, when made).

## Tests

`tests/payments.test.ts` (26 tests, fresh shops in the demo tenant; full suite 207 tests in 14 files pass on a freshly seeded database):

- secrets (round trip, tamper refused), gateway settings (validation, nothing secret on screen), webhook signature, permissions;
- statement parsing: Indian dates (incl. Excel day numbers) and amounts, references, cheque numbers as whole tokens, header below account details, amount + Dr/Cr layout, wrong files;
- 2-opt never longer; straight-line fallback;
- practice gateway: off until set up, link for all dues reused, part then rest, ledger and khata, duplicate payment id, nothing due, order QR amount, wrong shop's order, cancel, expiry sweep;
- Razorpay with a stubbed API: link request (reference, no gateway SMS, shop number), unsigned / wrong signature refused, booked once across repeated and different events, foreign events ignored, settlement with fee once;
- bank: sure matches on import (reported UPI, office UPI, cheque) with exact ledger effects, suggestions (cash deposit, shop by phone), money out set aside, re-upload adds nothing, cash deposit and new payment by hand, no second match, booked matches not undone, wrong amount refused, set aside and back;
- API keys: hash, scope, wrong key, other business, revoked; paging, cursor, `updated_since`, stock;
- webhooks to a local server: private addresses refused, signed delivery with the payment, retries with backoff, given up after the last attempt;
- tenant isolation of the new tables.

## Still open

- **Razorpay account per business**: the owner creates it, completes KYC, and pastes the keys and webhook secret; nothing was tried against a live or test Razorpay account yet (the API calls are covered with a stub).
- Razorpay Route / marketplace split (platform fee) is not used; each business is paid directly.
- Bank statement **PDF** import (today CSV / Excel only) and direct bank feeds (account aggregator).
- Write access in the API (placing orders from an ERP) and per-key IP allow lists.
- The API rate limit is per web process; with several web containers it needs a shared store.
- Webhook DNS is checked before each send, but the HTTP client resolves the name again (a short rebinding window remains).
- Maps: no Google key on the server yet; with none, distances are straight-line estimates.
- The route estimate covers the whole trip, including stops already delivered.
- The bank page's shop picker loads the whole khata list and searches it in the browser; a light `/api/admin/retailers?q=` search would be better for big lists.
- With short delivered lines the order QR sends the on-screen amount; the server's "left on the order" uses the order total until the delivery is saved.
- Three new `set-state-in-effect` lint warnings in the bank and payment-link screens (16 in all, 0 errors).

## Traps

- `SECRETS_KEY` must be the same on the web and worker containers, and must not change once secrets are saved (they would no longer decrypt; re-enter them).
- Razorpay must send webhooks to the **business's own address** (the tenant comes from the host), with the same secret as saved in Settings.
- A payment's `gatewayPaymentId` is unique per business: never clear it to "retry" a booking.
- Bank lines are unique per business by fingerprint (account label + date + narration + reference + amounts + balance + position among identical lines): renaming the account label makes a re-upload import again.
- Tests leave rows in the demo tenant: reseed (`npm run db:seed`) before a demo.
