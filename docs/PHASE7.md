# Phase 7 — Communication and engagement

Branch: `feat/phase7-engagement` (cut from `feat/phase6-field-sales`).
Plan: `docs/ROADMAP.md` §6 Phase 7. Exit check: **every message the app sends comes from a change that really committed, is sent at most once per person and channel, respects the business's channel choices and the person's mutes and language, and can be traced in the message log; complaints keep an SLA and a full thread; a referral pays once and only through the ledger; and the Phase 1–6 rules still hold**. This is covered by `tests/engage.test.ts` and by the seeded demo.

## How it works

### Notification centre (`src/lib/notify.ts`, `src/lib/notify-events.ts`)

- Every message is an **event** (`EVENTS`): who it is for (retailer or staff), its default channels, the placeholders it may use, an optional topic people can mute (`reminders`, `promo`), and default wording in English and Hindi.
- `notify(tx, tenantId, { event, to, vars, link, key })` runs **inside the business transaction**. It writes an in-app `Notification` per person and one `MessageLog` row (status `QUEUED`) per outside channel. If the transaction rolls back, nothing was "sent".
- Per person: the language (`User.lang`, set by the language toggle), their mutes (`User.mutes`: a channel or a topic), a phone for SMS / WhatsApp, a registered device for push. Staff events go by **push only** (no SMS / WhatsApp cost).
- The business's own wording (`MessageTemplate`, per event and language) replaces the default; it is checked so it only uses that event's placeholders. It also carries the **approved WhatsApp template name** and the **DLT template id** for SMS in India.
- `key` makes it idempotent: `(tenantId, dedupeKey)` is unique, so a retried job never sends twice.

### Sending (`src/lib/outbox.ts`, worker job `messages.flush`)

- After a transaction that queued messages commits, `withMoney` wakes the worker (`kickMessages`, one waiting job per business). A sweep also runs every minute.
- Each row is claimed before sending (so two workers never send the same row), then marked `SENT`, `FAILED` (retried up to 3 times, 5 minutes apart, for 24 hours) or `LOGGED`.
- **No provider set = `LOGGED`**: the message is kept in the log with its full text, nothing leaves the machine (same rule as OTP).
- Push: Web Push with VAPID keys (`web-push`); a device that is gone (404/410) is removed. `public/sw.js` shows the notification and opens its link.
- WhatsApp: Meta Cloud API template messages (`WHATSAPP_PROVIDER=meta`). Business-started messages need a template approved by Meta; without its name set under Wording the message fails with that reason. The invoice PDF goes as the template's document header.
- SMS: no provider yet (`SMS_PROVIDER` set but unknown → `FAILED` with a clear reason).

### What sends what (`src/lib/notify-flows.ts`)

| When | Retailer gets | Office gets |
| --- | --- | --- |
| Order placed | Confirmation (push + WhatsApp) | New order (staff with `orders.manage`) |
| Out for delivery | Dispatched with driver and slot, plus the invoice with its PDF and public link | |
| Delivered | Delivered, with "rate this delivery" | |
| Not delivered / cancelled | The reason | |
| Payment confirmed (not wallet / credit note) | Receipt with the new balance | |
| Bill overdue by 1, 7 or 15 days (settings), 10:00 daily | One reminder for the whole overdue sum, with a pay link | |
| 1st of the month (if on) or the khata button | Statement: balance, overdue and khata link | |
| Complaint answered / status changed | Update | New complaint, retailer reply, past SLA |
| Low rating (≤ 2 by default) | | Low rating |
| Shop proposed from the field | | Approvers (`stores.approve`) |
| Leave asked for | | Their supervisor and staff managers |
| Referral paid | Reward with amount | |
| Announcement published | The announcement | Staff announcement |

### Complaints (`src/lib/tickets.ts`)

- A retailer (or field staff for a shop they serve) raises a complaint with a category, an optional order, a message and up to 4 photos. Numbers are `TKT<FY>-00001`.
- SLA from the category (damaged / missing / wrong item / expired 24 h, late / payment 48 h, billing / staff / other 72 h; changeable per business). Damaged, missing and expired are **high** priority. One open complaint per order and category.
- Status: Open → In progress → (Waiting for the retailer ↔ In progress) → Resolved → Closed. Any reply the retailer can see starts work; resolving and "waiting" need a message the retailer sees. Internal notes are never shown to the retailer. The first office reply time is kept.
- The retailer can reopen a resolved complaint; resolved ones close by themselves after 3 days. A 15-minute sweep tells the office once when a complaint is past its SLA.

### Delivery ratings

- After delivery the retailer rates 1–5 stars with tags (on time, polite, packed well, late, rude, damaged, short) and a comment, once per order, for 7 days. The office sees the average, stars, tags and each driver's average.

### Refer & earn (`src/lib/referrals.ts`, off by default)

- Each shop gets a readable code (no 0/O/1/I/L). A new shop enters it at sign-up (`/login?ref=CODE`); its own code and a shared GSTIN are refused.
- When the new shop's **first delivered order** is at least the minimum (₹2,000 default) within the valid days (60), the rewards are paid **once** into both wallets through the ledger (kind `REWARD`: Dr Promotions and rewards / Cr Wallet). A monthly cap per referring shop (10) stops abuse. Otherwise the referral lapses with the reason. Amounts are fixed on the day the shop signs up; turning the feature off stops new codes at sign-up but keeps the promise to shops that already joined with one.

### Announcements (`src/lib/announcements.ts`)

- For retailers (all, or by area / group), staff (by role) or both; title, message, optional link and picture, pinned, start / end, channels. Drafts can be counted ("how many will get it") and published once; after that only the text and dates can change. Live ones show as cards on the home pages.

## Settings (`settings.notify`, `settings.support`, `settings.referral`)

| Setting | Default |
| --- | --- |
| Channels | Push on, WhatsApp off, SMS off |
| Per message | Each event's own channels (can be changed per channel) |
| Payment reminders | On, 1, 7 and 15 days after the due date |
| Monthly statement | Off |
| SLA per category | See above |
| Resolved complaints close after | 3 days |
| Ratings allowed for | 7 days |
| Low rating alert at or below | 2 stars |
| Refer & earn | Off; ₹200 to the referring shop, ₹0 to the new shop, ₹2,000 first order, 60 days, 10 a month |

## Environment

`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto: or https:), `WHATSAPP_PROVIDER=meta`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_API_VERSION`, `PUBLIC_SCHEME` / `PUBLIC_PORT` (links inside SMS / WhatsApp). See `.env.example`. Local dev push keys are in `.env` (not committed).

## Done

- Schema and migration `20261119100000_engagement`: 9 new tables, all with row-level security, and checks on language, rating, referral amounts, priority and dates.
- Notification centre, outbox and sender with push, WhatsApp (Meta) and logging; worker jobs `messages.flush`, `dues.reminders`, `statements.monthly`, `tickets.sla`, `engage.daily` (auto-close, lapse referrals, delete read notifications after 90 days and the message log after a year).
- Complaints, ratings, referrals, announcements, with API routes for retailers, staff and the office.
- New permissions: `messages.manage`, `tickets.raise` (retailers, sales agents, supervisors), `tickets.manage`, `promotions.manage`.

## Screens

- **Everyone**: a bell with the unread count in the header (refreshes every minute and on focus) opens `<home>/notifications`: the list (tap to open, mark all read) and settings: message language, mute push / WhatsApp / SMS, mute reminders or offers, turn on notifications on this device (Web Push; explains when the business or the browser can't).
- **Home pages** (shop, sales, driver, supervisor): live announcement cards, pinned first.
- **Retailer**: Help in the bottom nav (`/retailer/help`: my complaints, new complaint with type, order, photos; `/retailer/help/[id]`: the thread, reply, reopen a resolved one); rate a delivery on the order page (`?rate=1` from the notification) and a prompt on the home page; Refer & earn (`/retailer/refer`: code, WhatsApp share, shops referred); "Problem with this order?" on the order page; links on the account page.
- **Sign-up**: optional referral code, filled from `/login?ref=CODE` and checked as you type ("Code from …").
- **Sales agent**: "Raise complaint" for a shop on the shop page.
- **Office**: Complaints (`/admin/complaints`: open / overdue / mine / resolved / closed / all with counts, type filter, search, time left on the SLA; one complaint: thread with internal notes, reply or internal note with photos, only the allowed status buttons, assign, priority, the shop, the order and its rating). Engage (`/admin/engage`): Announcements (draft, reach count, publish with confirm, end), Refer & earn (list, totals, cancel a pending one with a reason), Ratings (7 / 30 / 90 days, stars, tags, per driver), Message log (filters, channel status, send a failed one again, test push), Wording (per message and language, placeholders, WhatsApp template name, DLT id, reset). Khata: "Send statement". Settings: Messages, Complaints, Refer & earn.

Checked on a production build at 375 px wide: every new office and retailer page fits with no sideways scroll; an office reply resolving a complaint, the shop's view (no internal notes, "Reopen"), and a `?ref=` sign-up link were tried by hand.

## Demo data (`npm run db:seed`)

- Messages on with push and WhatsApp (shown as "logged": no provider), monthly statement on, payment reminders on.
- Sai Super Mart reads Hindi. Own wording for the order confirmation with WhatsApp template `order_confirm_v1`.
- Refer & earn on: Agarwal joined with Sai Super Mart's code and its delivered order paid both (₹200 and ₹50 into the wallets); Patel joined with Agarwal's code and is waiting.
- Agarwal rated the delivered order 4 stars.
- Complaints: Agarwal's damaged carton (in progress, with an internal note), Patel's billing complaint past its SLA, Patel's late delivery waiting for an answer, Sai Super Mart's staff complaint (Hindi) resolved.
- Announcements: a pinned Diwali offer (live), a Sunday-delivery draft for one area, a staff meeting notice.
- A statement sent to Patel; all queued messages already flushed.

## Tests

`tests/engage.test.ts` (31 tests, fresh users in the demo tenant):

- wording: placeholders, unknown placeholders refused, WhatsApp body (91 prefix, invoice header, blank params), per-event channel overrides, settings validation;
- notification centre: in-app + WhatsApp once per key, Hindi and own wording with the template name, channel and topic mutes, staff push only and only with a device, `LOGGED` without a provider, failed push retried after 5 minutes, statement link, alerts for new shops and leave;
- complaints: number, SLA and priority, photo keys from this business only, duplicates, internal notes hidden, first response, status rules, waiting and retailer reply, reopen, auto-close, someone else's complaint, SLA alert once;
- ratings: only delivered, once, within 7 days, tags filtered, low rating alert;
- referrals: codes, off by default, own code refused, paid once into both wallets with balanced entries, below minimum, expiry, monthly cap;
- announcements: area audience, publish once, home cards by area, locked audience after sending, staff roles by push;
- permissions and tenant isolation of the new tables.

Full suite: 181 tests in 13 files pass on a freshly seeded database (the complaint tests also check the raised time and that an internal note can't resolve a complaint).

## Still open

- **SMS provider** (also needed for real OTP): pick one, register DLT templates, fill `dltId` per message.
- **WhatsApp per business**: each business needs its own WhatsApp Business number (or a provider account) and Meta-approved templates; today the token and number are one per server.
- Credit note straight from a complaint (today the office raises it in the khata).
- Statement as a PDF attachment (today it is a balance message with the khata link).
- Regional languages beyond Hindi.
- Scheduled announcements: the push / WhatsApp / SMS go out when you publish, even with a later start; only the home card waits for the start time (the form says so). A sweep that sends at the start time would fix it.
- `/api/referrals/check` says "feature off" with status 409, and the sign-up form relies on that; a plain `{ on: false }` would be cleaner.
- `npm audit` items existed before this phase (prisma config, vitest, exceljs); `web-push` adds none.

## Traps

- `notify()` must be called with the **transaction** (`ctx.tx`), never the plain client, or a rolled-back change still "sends".
- Tests run with `JOBS_DISABLED=1` (in `vitest.config.ts`), and the seed sets it too, so neither starts a job queue; the seed flushes messages itself.
- `web-push` only accepts a `mailto:` or `https:` VAPID subject.
- Upload keys look like `t/<tenant>/<kind>/yyyy/mm/<uuid>.<ext>`; complaint photos are checked by the `t/<tenant>/ticket-photo/` prefix.
- Tests leave rows in the demo tenant: reseed (`npm run db:seed`) before a demo.
