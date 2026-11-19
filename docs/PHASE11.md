# Phase 11 — Automation base and maths automations

Branch: `feat/phase11-automation` (cut from `feat/phase10-analytics`).
Plan: `docs/ROADMAP.md` §7, the AI layer, taking the base and the items that need no AI provider: **A2** usual order, **A4** collections autopilot, **A5** trip planning, **A7** daily visit plan, **A9** cash and fraud checks, **A12** risk score with credit-limit suggestions. Exit check: **every morning the business gets suggestions worked out from its own records (visit plans, stopping and restoring credit, new credit limits, things worth a question), each with its reasons; a permitted person accepts or rejects each one and only then does anything change; dispatch can split the day's ready orders across free drivers in one tap; shops and agents see a shop's usual order and add it in one tap; every run is logged; each automation can be turned off and tuned per business**. Covered by `tests/automation-math.test.ts` and `tests/automation.test.ts`. No AI model, provider or key is used: all of it is plain maths. The AI cost log is in place for the language features that come later.

## The guardrail

Roadmap §7: an automation never posts a ledger entry, changes a price or moves money by itself. It writes a **Suggestion**. A person with the right permission accepts it (and only then is it applied) or rejects it. The one exception: a **visit plan** may be applied straight away when the owner switches on "Add them to the agents' day without asking", because a visit moves no money. It still shows in the inbox, marked "Applied automatically".

## How it works

### Suggestions (`src/lib/automation.ts`)

- One row per suggestion: kind, the shop / agent / day it is about, title, detail, reasons (short phrases shown as chips), payload (what accepting will do), a priority 0–100, status `OPEN → ACCEPTED | REJECTED | EXPIRED`, who decided and when, a note, and the result of applying it.
- **Never twice**: each has a `dedupeKey` (e.g. `visit_plan:<agent>:<day>`, `credit_stop:<shop>:<oldest bill>`, `credit_limit:<shop>:<week>`, `check:far:<drop>`), unique per business, so re-running a job (or Run now) makes nothing new. Trip plans are the exception: each Plan trips makes a new one and expires the older open plan for that day and slot.
- Kinds and who may decide them (`KIND_PERMISSION`; any one of the listed permissions is enough, `canAny`):

| Kind | Accepting does | Permission |
|---|---|---|
| `visit_plan` | adds the chosen shops to an agent's day | `team.manage` or `team.supervise` |
| `credit_stop` | sets the shop's credit limit to ₹0 | `credit.manage` |
| `credit_restore` | gives back the limit it had before the stop | `credit.manage` |
| `credit_limit` | sets the suggested limit | `credit.manage` |
| `check` | nothing; marks it looked into ("Not a problem" rejects) | `reports.view` |
| `trip_plan` | creates the trips, adds the orders, puts them in route order | `orders.dispatch` |

- Credit kinds check that the shop's limit hasn't changed since the suggestion was made; if it has, 409 "has changed" and nothing is written. Every accept writes an audit entry (old and new limit for credit kinds); a reject is audited too.
- Open suggestions expire (the daily `expire` step, and on any attempt to decide one late): visit and trip plans at the end of their day, credit limits after 7 days, credit stops and checks after 14.

### Usual order — A2 (`usualOrder`, `orderRhythm` in `src/lib/automation-math.ts`)

- From the shop's last **8 orders in 120 days** (at least 2): a product is in the usual order when it appears in **at least half** of them (and at least twice); its quantity is the **median** (the upper one on an even count).
- **Rhythm**: usual gap = average days between orders (at least 3), days since the last one, due in (gap − days since), and the usual weekday when at least 3 orders and 40% of them fall on one weekday. IST days.
- Shown on the storefront and the agent's order screen as a "Usual order" card: the lines with quantities, **Add N to cart** (sets those quantities), or "All in cart". `GET /api/catalogue` returns `usual { basedOn, lines }` for the shop being ordered for (only products it can see; empty when the feature is off).

### Daily visit plan — A7 (`planVisits`, `visitScore`)

For each sales agent with a beat today (not on leave):

- every credit shop in their areas gets a **score** (capped 0–100) and reasons:
  - churn risk *high* +40, *medium* +25, *new* +5;
  - usual order due +20, plus up to 10 more the later it is (not added on top of *high*);
  - money overdue +10, plus up to 20 for days late (1 per 3 days) and up to 10 for the amount (1 per ₹5,000);
  - a scheme it can use ends within 7 days +10;
  - visited in the last 2 days −30; ordered today → 0;
- shops scoring at least `minScore` (25) are taken, highest first, up to `maxShops` (6). A shop owing money for `visitAfterDays` (10) or more is a **forced collect**: it goes first and is included even when it is already on the beat (marked "on the beat" so the agent knows to ask for money).
- One suggestion per agent per day: "N extra shops to visit, M to collect from". Accepting a subset is allowed (tick the shops). Accepted shops become `VisitTask` rows; the agent's route (`dayRoute` in `src/lib/field.ts`) shows them under **Also visit today** with the reasons, and the beat rows show their reason line.

### Collections autopilot — A4 (`reviewCollections`)

The WhatsApp reminders (Phase 7) stay as they are. On top:

- **visit to collect**: through the visit plan above (`visitAfterDays`, default 10);
- **stop credit**: when a shop's oldest bill is `stopAfterDays` (30) or more overdue and its limit isn't already ₹0 → `credit_stop`. Its new orders then wait for approval like any over-limit order;
- **credit back**: once a stopped shop has nothing overdue → `credit_restore` to the limit it had (or the business default).

### Credit review — A12 (`reviewCredit`, `creditScore`), Mondays

- Risk score 0–100 (higher = riskier): oldest overdue bill (1 per 2 days late, up to 35); share of what it owes that is overdue (up to 20); paying slower than its credit days, from each payment's collected date over 90 days (2 per extra day, up to 20); cheque bounces in 90 days (10 each, up to 20); owing more than its limit (+10); stopped ordering +10 / ordering less +5. Band **Safe** (< 25), **Watch** (25–49), **Risky** (≥ 50).
- Target limit = average monthly sales (last 3 months) × credit days ÷ 30 × **1.5** (Safe) / **1** (Watch) / **0.5** (Risky), rounded to ₹1,000, at least ₹1,000; **₹0** if a bill is more than 60 days late.
- Suggested only when the change is at least ₹2,000 **and** 20%. Raises only for a Safe shop that pays on time and already has credit. A shop with no limit (unlimited) is only ever suggested a limit when it isn't Safe. Shops with an open stop are skipped. When it owes more than the new limit, the detail says its new orders will wait for approval until it pays down.

### Checks — A9 (`runChecks`), on yesterday's records

- **Cash short** at hand-over by `cashShort` (₹200) or more;
- **delivered far from the shop**: the drop's GPS more than `farMetres` (300 m) from the shop's pin;
- **shop found closed** `closedTimes` (3) or more in 30 days (failed deliveries + visits with no order for that reason), once a week;
- **big discount**: an order with `discountPct` (20%) or more off.

Each is a `check` with the facts; accept = "Looked into it", reject = "Not a problem".

### Trip planning — A5 (`planTrips`, `splitStops`)

- On demand from Dispatch (**Plan trips**, with a slot). Takes the orders the dispatch board calls ready (placed / confirmed / packed, not on an unapproved hold, due today or earlier or undated, not on an open trip) and the **free drivers** (not on leave, no open trip in that slot).
- `splitStops`: an angular sweep round the depot starting after the widest empty gap, cut into even slices, one per driver (more drivers are used only when a trip would pass `maxDrops`, 25); shops without a pin go to the trip that already serves their area, else the smallest. Each trip is then put in order with the existing nearest-neighbour + 2-opt (`sequenceStops`), and its km worked out as a round trip.
- One `trip_plan` suggestion (drivers, drops, value, km, areas); an older open plan for the same day and slot expires. Accepting creates the trips as Phase 4 would. "No driver is free" or "Nothing is ready" when there is nothing to plan.

### Runs, jobs, cost log

- `runFeature` logs an `AutomationRun` (feature, trigger `cron` / `manual` / `seed`, start, end, how many made, error) with a 120 s transaction limit; one feature failing doesn't stop the others.
- Worker jobs (IST): `automation.daily` **06:00** every day (expire, visit plans, collections, checks), `automation.weekly` **06:30 Monday** (credit review). Every trial or active business with the feature on.
- `AiCostLog` (feature, provider, model, input and output tokens, cost in paise, credits, who) and `recordAiUse()`, which also adds the credits to the month's `ai_credits` usage counter. Nothing calls it yet; the language features will.

### Settings, API

- `Tenant.settings.automation` (`src/lib/automation-settings.ts`): `visitPlan { on, auto, maxShops, minScore }`, `collections { on, visitAfterDays, stopAfterDays }` (stop must be later than visit), `credit { on }`, `checks { on, cashShort, farMetres, closedTimes, discountPct }`, `usualOrder { on }`, `tripPlan { on, maxDrops }`. All on by default, `auto` off. Saved through `PATCH /api/admin/settings { automation: … }` (`settings.manage`); each feature is merged over the defaults and checked against limits (400 when out of range).
- `GET /api/admin/suggestions?status=&kind=` → `{ items, counts, kinds }`, only the kinds the role may decide (a supervisor sees only their team's visit plans); 403 when it may decide none.
- `POST /api/admin/suggestions/<id> { accept, note?, retailerIds? }` → `{ status, result }`; 409 when already decided or the limit changed, 400 on a bad body.
- `GET /api/admin/automation` → settings, recent runs, open counts, this month's AI credits and cost. `POST { feature | "all" }` runs now (`settings.manage`, audited `automation.run`).
- `POST /api/admin/trip-plan { date, slot? }` (`orders.dispatch`, audited `trip.plan`).

## Screens

- **Suggestions** (`/admin/suggestions`, new nav item "Suggestions" / "सुझाव"): tabs To decide, Accepted, Rejected, Expired; kind chips with counts; each card shows the title, detail, reason chips, priority, and per kind the shop checklist (visit plan, links to each shop's report), the trips (trip plan), the limit from → to with a link to the khata (credit). A note box, the accept button worded by kind ("Add to their day", "Stop credit", "Make the trips"…) and Reject. Decided cards say who, when, the note, and link the trips made.
- **Settings → Automation** (`/admin/settings/automation`, chip on Settings): a card per automation with its switch and numbers (saved when the box loses focus), Run now, recent runs, AI use this month.
- **Dispatch**: slot select + **Plan trips**; the message links to the plan ("Review the plan →").
- **Agent's beat** (`/sales/beat`) and route: reason line on beat rows, **Also visit today** section.
- **Storefront / agent order screen**: the Usual order card.

**Checked in a browser** (production build on port 3101, 20 Nov, seeded demo, local seed accounts): the inbox with counts; accepted Test Agent's visit plan without one shop → 5 tasks on their day; deciding it again 409; reject 200; bad body 400; accepted a credit stop (khata limit then ₹0); settings saved, an out-of-range number 400, Run now; trip plan "No driver is free" for a busy slot and 1 trip in a free one (the demo has one free driver); as Test agent: route reasons, 2 extra shops, "Also visit today" on the beat, inbox 403; usual order on the storefront (Add 2 to cart filled the cart); Dispatch Plan trips ("63 orders in 1 trip for Sat, 21 Nov, Morning"); 375 px with no sideways scroll on the three new screens. Not checked: the 6 AM job firing for real, a supervisor deciding (no screen for them yet), Hindi on screen, auto mode on the demo.

## Schema

Migration `20261120090000_automation` (applied locally):

- `Suggestion` (unique `tenantId + dedupeKey`; checks: score 0–100, decided rows have who and when), enum `SuggestionStatus`;
- `VisitTask` (unique per agent, shop and day; date `YYYY-MM-DD` checked);
- `AutomationRun`; `AiCostLog` (no negative amounts);
- row-level security enabled and forced on all four, with the usual `tenant_isolation` policy.

## Demo data (`npm run db:seed`)

After the demo history, the seed runs the daily automations and the credit review once (trigger `seed`). On a fresh seed: 2 visit plans, 5 credit stops, 3 new credit limits.

## Tests

- `tests/automation-math.test.ts` (17): usual order (half the orders, median, too few orders, old orders ignored), rhythm and weekday, visit score and reasons, credit score bands, target limits and the ₹2,000 / 20% rule, the >60-days ₹0, raises only for Safe, route km, trip splitting by side of town and pins, distance and discount helpers.
- `tests/automation.test.ts` (17), on a scratch business purged at the end, "now" fixed at Thu 19 Nov 2026 09:30 IST: settings defaults and limits; kinds per role; usual order; the visit plan (order, title, a supervisor outside the team 403, accepting some shops → the agent's route, auto mode); stop and restore credit; credit review (a raise, a first limit, a stopped shop skipped, a limit changed meanwhile 409); the four checks, no repeats, off when switched off; trip plan across two drivers and `maxDrops`; expiry and the run log; `recordAiUse`; another business sees none of it.
- Full suite: 294 tests in 18 files pass. Also fixed: `tests/analytics.test.ts` assumed the order of a region's areas (flaky); it finds them by name now.

## Still open

- **Plans**: nothing is gated by plan; the `ai` module isn't checked (these are maths, so core). Decide when the language features come.
- **Supervisors** can decide their team's visit plans through the API, but the inbox lives under `/admin`; they need a screen in the team area.
- No notification when new suggestions arrive (a count on the nav item or a morning message would help).
- Trip planning splits by count and side of town only: no vehicle capacity, weight or time windows; drivers aren't balanced by km.
- Scheme reasons in the visit score leave out schemes aimed at a shop group.
- The usual-order card has no "not this time" for a product; it just leaves what's already in the cart.

## Traps

- **`can(role, [a, b])` needs every permission.** For "any one of", use `canAny` (added in `automation.ts`).
- **`prisma generate` fails with EPERM** while the worker (`scripts/worker.ts`) or a hung `prisma migrate dev` holds the query-engine DLL. The TypeScript client is still written; only the DLL swap fails. Stop those first for a clean generate.
- **Never pass the dev database as `--shadow-database-url`**; use `setu_shadow`.
- **`npx prettier` isn't in the project**: it downloads it, and its default 80 columns rewraps the file. Don't run it.
- A region's areas come back in no fixed order: find them by name in tests.
- Many files are CRLF; keep them so (edit with the editor tools, not `sed`).
- The test businesses and demo checks leave rows (decided suggestions, visit tasks, a stopped shop): reseed before a demo.
