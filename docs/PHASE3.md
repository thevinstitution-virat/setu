# Phase 3 — GST invoicing, notes, e-invoice, exports

Branch: `feat/phase3-invoicing` (cut from `feat/phase2-catalogue`).
Plan: `docs/ROADMAP.md` §6 Phase 3. Exit check: **every dispatched order has a correct, numbered GST document that the ledger, the PDF, GSTR-1 and Tally all agree with**. This is covered by `tests/invoicing.test.ts` and by the seeded demo (see below).

## How it works

- **One table for every document.** `Invoice` + `InvoiceLine` hold tax invoices, bills of supply, credit notes and debit notes (`type`). Each document stores seller and buyer snapshots (name, GSTIN, address, state), so later profile edits never change an issued document.
- **Documents can't be changed once issued.** Database triggers (`invoice_guard`, `invoice_line_guard`) refuse UPDATE or DELETE of any financial field or line. Only the e-invoice / e-way bill fields can change, and `entryId` only while it is still empty. CHECK constraints make the amounts add up (taxable + CGST + SGST + IGST = total), keep the number to the GST limit (≤16 characters, `A–Z a–z 0–9 / -`) and require an original document for every note. A partial unique index allows at most one sale document per order.
- **Numbering.** One gap-free series per tenant, per document type, per financial year: `INV2627-00001`, `BOS…`, `CN…`, `DN…`. Prefixes are a setting. The financial year is taken in IST (`fyCode` in `src/lib/gst.ts`), and order numbers use the same function now.
- **When the invoice is issued.** By default, at dispatch (`settings.invoice.issueAt = "dispatch"`): moving an order to Out for delivery, or assigning a delivery agent, calls `onOrderDispatched`. With `"delivery"`, delivery issues it. Either way `bookSale` (`src/lib/ledger.ts`) is idempotent. It issues the document, posts the SALE entry (Dr Receivable total / Cr Sales taxable / Cr GST output) and creates the bill, numbered as the invoice, that payments are allocated to.
- **Exact amounts.** The document is built from the order lines (`orderDrafts` in `src/lib/invoice.ts`) and must equal the order's subtotal, GST and total exactly, or it is refused (409). Free goods are lines with rate 0. The delivery charge is a service line (SAC `settings.invoice.deliverySac`, default 996511) at the GST rate frozen on the order (`Order.deliveryGstRate`, new).
- **Which document, which tax.**
  - Tax invoice when the seller has a GSTIN and GST was charged. Otherwise a **bill of supply**: composition scheme, no GSTIN, or zero tax. If GST was charged but the seller has no GSTIN, issuing is refused.
  - Composition scheme: the cart quote charges no GST at all (`taxRate()` in `pricing.ts`).
  - Place of supply = the buyer's state (retailer `stateCode` ?? GSTIN prefix ?? seller state). The same state gives CGST + SGST (CGST = half of the tax rounded up, SGST = the rest, per line); another state gives IGST.
  - B2B = the buyer has a GSTIN.
- **Credit notes** (`issueCreditNote`). Kinds: `return` (quantities per line, credited pro rata), `value` (an amount per line: rate difference, damage, discount after sale) and `cancel` (everything that is left).
  - Limits are per original line: what is left of its value, tax and quantity after earlier notes. Crediting all that is left returns exactly the tax that is left, so a fully credited invoice nets to zero.
  - Credit notes are refused after 30 November following the end of the financial year (GST time limit).
  - Each note posts CREDIT_NOTE (Dr Sales, Dr GST, Cr Receivable) and a confirmed `Payment` of method CREDIT_NOTE numbered as the note, then allocates it to the retailer's oldest open bills, the same way as cash.
- **Debit notes** (`issueDebitNote`): an amount per line (short-billed). Each posts DEBIT_NOTE plus a bill of kind DEBIT_NOTE, so it shows in khata and ageing.
- **Invoiced but not yet delivered.** Once an order is invoiced at dispatch, its amount is in the receivable. Credit exposure (the order-time credit check and khata "available credit") therefore leaves undelivered orders that already have a sale document out of "open orders", so nothing is counted twice. Likewise, the delivery screen's "old dues" is the khata balance minus this order's documents.
- **Cancelling after dispatch.** `creditCancelledOrder` issues a `cancel` credit note before `onOrderCancelled` releases any wallet hold. Before dispatch there is no invoice, so nothing changes.
- **PDF** (`src/lib/invoice-pdf.ts`, pdf-lib). A4, in the tenant's brand colour. Contents:
  - Seller and buyer details, with place of supply.
  - The line table, broken across pages as needed.
  - A summary by GST rate, the amount in words and the totals.
  - What is still due, or "Paid in full".
  - A UPI QR for the amount due (when the tenant has a UPI ID and the `upiQr` setting is on).
  - Bank details and terms.
  - The e-invoice block: IRN, Ack, and the signed QR.
  - The e-way bill number.

  Fonts: Geist (SIL OFL, `assets/fonts`), which has the ₹ sign.
- **Sharing.** Every document has a share link `/i/<token>`. The token is an HMAC of the invoice id with `SESSION_SECRET`, so it can't be guessed and never expires. Anyone with the link can see that one document and its PDF without logging in; the page is noindex. The share block offers Open PDF, Download, WhatsApp (a `wa.me` link to the retailer's phone with the link in the text), the phone share sheet with the PDF file, and Copy link.
- **e-Invoice (IRN + QR).**
  - When it applies: `settings.invoice.einvoice.enabled`, the document is B2B, the seller has a GSTIN, and it is not a bill of supply. Such documents start as PENDING and are generated by the `einvoice.generate` job (pg-boss).
  - The payload is NIC schema 1.1 (`buildIrnPayload` in `src/lib/einvoice.ts`). `einvoiceProblems()` lists missing data (PIN code, HSN …) before calling the provider.
  - IRN = SHA-256 of seller GSTIN + financial year + document type + number, the official formula.
  - Notes wait until their original has an IRN (the job retries).
  - Cancel works within 24 hours, as on the portal.
  - Provider errors are stored on the document (FAILED + message) and shown with a Retry button.
  - **Only the sandbox provider exists.** It returns a test IRN, Ack and a signed QR marked `SETU-SANDBOX`, and the PDF says "E-INVOICE (TEST — SANDBOX, NOT VALID)". A real GSP or ASP is a small adapter (`EInvoiceProvider`) once the owner picks one.
- **e-Way bill.** Vehicle number and distance (1–4000 km), sandbox number and validity (1 day per 200 km, the rule for normal cargo). The detail page flags documents whose value is above the threshold (`ewayThreshold`, default ₹50,000).
- **Exports** (`GET /api/admin/exports?kind=…&from=…&to=…`, `src/lib/gst-exports.ts`, from stored documents only):
  - `gstr1`: Excel with sheets b2b, b2cl, b2cs, cdnr, cdnur, exemp, hsn(b2b), hsn(b2c), docs, in the offline tool's column layout. B2C small supplies and the HSN summaries are net of B2C notes.
  - `register`: sales register with sheets Register (one row per document), Items (one row per line) and By GST rate.
  - `tally`: Tally XML (import into Tally Prime: Import → Vouchers). It holds party ledgers (under `tally.debtorsGroup`), sales ledgers per GST rate, tax ledgers, Sales / Credit Note / Debit Note / Receipt vouchers with bill-wise allocation, all balanced. Ledger names are settings.

## Done

| Roadmap item | What shipped |
|---|---|
| 1. Numbering, tax invoice vs bill of supply, CGST+SGST vs IGST | See above. Retailer GST details (GSTIN with check digit, legal name, state) on the admin khata page. Tenant business details (legal name, GSTIN, state, address, phone) and invoice settings in Settings → GST & invoices. |
| 2. PDF, WhatsApp share, credit / debit notes | PDF for every document; share link + WhatsApp; credit notes (return / value / cancel) and debit notes with per-line limits; cancel after dispatch credits automatically. |
| 3. e-Invoice and e-way bill | NIC payload, IRN formula, queue + retries, cancel within 24 h, e-way bill, through the sandbox provider. |
| 4. Exports | GSTR-1 workbook, sales register workbook, Tally XML. |

Screens:
- **Admin:**
  - **Invoices** (new nav entry) has two tabs.
    - The list: month picker or your own dates; type and e-invoice filters; search; totals strip; cards on phones, columns on desktop.
    - **Reports**: GSTR-1, sales register and Tally downloads.
  - The invoice page has share actions plus three tools:
    - credit-note and debit-note sheets with a live estimate;
    - an e-invoice card: problems, generate / retry, cancel;
    - an e-way bill form.

    It also links to the original, the order and the khata.
  - **Settings → GST & invoices**: business details, invoice settings, Tally ledger names, and a "still missing" warning.
  - **Khata → retailer**: a GST details card.
  - **Orders**: an invoice link on each card and a search box.
- **Retailer:**
  - The order page has an Invoice card listing the invoice and its notes, with PDF.
  - **My invoices** (`/retailer/invoices`) lists them by month, each with a detail page. It is reached from Khata, Orders and the order card; there's no bottom-bar entry, because a 6th item doesn't fit on phones.
  - Khata bill numbers link to their invoices.
- **Delivery:**
  - The order page has an invoice card: PDF, share panel, e-way bill hint, notes.
  - After "Mark delivered", the agent stays on the page so they can share the invoice.
  - History rows link to the order.
- **Sales agent:**
  - The retailer page shows "Recent invoices" (last 5).
  - Each opens at `/sales/invoices/[id]`.
- **Public** `/i/[token]`:
  - Read-only document with Download PDF; no login, noindex.
  - Internal ids, settings and e-invoice errors are stripped.

Fixed on the way:
- **Password hashes reached the browser.** Several APIs (`/api/orders`, `/api/orders/[id]`, admin orders, pipeline, delivery agents, sales beat and retailer) sent the full user row, password hash included. Retailers saw the delivery agent's hash. The Prisma client now omits `User.passwordHash` everywhere (`src/lib/prisma.ts`); login opts back in. `tests/security.test.ts` checks it.
- **Invoiced-but-undelivered orders were counted twice** in credit exposure and in the delivery screen's old dues (see above).
- **Save bars were hidden on phones** under the fixed bottom nav (settings, price-list editor).

New APIs:
- `GET /api/invoices` (filters; a retailer sees only their own), `GET /api/invoices/[id]`, `GET /api/invoices/[id]/pdf`.
- `POST /api/invoices/[id]/notes`, `POST /api/invoices/[id]/einvoice` (generate | cancel), `POST /api/invoices/[id]/eway`.
- `GET /api/public/invoices/[token]` (no login).
- `GET /api/admin/exports`, `GET/PATCH /api/admin/retailers/[id]/gst`.
- `settings` takes `{ invoice, business }`.

Permissions: `invoices.view` and `invoices.manage` (notes, e-invoice, e-way bill), both admin-only. Retailers, delivery agents and sales agents see the invoices of orders they can already see (`canSeeInvoice`).

## Demo data (`npm run db:seed`)

- The demo tenant is registered in Maharashtra (test GSTIN `27ZZDEM0001A1Z…`). Agarwal and Sai Super Mart have test GSTINs (B2B), Patel is unregistered (B2C). The second tenant is in Uttar Pradesh.
- Invoices are issued at dispatch; e-invoice is on with the sandbox provider.
- The delivered demo order has a tax invoice (`INV2627-00001`, IRN generated, paid) and a credit note for one damaged unit (`CN2627-00001`, IRN generated, allocated to the opening bill).

Test GSTINs use the `ZZ` PAN letters so they can never collide with a real one, but they pass the check digit.

## Tests

- `tests/gst.test.ts` (17, pure):
  - GSTIN check digit, tax split, IST financial year, credit-note deadline, numbering, units, amount in words, settings.
  - Document lines from an order (free goods, delivery SAC, a mismatch refused).
  - GSTR-1 sections, Tally balance and unique names, the IRN formula, payload problems, share tokens.
- `tests/invoicing.test.ts` (real database):
  - Dispatch issues a B2B tax invoice equal to the order. Bill number = invoice number, and the receivable = total.
  - Idempotent across dispatch and delivery, and the "issue at delivery" setting.
  - Gap-free numbering, B2C without e-invoice, IGST for another state.
  - Credit-note return, value and cancel with their limits; the invoice nets to zero. Debit note with its bill.
  - Cancel after dispatch gives the prepaid wallet back. Composition scheme gives a bill of supply.
  - The triggers refuse edits and deletes. Sandbox IRN, stored once.
  - GSTR-1 and Tally from the stored documents, with ledger Sales = net taxable.
- `tests/invoicing.test.ts` also checks that an order invoiced at dispatch counts once in credit exposure (15 in total).
- `tests/security.test.ts` (1): no password hashes, even through nested includes.
- `tests/ledger.test.ts`: its synthetic orders now have one line, so they can be invoiced when delivered.
- Total suite: 105.

## Still open

- **A real e-invoice / e-way bill provider** (GSP or ASP, with credentials per tenant). Sandbox only for now.
- **Round-off**: totals are exact to the paisa; there is no "round off" line to the rupee.
- Retailers can't enter their own GSTIN yet (admin enters it on the khata page).
- Invoice PDFs and the share text are English only.
- Orders delivered before this phase have no invoice (their bills keep the old numbers). Their `deliveryGstRate` was backfilled from the tenant's current delivery GST setting.
- Composition dealers' GSTR-4 / CMP-08 reports, GSTR-3B summary, and e-invoice for exports / SEZ are not covered.
- Stock is still not tracked (credit-note returns don't put goods back).
- The credit-note sheet estimates from the original line amounts. No API returns what is still open per line, so the server enforces the real remainder and its message shows inline.
- The admin orders screen has no detail page: "open the order" goes to the orders list filtered by number.
- `InvoicePanel` takes an `extra` render function, which works only when its parent is a client component (Next warns otherwise).

## Traps

- **psql shows 0 rows** on tenant tables because of RLS: run `select set_config('app.bypass_rls','on',false);` first.
- The invoice check is strict: an order whose lines don't add up to its totals can't be invoiced (409). If an old order fails because the tenant changed the delivery GST since, fix `Order.deliveryGstRate` for that order.
- Issued documents can't be edited or deleted, even in psql (triggers). `npm run db:seed` truncates the tables, which works; never `DELETE` from them.
- The e-invoice job treats provider 4xx as final (stored as FAILED) and 5xx as retryable. "Original not generated yet" is a 503 on purpose.
- After `npm test`, the demo tenant has test orders that are invoiced but still show "Order placed": the tests call the dispatch code directly. Real routes always move the order to Out for delivery as well. Re-seed to clean up.
- PDF fonts are read from `assets/fonts` at runtime (`process.cwd()`); `next.config.ts` traces them for standalone builds.
- Same as before: restart `next dev` after `prisma generate`; heredocs containing an apostrophe fail in this repo's bash tool.
