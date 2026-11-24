# Full accounts — plan (A1–A6)

Written 24 Nov 2026. Status: **plan only, nothing built.**

## 1. Why

VBiz Pro keeps a real double-entry ledger, but only for the **selling side**:
- sales bills, credit and debit notes, GST output;
- each shop's khata, payments by every method, cheques;
- staff cash and handover, bank-statement matching for money coming in;
- gateway settlements.

A check on 24 Nov found the books exact: every entry balances, and each shop's ledger equals its open bills minus advances, to the paisa.

What a distributor's accountant also needs is **not in the app**. Today it has to be done in separate accounting software, fed by our Tally export:

| Missing | What happens today |
|---|---|
| Purchase bills from companies, with GST input credit | Goods received (GRN) only moves stock, and only when stock tracking is on. Nothing is posted to the ledger. |
| What we owe each supplier, and paying them | No supplier ledger, no payables, no supplier payments. |
| Expenses (rent, salaries, fuel, freight), other income, cash ↔ bank transfers, journal entries | No vouchers. Bank matching ignores money going out. |
| Day book, cash book, bank book, trial balance, profit and loss, balance sheet | None. |
| GSTR-3B, input credit register, matching with GSTR-2B, TDS | None. Only GSTR-1 (sales) exists. |
| More than one bank account (current account, OD/CC) | One `BANK` account. |
| Locking past periods | Any date can still be posted. |

The goal is to make the app a business's **complete books**, while keeping the Tally export so an accountant who prefers Tally can keep it.

## 2. Principles

1. **One ledger.** Everything posts through the existing `post()` in `src/lib/ledger.ts`:
   - `JournalEntry` + `LedgerLine`, paise, debit positive;
   - every entry balances, or it is refused.
   - No second accounting store.
2. **Documents first, entries from documents.** A purchase bill, a voucher or a supplier payment is a document with its own number. Its journal entry is created from it in the same transaction, exactly as `bookSale` does for sales.
3. **Never edit, reverse.** A wrong document is cancelled with `reverseEntry()` and entered again. The ledger stays append-only and auditable.
4. **Books lock.** A business-level "books closed up to" date. `post()` refuses any `occurredAt` on or before it. Only the owner can move it back, and that is audited.
5. **Same patterns as the selling side.** Supplier bills mirror shop bills:
   - allocate payments oldest first;
   - bill-wise ageing;
   - a statement per party;
   - opening bills imported bill by bill.
6. **Generic.** Nothing specific to one client or one old software package. Old-software names stay out of the app.
7. **Tally stays an option.** Each phase extends the Tally XML export with its own voucher types: Purchase, Debit Note (to supplier), Payment, Receipt, Contra, Journal.

## 3. Chart of accounts

Today `AccountType` is a fixed enum. Two additions turn it into a proper chart.

**a) Groups.** Every account belongs to a group. This drives the trial balance, profit and loss, and balance sheet.

| Group | Side | Built-in accounts (existing → group) | Business's own heads (new) |
|---|---|---|---|
| Capital | Liability | `OPENING_EQUITY` | Owner's capital, partners' capital |
| Drawings | Liability (minus) | — | Owner's drawings |
| Loans | Liability | — | Bank loan, OD / CC account, loans from people |
| Current liabilities | Liability | `WALLET`, `WALLET_HOLD` (shop money we hold) | — |
| Sundry creditors | Liability | **new** `PAYABLE` per supplier | — |
| Duties and taxes | Liability / asset | `GST_OUTPUT`, **new** `GST_INPUT`, **new** `TDS_PAYABLE` | Professional tax, etc. |
| Fixed assets | Asset | — | Vehicles, computers, furniture |
| Sundry debtors | Asset | `RECEIVABLE` per shop | — |
| Cash | Asset | `OFFICE_CASH`, `STAFF_CASH` per person | — |
| Bank | Asset | `BANK` (becomes the first bank account) | More bank accounts (new `BankAccount`) |
| Money in transit | Asset | `UPI_CLEARING`, `CHEQUES_IN_HAND`, `GATEWAY_CLEARING` | — |
| Stock | Asset | — (periodic, see §5) | — |
| Sales | Income | `SALES` | — |
| Purchases | Expense | **new** `PURCHASES`, **new** `PURCHASE_RETURNS` (minus) | — |
| Direct expenses | Expense | — | Freight in, loading, unloading |
| Indirect expenses | Expense | `DISCOUNT`, `CASH_SHORTAGE`, `PROMOTIONS`, `GATEWAY_FEES` | Rent, salaries, fuel, electricity, phone |
| Other income | Income | `PENALTY_INCOME` | Company claims received, interest, scheme income |
| Rounding | Expense / income | **new** `ROUND_OFF` | — |

**b) Ledger heads.** A new model `LedgerHead {id, name, group, active, tallyName}` holds the business's own accounts (rent, salaries, vehicle, bank loan…), with a new account type `HEAD` and code `HEAD:<id>`, the same way `STAFF_CASH:<userId>` works today. A starter list is created per business and can be edited.

**c) Bank accounts.** A new model `BankAccount {id, name, kind (CURRENT | SAVINGS | OD | CC), last4, ifsc, active}`.
- The existing `BANK` account becomes the default bank account; old entries stay valid.
- New ones are `BANK:<id>`.
- `BankStatement` gains `bankAccountId`, so each statement is matched against its own bank.

## 4. Phases

Each phase is built in VBiz Pro first, then brought into every client copy. It ships with:
- a migration;
- tests against the real database (the books must still balance, see §7);
- its Tally vouchers;
- a browser check.

Sizes are relative: S = small, M = medium, L = large.

### A1 — Chart of accounts and the books' backbone (M)

- Groups for every built-in account, `LedgerHead`, account type `HEAD`, `BankAccount` (with the existing `BANK` as the default).
- **Books lock:** a "books closed up to" setting, checked in `post()`.
- **Ledger of any account:** opening balance, every entry with its document link, running balance, closing balance, for any date range. Download as PDF and CSV.
- **Day book:** every entry of a day or range, grouped by voucher type.
- Permissions: `accounts.view`, `accounts.post`, `accounts.lock`.
- A new **Accountant** staff role: accounts, purchases, invoices, bank, reports. No orders, delivery or team.
- Exit check: the trial balance (computed raw at this stage) of every test business sums to zero, and the lock refuses back-dated posts.

### A2 — Purchase bills and the supplier ledger (L)

- **Supplier kinds:** `Supplier` gains `kind` = GOODS (principal companies, the "company" of company-wise outstanding) | SERVICES (transporter, landlord, phone) | OTHER. The company-wise report and product pickers only show GOODS.
- **Purchase bill:** a new `PurchaseBill` with lines.
  - Fields: supplier, its bill number and date, our own number (PB2627-00001), place of supply, due date (from the supplier's credit days), reverse-charge flag.
  - Each line has a product *or* a ledger head, quantity, rate, discount, taxable value, GST rate, CGST/SGST/IGST (IGST when the supplier's state ≠ ours), and an eligible-for-input-credit flag.
  - The bill also has a round-off and a total.
  - Posting: Dr `PURCHASES` (product lines) or the head (expense lines) with the taxable value; Dr `GST_INPUT` with the eligible tax (ineligible tax goes into the cost); Cr `PAYABLE:<supplier>` with the total; round-off to `ROUND_OFF`.
  - Matching paise rules to the sales side: line tax rounding, and GST-inclusive rates when the supplier's bill shows them.
- **Link to stock:** when stock tracking is on, a GRN can be turned into a bill (lines and costs filled in), or saving a bill can receive the goods. Each GRN is billed once. When stock tracking is off, bills work on their own.
- **Supplier debit notes / purchase returns:** a return of goods or a rate difference. Dr `PAYABLE`, Cr `PURCHASE_RETURNS` and Cr `GST_INPUT`; stock goes out when tracking is on.
- **Supplier credit notes:** a scheme, claim or rate difference given by the company. Dr `PAYABLE`, Cr the chosen head (e.g. "Company claims"), plus GST when the note carries it.
- **Supplier bill-wise ledger:** a `SupplierBill` mirrors `Bill`, and `SupplierAllocation` mirrors `PaymentAllocation`.
- **Supplier statement:** like the shop khata, with PDF.
- **Import:** suppliers with GSTIN, state and credit days; open supplier bills bill by bill (opening payables); purchase bills from a CSV.
- Exit check: purchase register totals = ledger `PURCHASES` + `GST_INPUT` + `PAYABLE` movements; each supplier's `PAYABLE` = its open bills minus unused advances.

### A3 — Paying suppliers and the bank's money going out (M)

- **Supplier payment:** pay from a bank account, office cash, or a cheque we issue (with cheque number and date, and its own clear/bounce like incoming cheques).
  - Allocated oldest-first, or to chosen bills.
  - Money paid ahead is an advance to that supplier.
  - Posting: Dr `PAYABLE`, Cr bank or cash.
- **Bank matching for money going out:** debit lines of the statement are suggested against supplier payments, cheques we issued, expense vouchers and transfers. They can also be turned into a new supplier payment or expense on the spot.
- **Payables reports** (same toolbar as the outstanding reports: as on, filters, PDF, CSV, WhatsApp):
  - supplier-wise payables;
  - bill-wise payables with ageing;
  - what falls due this week;
  - payments made in a period.
- **Company claims tracker:** claims raised on principal companies (scheme reimbursement, damages, rate difference) and their settlement by credit note or payment. This is optional, and depends on the owner's answer to question A3.

### A4 — Vouchers: expenses, receipts, contra and journal (M)

- **Payment voucher (expense):** Dr a head (rent, salaries, fuel…), Cr cash or a bank account; optional GST input credit with the vendor's GSTIN; a photo of the slip.
- **Receipt voucher:** money that is not from a shop. Dr cash or bank, Cr a head: capital brought in, a loan taken, interest, other income.
- **Contra:** cash deposited to the bank, cash withdrawn, bank to bank. Today a cash deposit is matched from the bank statement; it becomes a proper contra.
- **Journal:** any balanced lines between heads, for the accountant only, with a reason. Uses: depreciation, provisions, corrections.
- **Staff expenses at handover:** a driver or salesman spends from collected cash (fuel, toll, loading). At handover, the counted cash plus expense slips (with photos) are accepted. Dr the expense head, Cr `STAFF_CASH`, so cash short is only the real shortage.
- **Cash book and bank book:** per cash or bank account, with the running balance and a daily total.
- Voucher numbers per type per financial year (PV, RV, CV, JV).

### A5 — Final accounts (L)

- **Trial balance** as on a date, by group, with drill-down to the account ledger.
- **Profit and loss** for a period, periodic method (see §5): sales minus returns, minus (opening stock + purchases − purchase returns − closing stock), minus direct expenses = gross profit; minus indirect expenses, plus other income = net profit. Compared with the same period last year.
- **Balance sheet** as on a date. Net profit to date goes under capital; it must balance, or the report says by how much and why.
- **Opening the books:** import an opening trial balance (heads, bank, cash, capital, loans, fixed assets, opening stock value). The differences land in `OPENING_EQUITY` and must come to zero.
- **Year end:** lock the books up to 31 March. The new year's profit and loss starts at zero; the balance sheet carries forward. No closing entries are needed, because profit and loss is always computed for a date range.
- PDF of all three, in the formats an accountant expects.

### A6 — GST and TDS on the buying side (L)

- **Purchase register** and an **input credit register** (by GST rate, by supplier, by month).
- **GSTR-3B working:** outward supplies from our invoices and notes (the same data as GSTR-1); input credit from purchase bills and supplier notes; reverse charge; the net payable per head (IGST, CGST, SGST, cess).
- **GST set-off and payment voucher:** set input credit against output tax by the legal order, and pay the rest from the bank (challan number).
- **GSTR-2B match:**
  - import the 2B file from the GST portal;
  - match on supplier GSTIN + bill number + amount;
  - show bills missing in 2B (input credit at risk), bills in 2B missing in our books, and amount differences.
- **Reverse charge:** for example transport bills from a GTA. Self-invoice and the tax liability plus input credit.
- **TDS:**
  - TDS payable on payments (194C contractors, 194Q purchase of goods above the yearly limit, 194I rent, 194J professionals), deducted on the bill or the payment;
  - a TDS register;
  - a payment voucher with the challan.
  - TDS deducted *by* a big customer from our receipts (194Q on their side) is recorded as `TDS_RECEIVABLE` on the receipt.
- Tally export: purchase, payment, journal and GST vouchers.

## 5. Stock in the accounts

The **periodic method** is common practice for Indian distributors and is what Tally does by default:
- Purchases are an expense in the period.
- Profit and loss uses opening stock and closing stock *values*.
- No cost is posted with each sale, so the sales code stays as it is.

Closing stock value for a date:
- **Stock tracking on, with costs entered:** the lots on hand at their cost (`StockLot.qty × unitCost`, FIFO by lot). Lots with no cost use the product's last cost, and the report lists them.
- **Stock tracking off:** the value is entered by hand for the period end (from a physical count), and stored with the date and the person who entered it.

The balance sheet shows the closing stock as an asset as on its date. A later version can post cost of goods sold with each sale (perpetual method); the plan doesn't need it.

## 6. Data model (summary)

| New / changed | Purpose |
|---|---|
| `AccountType` + `PAYABLE`, `PURCHASES`, `PURCHASE_RETURNS`, `GST_INPUT`, `TDS_PAYABLE`, `TDS_RECEIVABLE`, `ROUND_OFF`, `HEAD` | New built-in accounts; `HEAD` for the business's own heads |
| `AccountGroup` enum + `group` on `LedgerAccount` (back-filled) | Trial balance, P&L, balance sheet |
| `LedgerHead` | The business's own accounts |
| `BankAccount`; `BankStatement.bankAccountId` | Several banks, OD/CC |
| `Supplier.kind`, `state`, `creditDays`, `openingBalance` | Creditors of every kind |
| `PurchaseBill`, `PurchaseBillLine` | Supplier bills with GST |
| `SupplierNote` (+ lines) | Debit notes to and credit notes from suppliers |
| `SupplierBill`, `SupplierPayment`, `SupplierAllocation`, `IssuedCheque` | Payables bill-wise, paying, cheques we write |
| `Voucher`, `VoucherLine` (`PAYMENT`, `RECEIPT`, `CONTRA`, `JOURNAL`) | Expenses and every other entry |
| `EntryKind` + `PURCHASE`, `SUPPLIER_NOTE`, `SUPPLIER_PAYMENT`, `VOUCHER`, `GST_SETOFF` | Day book by voucher type |
| `StockValuation` | Closing stock entered by hand |
| `Gstr2bImport`, `Gstr2bLine` | 2B matching |
| Setting `booksLockedUntil` | Books lock |
| `Role.ACCOUNTANT` + permissions `accounts.*`, `purchases.manage`, `payables.pay` | The accountant's access |

All new tables follow the existing pattern: `tenantId` default from `app.tenant_id`, RLS enabled and forced, the `tenant_isolation` policy.

## 7. How we'll know it's right

- **Books-balance check** as a test, run after every money test file, and as an admin "Check my books" button. It covers:
  1. every entry balances;
  2. every business's ledger sums to zero;
  3. no line crosses businesses;
  4. no entry has a single line;
  5. bills and supplier bills have paid amounts in range and the right settled flag;
  6. payment allocations add up;
  7. no unconfirmed money is allocated;
  8. each shop's receivable = its open bills − its advances;
  9. each supplier's payable = its open bills − its advances;
  10. the trial balance sums to zero;
  11. the balance sheet balances.

  Checks 1–8 are the ones that passed on 24 Nov.
- **Cross-checks:**
  - purchase register = ledger;
  - GSTR-3B input credit = the `GST_INPUT` movement;
  - cash book closing = the cash account balance;
  - bank book closing = the bank statement's closing balance after matching.
- A worked month for a sample business in a test: known purchases, sales, expenses and closing stock, with the expected P&L and balance sheet figures to the paisa.

## 8. Order, and what can ship early

1. **A1 → A2 → A3** give a business payables and purchases with input credit. Together with the existing selling side and the Tally export, an accountant can already close the books in Tally with almost no typing. This is the most useful first stop.
2. **A4** removes the last manual entries (expenses, contra).
3. **A5** makes Tally optional.
4. **A6** gives the GST and TDS filing workings.

## 9. Questions for the owner

| # | Question | Why it matters |
|---|---|---|
| A1 | Keep separate accounting software for final accounts for now, or move fully into the app? | If it stays, A1–A3 and the Tally export come first and A5 can wait. |
| A2 | How many bank accounts, and any OD/CC limits? | Bank accounts and loan heads at set-up. |
| A3 | Do businesses track claims on principal companies (schemes, damages, rate difference)? | Decides whether the claims tracker is in A3. |
| A4 | Turnover above ₹10 crore (194Q TDS on purchases), and which other TDS sections are deducted? | Scope of the TDS work in A6. |
| A5 | Closing stock: from tracked stock at cost, or a physical count entered by hand? | §5. |
| A6 | Switch-over date: 1 April, or mid-year with an opening trial balance? | Opening the books in A5, and how much history to import. |
| A7 | Who will use it: the owner, an in-house accountant, or an outside CA (Chartered Accountant) who needs read-only access? | The Accountant role and a read-only "CA" access. |

## 10. Risks

- **Two sources of truth during the switch-over.** If the old software keeps running for purchases while the app does sales, the books split. Switch everything on one date, after an opening trial balance.
- **GST correctness.** Input-credit eligibility, reverse charge and TDS have legal rules. The defaults must be checked by a CA before a business files from these workings.
- **Size.** This is about as big as Phases 1, 3 and 5 together. It needs its own careful tests, because errors in accounts are costly.
