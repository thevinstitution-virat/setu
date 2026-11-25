# Full accounts — plan v2 (A1–A10)

v1 was written 24 Nov 2026. v2 (same day) adds the owner's decisions and breaks every phase into steps.

**Goal: one app for everything.** Billing, stock, collections, purchases, payables, claims on companies, expenses, GST, TDS and final accounts, all in VBiz Pro. A business needs no separate billing or accounting software. The Tally export stays only as an optional hand-over for a CA who asks for it.

## 1. Where we start

The app already keeps a real double-entry ledger for the **selling side**:
- sales bills, credit and debit notes, GST output;
- each shop's khata, payments by every method, cheques;
- staff cash and handover;
- bank-statement matching for money coming in;
- gateway settlements.

A check on 24 Nov found it exact: every entry balances, and each shop's ledger equals its open bills minus advances, to the paisa.

Missing:
- purchase bills;
- payables and paying suppliers;
- claims on companies;
- expenses and vouchers;
- more than one bank;
- stock valuation;
- trial balance, P&L and balance sheet;
- the buying side of GST, and TDS;
- locked periods.

Goods received (GRN) only moves stock and posts nothing. Bank matching ignores money going out.

## 2. Owner's decisions (24 Nov 2026)

| # | Question | Decision |
|---|---|---|
| A1 | Keep separate accounting software? | **No.** One app for everything; final accounts are in scope. |
| A2 | Bank accounts | The admin adds **any number** of bank accounts (current, savings, OD, CC). |
| A3 | Claims on companies | **Yes:** schemes, damages, rate difference. |
| A4 | TDS | **Yes:** provision for TDS. |
| A5 | Closing stock | **Both:** tracked stock at cost, *and* a physical count entered by hand for accuracy. |
| A6 | Periods | **Financial year** (April–March): numbering, reports, year end. |
| A7 | Who uses it | The **owner views**, the **accountant** does the accounting, and **reports for the CA** are generated when needed. The CA gets no login. |

## 3. Principles

1. **One ledger.** Everything posts through `post()` in `src/lib/ledger.ts` (`JournalEntry` + `LedgerLine`, paise, debit positive). Every entry balances, or it is refused.
2. **Documents first.** A purchase bill, voucher, claim or supplier payment is a numbered document. Its journal entry is made from it in the same transaction, as `bookSale` does for sales.
3. **Never edit, reverse.** A wrong document is cancelled with a reversal and entered again.
4. **Financial year and books lock.**
   - Numbers run per FY (PB2627-00001…), like invoices today.
   - A "books closed up to" date: `post()` refuses an earlier date.
   - Only the owner can move it back, and that is audited.
5. **Same patterns as the selling side.** Suppliers mirror shops: bill-wise ledger, oldest-first allocation, ageing, statement, import of open bills.
6. **Generic.** Nothing specific to one client, and no old-software names in the app.
7. **Every phase proves the books still balance** (§7), with tests against the real database.

## 4. Roles

| Who | Access |
|---|---|
| Owner (ADMIN) | Everything, as today. The new **Books** pages are view-first: entries are made by the accountant, but the owner may also make them. Only the owner moves the books lock back. |
| **Accountant** (new role) | The accounts area: chart of accounts, banks, purchases, suppliers, payments, claims, vouchers, stock valuation, GST, TDS, final accounts, CA reports. Also invoices and notes, the bank statement, the shops' khata, and reports. No orders, delivery, team or settings outside accounts. |
| CA (outside) | No login. The accountant or the owner makes a **CA pack** for any period (§A7.5). |

New permissions:
- `accounts.view`: see the books.
- `accounts.post`: vouchers, journal.
- `accounts.setup`: chart of accounts, banks, TDS sections, opening balances.
- `accounts.lock`: the books lock, owner only.
- `purchases.manage`: purchase bills, supplier notes.
- `payables.pay`: pay suppliers.
- `claims.manage`: claims on companies.

## 5. Chart of accounts

Every account belongs to a **group**, which decides where it shows in the trial balance, P&L and balance sheet.

| Group | Nature | Built-in accounts | Business's own heads (examples) |
|---|---|---|---|
| CAPITAL | Liability | `OPENING_EQUITY` (balances brought in) | Owner's capital, partners' capital |
| DRAWINGS | Liability, minus | — | Owner's drawings |
| LOANS | Liability | — | Bank loan, loans from people (OD/CC sit under bank accounts) |
| CURRENT_LIABILITIES | Liability | `WALLET`, `WALLET_HOLD` | Salaries payable, provisions |
| CREDITORS | Liability | `PAYABLE` per supplier | — |
| DUTIES_TAXES | Liability / asset | `GST_OUTPUT`, `GST_INPUT`, `TDS_PAYABLE`, `TDS_RECEIVABLE` | Professional tax |
| FIXED_ASSETS | Asset | — | Vehicles, computers, furniture |
| DEBTORS | Asset | `RECEIVABLE` per shop | — |
| CLAIMS | Asset | `CLAIMS_RECEIVABLE` per supplier | — |
| CASH | Asset | `OFFICE_CASH`, `STAFF_CASH` per person | Petty cash |
| BANK | Asset (OD/CC can go negative) | `BANK` (default bank) + `BANK:<id>` per bank account | — |
| IN_TRANSIT | Asset | `UPI_CLEARING`, `CHEQUES_IN_HAND`, `GATEWAY_CLEARING`, `ISSUED_CHEQUES` | — |
| CURRENT_ASSETS | Asset | — | Deposits, advances to staff |
| SALES | Income | `SALES` | — |
| PURCHASES | Expense | `PURCHASES`, `PURCHASE_RETURNS` (minus) | — |
| DIRECT_EXPENSES | Expense | — | Freight in, loading, unloading |
| INDIRECT_EXPENSES | Expense | `DISCOUNT`, `CASH_SHORTAGE`, `PROMOTIONS`, `GATEWAY_FEES`, `ROUND_OFF`, `STOCK_LOSS` | Rent, salaries, fuel, electricity, phone |
| OTHER_INCOME | Income | `PENALTY_INCOME`, `CLAIM_INCOME` | Interest, display income |

Each business gets a **starter list of heads** (rent, salaries, fuel, vehicle repairs, electricity, phone, office expenses, freight in, loading, bank charges, interest paid, interest received, capital, drawings, furniture, vehicles, computers, petty cash). It can add, rename or hide heads freely. Built-in accounts can't be deleted. A head with entries can only be hidden.

## 6. Phases and steps

Each step is one commit: VBiz Pro first, then every client copy. A phase is done when its tests pass, the books check (§7) is clean, the build passes and it has been seen in the browser.

### A1 — Backbone: chart of accounts, banks, financial year, accountant (M)

- **A1.1 Schema.**
  - `AccountGroup` enum; `group` on `LedgerAccount`, back-filled for existing accounts.
  - `LedgerHead {name, group, active, code}`; account type `HEAD`, code `HEAD:<id>`.
  - `BankAccount {name, kind CURRENT | SAVINGS | OD | CC, bank, last4, ifsc, branch, odLimit, active, isDefault}`. The existing `BANK` account becomes "Main bank", the default.
  - `BankStatement.bankAccountId`.
  - Tenant setting `booksLockedUntil`.
  - New `AccountType` values used by later phases are added now: `PAYABLE`, `PURCHASES`, `PURCHASE_RETURNS`, `GST_INPUT`, `TDS_PAYABLE`, `TDS_RECEIVABLE`, `CLAIMS_RECEIVABLE`, `CLAIM_INCOME`, `ROUND_OFF`, `STOCK_LOSS`, `ISSUED_CHEQUES`.
- **A1.2 Posting rules.**
  - `post()` refuses dates on or before the books lock, and any account of a hidden head or inactive bank.
  - Account references for heads and bank accounts; group set when an account is created.
  - Today's "Bank" choices (cheque deposit, bank payment, statement match) use the default bank account, or the one picked.
- **A1.3 Accountant role** and the permissions in §4. Staff can be added as Accountant. The accountant's menu shows the Books area; the owner's menu gains it too.
- **A1.4 Books → Set-up.**
  - Chart of accounts: groups → accounts and heads, with balances.
  - Add / rename / hide heads.
  - Bank accounts: add any number, edit, set the default, hide.
  - The starter heads are created on first open.
  - Books lock: owner only, audited.
- **A1.5 Books → Ledger and Day book.**
  - Ledger of any account for a period: opening balance, entries with a link to their document, running balance, closing balance.
  - Day book: entries of a day or range by voucher type, with totals.
  - PDF and CSV for both, in the same style as the outstanding reports.
- **A1.6 Books check.** The §7 checks as a library, a test run in every money test file, and a "Check my books" button with a plain-language result.

### A2 — Purchases and suppliers (L)

- **A2.1 Suppliers as creditors.**
  - `Supplier` gains `kind` GOODS | SERVICES | OTHER, `state`, `pan`, `creditDays`, bank details, and a TDS section (A9).
  - Company-wise outstanding and product pickers use GOODS only.
  - Supplier list and page.
- **A2.2 Purchase bill.**
  - `PurchaseBill` + lines. Bill fields: supplier, their bill number and date (unique per supplier), our number PB<FY>-n, place of supply, due date, reverse-charge flag. Lines: product *or* head, quantity, free quantity, rate (with or without GST), discount %, taxable value, GST rate, CGST/SGST/IGST, input credit eligible. Then round-off and total.
  - Posting: Dr `PURCHASES` / head (taxable), Dr `GST_INPUT` (eligible tax; ineligible tax goes into the cost), Cr `PAYABLE:<supplier>` (total), round-off to `ROUND_OFF`.
  - Paise rules shared with sales.
- **A2.3 Stock link.**
  - Stock tracking on: a bill can be made from a GRN (lines and costs filled in), or saving a bill receives the goods.
  - Each GRN is billed once, and the lots' cost is updated from the bill.
  - Stock tracking off: bills work on their own.
- **A2.4 Supplier notes.**
  - Debit note to a supplier (goods returned, short or damaged received, rate charged too high): Dr `PAYABLE`, Cr `PURCHASE_RETURNS` + `GST_INPUT`; stock out when tracking is on.
  - Credit note from a supplier (scheme, claim settlement, rate difference): Dr `PAYABLE`, Cr `CLAIMS_RECEIVABLE` (against a claim, A4) or a head, plus GST if the note carries it.
- **A2.5 Supplier ledger.**
  - `SupplierBill` (open amount per bill) + allocations.
  - Supplier statement (PDF, like the khata); purchase register (period, supplier, GST rate; PDF, CSV).
- **A2.6 Imports.** Suppliers; open supplier bills (opening payables, bill by bill); purchase bills from CSV.

### A3 — Paying suppliers (M)

- **A3.1 Supplier payment.**
  - Pay from any bank account, office cash, or a cheque we issue (number, date, bank).
  - Allocated oldest-first, or to chosen bills; paid ahead = an advance.
  - TDS deducted at payment when the section applies (A9).
  - Posting: Dr `PAYABLE`, Cr bank / cash / `ISSUED_CHEQUES`, Cr `TDS_PAYABLE`.
- **A3.2 Issued cheques.** Cheque register; cleared (Dr `ISSUED_CHEQUES`, Cr bank) or bounced/cancelled (reversed, bills open again).
- **A3.3 Bank matching for money going out.** Statement debit lines are suggested against supplier payments, issued cheques, vouchers and transfers. A debit line can also become a new supplier payment or expense on the spot. Each statement belongs to one bank account.
- **A3.4 Payables reports** (same toolbar as outstanding: as on, filters, PDF, CSV, WhatsApp):
  - supplier-wise;
  - bill-wise with ageing;
  - falling due this week;
  - payments made in a period.

### A4 — Claims on companies (M)

- **A4.1 Claim document.**
  - `Claim`: company (GOODS supplier), type SCHEME | DAMAGE | RATE_DIFF | OTHER, period, lines (what, quantity, rate, amount, evidence), number CL<FY>-n, status RAISED → PART_SETTLED → SETTLED / REJECTED / WRITTEN_OFF.
  - Raising posts Dr `CLAIMS_RECEIVABLE:<supplier>`, Cr `CLAIM_INCOME`.
- **A4.2 Claim basis from the app's own data:**
  - **Schemes:** free goods and scheme discounts given to shops on that company's products in the period, at cost or as the scheme says.
  - **Damages:** returns received as damaged or expired, and stock written off as damaged, for that company's products.
  - **Rate difference:** stock on hand on the day a company cuts its rate × the difference, entered with the rate change. The app pre-fills lines; the accountant edits them before raising.
- **A4.3 Settlement.** By a supplier credit note (A2.4) or a payment received from the company (Dr bank, Cr `CLAIMS_RECEIVABLE`). Part settlement allowed; the shortfall is written off (Dr `CLAIM_INCOME`, Cr `CLAIMS_RECEIVABLE`) with a reason.
- **A4.4 Claims reports.** Pending by company and age, settled in a period, and claimed vs received by type. Claim letter PDF to send to the company.

### A5 — Vouchers and expenses (M)

- **A5.1 Payment voucher (expense):** Dr a head, Cr cash or bank. Optional vendor with GSTIN (input credit), TDS (A9), photo of the slip.
- **A5.2 Receipt voucher:** money that is not from a shop (capital, loan, interest, scrap sale). Dr cash or bank, Cr head.
- **A5.3 Contra:** cash → bank, bank → cash, bank → bank. A cash deposit found in the statement becomes a contra.
- **A5.4 Journal:** any balanced lines, accountant or owner only, with a reason (depreciation, provisions, corrections).
- **A5.5 Staff expenses at handover:** fuel, toll or loading paid from collected cash, with slip photos. Dr head, Cr `STAFF_CASH`, so "short" is only the real shortage.
- **A5.6 Cash book and bank book** per account, with running balance and daily totals; bank book with matched / unmatched marks.
- Numbers per type per FY: PV, RV, CV, JV.

### A6 — Stock valuation and physical count (M)

- **A6.1 Book stock value** as on any date: tracked lots × cost (FIFO by lot). Lots without cost use the product's last cost, and are listed. By company, category and place.
- **A6.2 Physical count.**
  - A count sheet per place and date (all products, or one company / category), printable and fillable on the phone.
  - Counted quantity per product (and batch, when tracked).
  - The app shows book vs counted, the difference and its value.
- **A6.3 Accepting a count:**
  - Stock is adjusted to the counted quantity (existing stock adjustment, reason "physical count").
  - The value difference posts to `STOCK_LOSS` (shortage) or back as excess.
  - The accepted count is the **closing stock** for its date.
- **A6.4 Stock tracking off:** the count is entered as quantities with rates, or as a total value per company. The accepted value is the closing stock.
- **A6.5 Closing stock for P&L:** the latest accepted count on or before the period end. If there is none, the book value, with a warning that it is not counted.

### A7 — Final accounts and the CA (L)

- **A7.1 Trial balance** as on a date, by group, with drill-down to the ledger. Opening, debit, credit and closing columns for a period.
- **A7.2 Profit and loss** for a period:
  - Sales − returns − (opening stock + purchases − purchase returns − closing stock) − direct expenses = gross profit.
  - Then − indirect expenses + other income = net profit.
  - Month-wise and compared with the last year.
- **A7.3 Balance sheet** as on a date. Profit for the year sits under capital. If it does not balance, the report says by how much and lists the checks that fail.
- **A7.4 Opening the books.**
  - An opening trial balance as on the switch date: all heads, banks, cash, capital, loans, fixed assets. Opening stock comes from a count.
  - Shops and suppliers are imported bill by bill, and their totals must equal the debtors and creditors lines.
  - A mid-year switch includes the income and expense heads' year-to-date balances, so that year's P&L is complete.
  - Any difference goes to `OPENING_EQUITY`, and must be zero to finish.
- **A7.5 CA pack:** one download for any period (an FY by default), as a zip of PDFs + Excel:
  - trial balance, P&L, balance sheet;
  - every ledger;
  - day book, cash and bank books;
  - sales and purchase registers;
  - debtors and creditors lists;
  - claims, stock valuation and count, GST working, TDS register.

  The Tally XML of the same period is optional.
- **A7.6 Year end:**
  - Lock up to 31 March.
  - New FY numbering starts.
  - The new year's P&L starts at zero; the balance sheet carries forward. No closing entries are needed.
  - The closing stock count becomes the next year's opening stock.
- **A7.7 Owner's Books dashboard:** cash and each bank's balance, receivables and payables with ageing, claims pending, this month's sales / gross profit / expenses / net profit, GST and TDS due.

### A8 — GST on the buying side (L)

- **A8.1 Input credit register** (by rate, supplier, month) and the purchase register with GST.
- **A8.2 GSTR-3B working:**
  - outward supplies from invoices and notes (the same data as GSTR-1);
  - input credit from purchase bills, supplier notes and expense vouchers;
  - reverse charge;
  - net payable by head.
- **A8.3 GST set-off and payment:** input credit against output tax in the legal order; cash paid from a bank with the challan number. Posts to `GST_OUTPUT` / `GST_INPUT` / bank.
- **A8.4 GSTR-2B match:** import the portal's 2B file; match on GSTIN + bill number + amount. List bills missing in 2B (credit at risk), 2B bills not in our books, and differences.
- **A8.5 Reverse charge:** for example freight from a GTA. A self-invoice, with the tax as both a liability and an input credit.

### A9 — TDS (M)

- **A9.1 TDS sections:**
  - a master with code, rate, rate without PAN, single and yearly thresholds;
  - starter rows 194C, 194H, 194I, 194J and 194Q;
  - rates editable, and to be checked by the CA.
- **A9.2 Deduction.**
  - A supplier or a voucher has a section. On a bill, payment or expense the app works out whether a threshold is crossed (yearly totals per party), and proposes the TDS.
  - The accountant can change it, with a reason.
  - Posts Cr `TDS_PAYABLE`.
- **A9.3 TDS payment:** a challan voucher (Dr `TDS_PAYABLE`, Cr bank), section and month, with the challan number.
- **A9.4 TDS on our receipts:** when a shop or customer deducts TDS, the receipt records it (Dr `TDS_RECEIVABLE`), so the shop's bill is fully settled.
- **A9.5 Registers:** TDS deducted by party / section / quarter, paid vs due, and a quarterly return working (26Q data); TDS receivable by customer.

### A10 — Switch-over kit (S)

- **A10.1** A guided "Move your books here" checklist:
  - FY start or switch date;
  - opening trial balance;
  - banks;
  - shops' and suppliers' open bills;
  - pending claims;
  - opening stock count;
  - lock the old period.
- **A10.2** Import templates for each, with checks: totals must match the trial balance before the books open.
- **A10.3** Parallel-run report: the app's trial balance, debtors, creditors and stock against the old software's figures for the same date, line by line.

## 7. The books check

Run in tests and by the "Check my books" button:
1. every entry balances;
2. every business's ledger sums to zero;
3. no line crosses businesses;
4. no entry has only one line;
5. shop bills and supplier bills have paid amounts in range and the right settled flag;
6. allocations add up, on both sides;
7. no unconfirmed money is allocated;
8. each shop's receivable = its open bills − its advances;
9. each supplier's payable = its open bills − its advances;
10. each company's claims receivable = its open claims;
11. trial balance = 0;
12. the balance sheet balances;
13. purchase register = ledger;
14. the GSTR-3B input credit = the `GST_INPUT` movement;
15. cash book closing = the cash account;
16. bank book closing = the statement closing after matching.

Checks 1–8 passed on 24 Nov. The others are added with their phases.

## 8. Order

A1 → A2 → A3 → A4 → A5 → A6 → A7 → A8 → A9 → A10.

A1–A3 already let a business enter purchases and pay suppliers here. With A7 the business no longer needs separate accounting software. A8–A9 complete the filing workings. A10 is used for each business's switch.

## 9. Risks

- **Legal rules** (input-credit eligibility, reverse charge, TDS sections and rates) must be checked by a CA before a business files from these workings. The app shows working figures; filing stays with the CA.
- **Switch-over:** if purchases stay in the old software while sales move here, the books split. Each business switches everything on one date (A10).
- **Size:** together about as big as Phases 1, 3 and 5. Each step needs its own tests, and the books check after every money test file.
