# Phase 14 — Photo checks and shelf audits

Branch: `feat/phase14-photos` (cut from `feat/phase13-ordering-ask`).
Plan: `docs/ROADMAP.md` §7: **A3** read UPI screenshots and cheque photos in the "To verify" queue and compare them with what was entered, **A8** flag delivery photos that are reused, unclear or show no shop or goods, and crate pickups whose photo shows a different count, and **A10** shelf audits at a visit (our facings, other brands', empty slots). Exit check: **a payment proof whose amount, UTR or date differs from the entry is marked in the queue; the same photo used twice and the same UTR on two payments are caught with no AI; a blank delivery photo or a crate count that doesn't match becomes a check; an agent saves a shelf audit with or without AI and the owner sees our share per shop against the audit before; nothing is verified or posted by the AI**. Covered by `tests/photo-rules.test.ts` and `tests/phase14.test.ts`.

## The guardrail

The AI never verifies a payment, posts anything or changes a count. What it reads from a photo is a note on the payment in the queue, or a "check" Suggestion ("Looked into it" / "Not a problem"). Shelf counts it reads are filled into the form for the agent to correct; the saved numbers are the agent's, and the audit records whether they were typed, taken from the AI or corrected.

Without AI (no key, plan without `ai`, AI off, monthly cap used up) the rules still run: **the same photo used twice** (SHA-256 of the file, across payments, deliveries, pickups and shelf audits of one business) and **the same UTR on two payments** (UPI or bank, not rejected). Shelf counts are typed.

## A3 — payment proofs (`src/lib/photo-rules.ts` `comparePayment`, `src/lib/photo-checks.ts`)

- What the AI is asked (feature `photo.payment`, the photo plus a fixed prompt; it is **not** told the amount, UTR or shop): readable, kind (upi / bank / cheque / other), amount in rupees, reference (UTR / transaction id), date, status (success / pending / failed / unknown), cheque number and whether signed. Names, phone numbers, UPI ids and account numbers are never asked for.
- Compared with the entry:
  - **amount differs** (₹1 or more): bad;
  - a **failed** payment: bad; **pending**: warning;
  - **UTR differs**: warning. Spaces and dashes are ignored, and a shortened UTR counts if its last 6 or more characters match;
  - **date differs**: more than 3 days from the day it was entered, or for a cheque any day off the cheque date entered;
  - **cheque number differs**, **not signed**, **proof doesn't match the method** (a cheque photo on a UPI entry), **doesn't look like a payment proof**, **can't be read**.
- The worst flag decides: ok / look closer / doesn't match.
- **Payments → To verify**: a line under each payment with a photo. It shows the result ("Screenshot matches: ₹5,000 · UTR … · 19 Nov", or the flags with a sentence each), whether the AI read it or only reuse was checked, and **Check again** (or **Check now** before the first check).
- Only reuse (photo or UTR) becomes a Suggestion; the other flags are already in front of the person verifying.

## A8 — delivery and pickup photos

- **Delivery photos** (proof of delivery on delivered orders from the last 3 days), feature `photo.delivery`: readable, blank (black, pocket, floor), shows a shop, shows goods, one sentence. Blank, unreadable, or neither shop nor goods → a check: "Delivery photo doesn't show the drop: ORD-… to Shop (Driver)".
- **Crate pickups** (`ReturnableMove` PICKUP with a photo), feature `photo.pickup`: how many of that returnable are in the photo. A difference of at least 2 and at least 10% from what was entered → bad, and a check "Crates don't match the photo".
- Reuse → "Same photo used twice"; the same UTR → "Same UTR on two payments". New anomaly kinds `photo_reused`, `reference_reused`, `photo_unclear`, `crates_mismatch` (in `ANOMALY_LABEL`).
- Photo checks in **Suggestions → Checks** show the photo (tap to open).

## When photos are checked

- New queue **`photos.check`**: kicked (one waiting job per business) after a payment with a proof, a delivery or spot sale with a photo or proof, a crate pickup with a photo, and a shelf audit. A sweep runs every 5 minutes for every live business, in case a kick was lost or the queue was down.
- The sweep takes photos not checked yet: payments waiting to be verified (last 30 days), deliveries, pickups and shelf audits from the last 3 days, 40 per business per run.
- Each photo is checked once (`PhotoCheck` unique per subject and file). A new photo on the same payment is checked again; **Check again** forces it.

## A10 — shelf audits (`src/lib/shelf.ts`, `src/components/field/ShelfAuditCard.tsx`)

- On a shop's page (sales agents), a **Shelf audit** card: when the last audit was, our share and empty slots. **Audit shelf** → take a photo (camera, shrunk to 1280 px, upload kind `shelf-photo`) → with AI the counts are filled and our products seen on it are listed as chips to untick; without AI a line says why and the agent types them in → **Save audit**. Linked to the open visit when there is one.
- What the AI is asked (feature `photo.shelf`): our brands, then up to 40 of our products, numbered: the ones this shop bought in the last 90 days, most first, else the catalogue. It answers our facings, other brands' facings, empty slots, the numbers of our products it can see (only from the list) and a sentence.
- Counts are whole numbers from 0 to 1000 (also a check in the database).
- **Reports → Shelf** (`/admin/reports/shelf`, `reports.view`):
  - the latest audit per shop in the period, lowest share first. Our share = ours ÷ (ours + other brands'), with the change in points against the audit before;
  - empty slots, who audited, typed / AI / AI corrected, and the photo (marked when it was used before);
  - KPIs (average share, shops audited, empty slots, photos flagged), audits by person, and our products seen on shelves;
  - CSV like the other reports.
- Settings → Automation → **Shelf audits**: on/off for the card and the reading.

## Settings

Settings → Automation → **Photo checks**:
- **Read photos with AI**: photos go to the AI provider; this is the owner's decision.
- **UPI screenshots and cheques**.
- **Delivery and crate pickup photos**.

Reuse checks always run. Also **Shelf audits**. All on by default; the AI reading still needs the plan's `ai` module, AI on and credits.

## API

- `GET /api/payments` (with `payments.verify`) adds `photoCheck: { verdict, flags, source, summary, notes, checkedAt } | null` to each payment (for its current photo).
- `POST /api/payments/<id>/photo-check` → `{ photoCheck }`, checks again now (`payments.verify`).
- `POST /api/field/shelf-audits/read { retailerId, photoKey }` → `{ read: { ours, others, empty, seen: [{ id, name }], note } }` or `{ read: null, message }` (`field.work`, a shop the agent may serve).
- `GET /api/field/shelf-audits?retailerId=` → `{ on, audits }`; `POST /api/field/shelf-audits { retailerId, visitId?, photoKey, ours, others, empty, seen?, read?, note? }` → 201.
- `GET /api/admin/reports/shelf` (and `?format=csv`).
- `POST /api/uploads` takes kind `shelf-photo`.
- The AI gateway (`aiJson`) takes `images: [{ bytes, contentType }]` (JPEG, PNG or WebP, up to 4.5 MB each; PDFs are not sent), placed before the question.

## Schema

Migration `20261121090000_photo_checks` (applied locally):
- **`PhotoCheck`**: tenant, subject type (payment / delivery / pickup / shelf) and id, file key, SHA-256, source (rules / ai), verdict (ok / warn / bad), flags, result JSON (summary, notes, what was read, reused by), credits, checked at. Unique per subject and file; indexed by hash.
- **`ShelfAudit`**: tenant, shop, visit, by, photo, ours, others, empty, products seen, source (manual / ai / ai_edited), what was read, note.
- Checks on verdicts, sources and counts; row-level security like every tenant table.
- Settings: `automation.photos { on, payments, delivery }`, `automation.shelf { on }`.

## Checked in a browser

Production build on port 3101, 20 Nov, seeded demo, local seed accounts, no AI key (the browser pane was hidden, so the screens were read as text and driven from the page):

- Settings → Automation shows the two new cards.
- The demo's one UPI payment waiting to be verified, given a test photo for the check: "Photo not checked yet" → **Check now** → "Checked for reuse only", with the "AI reading is off" line.
- As sales agent: the shop page shows the Shelf audit card. A test shelf photo uploaded, the "no AI" line shown, counts 5 / 15 / 2 typed, saved: "our share 25%, 2 empty slots", and the card shows the last audit.
- As the owner: Reports → Shelf (KPIs, the shop row, by person) and the CSV.
- Found and fixed: the audit day showed in UTC (19 Nov for an audit at 03:51 on 20 Nov IST); the "no AI" line on the card repeated the generic suggestions message.
- The test photo was taken off the payment, and the test check, audit and files were deleted afterwards.
- On a first full page load in the hidden pane, Payments stayed on its Suspense "Loading…" (the pane doesn't hydrate it); reached by in-app navigation it rendered normally.
- **Not checked**: a real AI call on real screenshots, cheques, delivery, crate or shelf photos (only the fake provider in tests); the 5-minute job in the worker; the camera on a phone; 375 px.

## Tests

- `tests/photo-rules.test.ts` (11): payment match, amount and UTR differences, rounding and shortened UTRs, failed / pending / old / wrong kind / unreadable, cheques (number, date, signature), reuse without AI; delivery verdicts, crate slack, verdict order; shelf share and typed counts.
- `tests/phase14.test.ts` (10), on scratch businesses purged at the end:
  - payment proofs: a photo reused under a new key, and checked once; the same UTR (rejected payments don't count); the AI read matching and not matching, without being told the entry; reading switched off;
  - delivery and pickup photos: a blank delivery photo → a check; crates 6 vs 10 → a check, 9 vs 10 → fine; the sweep checks each photo once;
  - shelf audits: reading with our products listed, switched off, no AI; saving with typed / AI-corrected counts, bad counts, a photo that isn't a shelf photo; the report's share and change;
  - isolation: another business sees none of it, the same bytes there aren't "reused", and another business's photo key is refused.
- `tests/analytics.test.ts`: the shelf CSV of a business with no audits is just its header.
- Full suite: 372 tests in 26 files pass. `tests/analytics.test.ts` can still fail when run alongside the other database tests (Phase 10); it passes on a rerun.

## Still open

- **Sending payment screenshots to the AI provider** is the owner's call (the switch is on by default, but nothing is read until the plan has AI and a key is set). A screenshot can show the payer's name or UPI id even though we never ask for it.
- No real photos have been read yet: the prompts need a pass on real UPI apps (PhonePe, GPay, Paytm, bank apps), cheques, delivery and shelf photos before turning it on for businesses. The model is the gateway's (`AI_MODEL`).
- Reuse is caught only for the same file. A re-shot or cropped photo has a different hash; near-duplicate matching (perceptual hash) would need image decoding on the server.
- A pickup of two returnable types with one photo saves one row per type with the same upload: each row is compared with the count of its own type, and the shared upload is not counted as reuse.
- PDFs uploaded as payment proofs are checked for reuse only.
- Shelf audits are not yet on the supervisor's screens (team view) or in the shop's report page.

## Traps

- **Hidden browser pane**: a first full load of a page whose content sits in a Suspense boundary (Payments) can stay on the fallback; navigate inside the app (`window.next.router.push`) to see it.
- **`migrate diff --from-migrations` fails** if an empty migration folder already exists ("Could not find the migration file"): create the folder after generating the SQL.
- The tests use the real date for the shelf report (audits are stamped `now()` by the database), not the fixed test "now".
