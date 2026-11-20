# Phase 1 — Money: ledger, credit, payments

Branch: `feat/phase1-money` (cut from `feat/phase0-foundation`).
Plan: `docs/ROADMAP.md` §6 Phase 1. Owner decisions used: Razorpay later (no gateway yet), process rules later (every money rule is a tenant setting with a safe default).

## How the money works

- **One double-entry ledger** (`JournalEntry` + `LedgerLine`, paise, debit positive). Every money event is one entry whose lines sum to zero. A **deferred database trigger** refuses an unbalanced entry or one with fewer than two lines, even if application code is bypassed. Entries and lines are **append-only** (row-level security allows only SELECT and INSERT); mistakes are fixed with reversal entries.
- **Accounts** are created on first use: per retailer `RECEIVABLE`, `WALLET`, `WALLET_HOLD`; per staff member `STAFF_CASH`; and business accounts (`OFFICE_CASH`, `BANK`, `UPI_CLEARING`, `CHEQUES_IN_HAND`, `SALES`, `GST_OUTPUT`, `OPENING_EQUITY`, `DISCOUNT`, `PENALTY_INCOME`, `CASH_SHORTAGE`).
- **Bills** (what a retailer owes, one per delivered order, opening balance, penalty or debit note) and **payments** with **allocations** give "which bill is open" and ageing. Payments are allocated **oldest bill first**; a payment collected against an order pays that order's bill first. The ledger is the source of truth; tests check that ledger receivable = bills − confirmed payments, and that allocations match `Bill.paid`.
- All money code is in `src/lib/ledger.ts` and runs inside one transaction (`withMoney`), with a per-retailer advisory lock so two payments can't allocate at the same time.

| Event | Entry |
|---|---|
| Order delivered | Dr Receivable (total) · Cr Sales (subtotal) · Cr GST output. Bill due after the retailer's credit days. |
| Payment (cash / UPI / cheque / bank) | Dr Staff cash (collector) or Office cash · UPI received · Cheques in hand · Bank — Cr Receivable |
| Retailer reports UPI | No entry until staff verify it (`PENDING_VERIFICATION` → `CONFIRMED` / `REJECTED`) |
| Prepaid order placed | Dr Wallet · Cr Wallet (reserved). Refused (402) if the wallet is short. Released on cancel; on delivery the reservation pays the bill. |
| Cheque | Received → Deposited → Cleared (Dr Bank · Cr Cheques in hand) or Bounced (Dr Receivable · Cr Cheques in hand, payment reversed, penalty bill if set) |
| Cash handover | Dr Office cash · Cr Staff cash (counted). Short amount stays on the person until handed in or written off (Dr Cash shortages). |
| Opening balance | Dr Receivable · Cr Opening balances (owed → bill dated as-of; advance → credit used by future bills). Once per retailer. |
| Credit note / debit note / penalty | Credit note = Cr Receivable from Discounts; debit note / penalty = a new bill. |

## Done

| Roadmap item | What shipped |
|---|---|
| 1. Ledger + khata + ageing | Schema + migrations `money_ledger` and `money_ledger_security` (RLS, append-only, balance trigger, CHECK constraints). Khata per retailer with ageing 0–7 / 8–15 / 16–30 / 30+ days (IST days). |
| 2. Opening balances + carry-forward | Import type **Opening balances** on the Import screen (`phone, amount, as_of, note`; preview = exact dry run). Manual opening balance on the retailer's khata. Driver screen shows cash carried forward from earlier days. |
| 3. Payments | Cash, UPI (static QR from the tenant's UPI ID + UTR + screenshot), cheque, bank transfer, wallet, credit note; proof photo; note; part payments; FIFO allocation. Duplicate UTRs refused. |
| 4. Today's COD vs old dues | Delivery screen shows this order, old dues and total due; agent can collect any amount. |
| 5. Credit control | Per-retailer mode/limit/days (blank = tenant default). New orders over the limit or with overdue bills go on **credit hold** with the reason; held orders can't advance, be assigned or delivered until someone with `credit.manage` approves. |
| 6. Prepaid wallet | Recharge (staff or retailer-reported), reserve on order, release on cancel, settle on delivery. |
| 7. Staff cash + handover | Cash in hand per staff member, handover with expected/counted/variance, write-off. |
| 8. Cheques | Full lifecycle; bounce reverses the payment and adds the configurable bounce charge. |
| 9. Retailer screens | Khata (balance, wallet, credit left, overdue, bills with age, payments with state), Pay now (UPI QR / tap-to-pay + report UTR), statement with date range and print-to-PDF. |
| Exit check | `GET /api/admin/daybook?date=` — opening outstanding + movements = closing outstanding, with collections by method (`reconciles: true`). |

Permissions added: `payments.collect` (sales + delivery agents), `payments.report` (retailers), `payments.verify`, `ledger.view`, `ledger.adjust`, `credit.manage`, `cash.handover`, `cheques.manage`, `settings.manage` (admin). Sales agents see the khata of retailers on their book only; delivery agents see dues of retailers they deliver to.

Money settings (`Tenant.settings.money`, Admin → Settings): default payment mode, credit days, credit limit, hold on overdue + grace days, cheque bounce charge, UPI ID + payee name.

Delivery changes: an order can no longer be moved to Delivered from the status button — only through delivery (so it is always billed). Office staff can deliver a counter pickup themselves (cash goes to office cash). A delivery agent can only be assigned if they exist in this tenant (foreign keys are not filtered by row-level security).

Tests: `tests/ledger.test.ts` (19, real database): balance trigger, append-only, cross-tenant, FIFO, order-first allocation, advances, verify, reversal, opening balance, cheque clear/bounce + penalty, wallet reserve/refuse/release/settle, credit limit + overdue holds, cash handover + write-off, IST ageing, balance import validation. Total suite 46.

Seed: demo tenant has money data posted through the real engine (Agarwal: overdue opening balance, a delivered order paid in cash to the driver, a cheque in hand, a UPI payment waiting for verification; Patel: prepaid wallet with an order holding ₹1,254.75).

## Still open

- Editable allocation (choose which bill a payment pays); today FIFO only.
- Razorpay (dynamic QR, payment links, webhook auto-verification) — needs keys; the verify step is where it plugs in.
- Payment and overdue notifications (WhatsApp/SMS) — events are not emitted for payments yet; Phase 3 notifications.
- GST tax invoice PDF and e-invoice (owner decision 4) — bills carry order numbers only.
- Day book screen (API done); receivables ageing export beyond CSV.
- Hindi copy on the new screens (English only, like the other inner pages).

## Traps

- After `prisma generate` (new models), **restart `next dev`**: the dev server keeps the old Prisma client on `globalThis` and new models are `undefined` (`Cannot read properties of undefined (reading 'findMany')`).
- `prisma migrate dev --create-only` then applying separately: append hand-written SQL (RLS, triggers) **before** applying, or it needs a second migration (as happened here: `money_ledger_security`).
- Ledger rows can't be deleted, so tests create fresh retailers each run; `npm run db:seed` (TRUNCATE) resets everything.
- New page folders created while `next dev` runs can get **no Tailwind classes** (e.g. `md:table` missing, so tables vanish) even after a restart — Turbopack's cache under `.next` keeps the old CSS. Stop dev, `rm -rf .next`, start again. Production builds are not affected.
- Re-seeding while `next dev` runs: tenant lookups are cached 60 s, so logins fail with 401 for up to a minute (the old tenant id). Wait or restart.
