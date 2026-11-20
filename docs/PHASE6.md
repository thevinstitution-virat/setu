# Phase 6 — Field sales force

Branch: `feat/phase6-field-sales` (cut from `feat/phase5-inventory`).
Plan: `docs/ROADMAP.md` §6 Phase 6. Exit check: **every field person's day can be shown from the record (when they came, where they went, which shops they saw, what happened at each, what they sold and collected), a supervisor sees only their own team, positions are never kept off duty, a new shop never reaches the books without approval, and the Phase 1–5 rules still hold**. This is covered by `tests/field.test.ts` and by the seeded demo.

## How it works

### Who

- New role **SUPERVISOR** (home `/team`). A user has an optional `supervisorId`; a supervisor's **team** is everyone whose `supervisorId` is them.
- Scope (`teamScope` in `src/lib/field.ts`): admins (`team.manage`) see everyone; a supervisor sees themselves and their team; anyone else sees only themselves. Every `/api/team/*`, beat, plan, leave and target read goes through it, and every write for another person checks it (`assertAgentInScope`, `assertUserInScope`).
- **Field roles** are Sales agent, Driver and Supervisor (`FIELD_ROLES`). They mark attendance, can be tracked on duty, can propose shops, and can sign in by OTP.
- New permissions: `attendance.mark`, `stores.propose`, `stores.approve` (admins), `team.supervise`, `targets.manage` (admins), `field.offbeat` (supervisors). Supervisors do **not** get `team.view`, so the admin staff list (with every shop's phone) stays closed to them.

### Rules (Admin → Settings → Field team, `settings.field`)

| Setting | Default | Meaning |
| --- | --- | --- |
| Selfie required | on | Check in and out need a front-camera photo |
| Location required | on | Check in and out need a GPS position |
| Record positions on duty | **off** | Positions every *n* minutes while on duty only (tell staff first; DPDP) |
| Minutes between positions | 5 | 1–60 |
| Keep positions for | 90 days | 7–365; a nightly job deletes older ones |
| Work starts at | 09:30 | Check-ins after this (IST) are late |
| Visit distance warning | 200 m | A visit checked in further than this from the shop's pin is flagged |
| Sales agents may serve any shop | on | Off-beat visits and orders; supervisors always may |

### Attendance

- One `Attendance` row per **user** per IST day (it was per sales agent before; the migration moved the old rows across). Check-in and check-out each keep time, position, accuracy and selfie (upload kind `selfie`).
- Check-in is late after the work start time. Check-out freezes **minutes** and **distance** (from that day's positions, see below). Check-out is refused while a visit is open, and for drivers while they are on duty.
- Drivers are **checked in automatically** when they go on duty or when a trip starts (no selfie asked; the day's check-out still asks one).
- **Calendar**: month grid with present / late / leave / absent, day details and month totals (days, late days, hours, km, leave days). Days before the login was made (`user.joined`, the IST date of `createdAt`) are never marked absent.
- **Leave**: from / to dates, type (casual, sick, earned, unpaid), reason. Overlapping leave is refused; leave can be asked up to 7 days back. The supervisor of that person, or an admin, approves or refuses (refusing needs a reason). Nobody approves their own. The person can cancel pending leave, or approved leave that has not started.

### Positions and distance

- `LocationPing` rows are taken **only while on duty** and only when the business turned recording on. On duty (`dutyStart`) means: for **drivers**, only while their duty switch is on (an open `DutyShift`), so going off duty stops positions at once even before the day's check-out; for everyone else, from check-in to check-out. The server refuses positions from before duty began, from the future, or when off duty, so a phone that keeps sending cannot record a private evening.
- The browser sends them while the app is open (`DutyTracker`, in the sales and delivery layouts). It polls `GET /api/field/attendance?lite=1` (duty and rules only, no month calendar) to know when to start and stop. Browsers stop timers in the background, so continuous tracking needs the **Android wrapper** (it posts the same `/api/field/pings` with `source: "android"`).
- Distance (`pathMetres` in `src/lib/field-math.ts`): fixes worse than 100 m are dropped, moves smaller than the two fixes' accuracy are treated as standing still (GPS jitter adds nothing), and jumps faster than 150 km/h are skipped as bad fixes.
- `pings.cleanup` (03:45 daily) deletes positions older than each business keeps them.

### Beats and plans

- A **beat** is a named list of shops in visiting order (`BeatRetailer.seq`), for one sales agent and area, with the **weekdays** it runs on (0 = Sunday).
- A **dated plan** (`BeatPlan`, one per agent per day) overrides the weekday beat: another beat, or no beat with a note (training, meeting). Clearing it goes back to the weekday beat.
- The agent's **day route** (`dayRoute`): the beat's shops in order with that day's visit, off-route visits, and planned / covered / ordered counts.

### Visits

- Check in at a shop (position kept, and the distance from the shop's pin). One open visit at a time.
- End with **ORDER** when an order was placed on the visit (orders carry `visitId`), otherwise with a **no-order reason**: has enough stock, owner not there, shop closed, old dues pending, price or scheme issue, buys from another supplier, will order next visit, other (needs a note). A database check refuses a no-order visit without a reason.
- **Off-beat**: a shop that is neither the agent's own nor on today's route. Allowed when the setting is on or the person has `field.offbeat`; the visit is marked `offBeat`. The same rule now lets agents open and order for such shops (`mayServeRetailer` in `src/lib/cart-api.ts`), and their orders list includes orders they placed for other shops.

### New shops from the field

- Any field person proposes a shop (`StoreLead`): name, owner, mobile, building / market, shop number, PIN, area, optional GSTIN (checked) and FSSAI (14 digits), photo (upload kind `store-photo`), position and a note.
- Duplicates are refused up front: a user with that mobile, a shop with that GSTIN, or a waiting proposal with either.
- An admin (`stores.approve`) approves, which creates the retailer login (OTP by that mobile) and the shop, assigned to the proposing agent unless another is chosen; or refuses with a reason. Approved shops count toward the proposer's **new shops** target.

### Targets and incentives

- One target per person, month, measure (and product or brand for units): **order value** (orders the person placed, not cancelled), **units** (item quantity on those orders, optionally one product or brand), **new shops** (their approved proposals, by approval date), **collection** (payments they collected, confirmed or waiting for verification).
- Incentive: nothing below *pay from* % (default 80); from there it is incentive × achieved % (so 100 % pays the incentive in full), up to the *cap* % (default 120). `payout` in `src/lib/field-math.ts`.
- **Leaderboard** per measure and month: supervisors rank their team, everyone else sees the whole field force (names and totals only).

### Supervisor view (`/team`)

- **Team today**: who is in, late, on leave or not in; each person's last position on a plot; hours, km, visits, no-orders, orders and value, collected, beat coverage; **exceptions**: not checked in (an hour after start), late, did not check out (past days), visit far from the shop, no position for a long time (more than 4 intervals, at least 30 minutes), beat less than half covered, no visits.
- **One person's day** (`/team/[userId]`, any past day): hours (live while still on duty), km, visits and no-orders, orders and order value (all orders they placed that day, on a visit or not, the same numbers as Team today), money collected; the position trail with visit markers; a timeline with gaps of more than 30 minutes without a position.
- **Reports** (CSV, IST days, at most 92 days, opens in Excel): attendance, visits, new shops, orders placed by field staff. Cells that look like formulas are quoted so a spreadsheet will not run them.
- There is **no maps provider** yet: positions are drawn on a plain plot, with "Open in Google Maps" links for a point.

### Working for several businesses

- A person who sells for two distributors has a login in each, with the **same mobile**. `GET /api/auth/workspaces` lists the other businesses where an active field login has that mobile.
- **Switching**: only from a session opened by **OTP** (or by an earlier switch) is the mobile proven, so only then does the app sign a 2-minute, single-use token `{jti, phone, from, to}` and open the other business's `/api/auth/handoff?t=…`, which records the `jti` (`HandoffUse`; a replay hits the primary key and is refused) and signs in that business's field user with the mobile. From a password session the switch opens the other business's login page with the mobile filled in.
- Sessions now record how they were opened (`via: password | otp | handoff`). Field staff can sign in by OTP: the login page's **Staff** tab has "Login ID and password" and "Mobile OTP". Staff OTP sends `as: "staff"`, so a mobile that also belongs to a retailer never signs in the retailer from there. `?phone=` fills the mobile, and `?error=` shows why a switch failed.
- People are still separate per business (no shared identity). A global identity with memberships is the larger change, left for later (see Still open).

## Done

- Schema + migration `20261119080000_field_sales`: Attendance moved to users (with a backfill), new BeatRetailer, BeatPlan, LocationPing, LeaveRequest, StoreLead, Target, HandoffUse (row-level security forced on all), new columns on Beat, Visit, RetailerProfile, User; database checks on weekdays, leave dates, target numbers, positions and no-order reasons.
- `src/lib/field.ts` (rules), `src/lib/field-math.ts` (pure maths), `src/lib/field-settings.ts` (settings and labels), `src/lib/handoff.ts`, `src/lib/staff.ts`.
- APIs: `/api/field/{attendance,pings,leave,route,shops}`, `/api/visits`, `/api/beats`, `/api/beat-plans`, `/api/leads`, `/api/targets` (+ leaderboard), `/api/team/{today,track,members,reports}`, `/api/auth/{workspaces,handoff}`; staff phone, supervisor and the new role in the admin users API; `field` in settings.
- Removed `/api/attendance/today` and `/api/sales/beat` (replaced).
- Jobs `pings.cleanup` and `handoff.cleanup`.

## Screens

- **Sales agent** (`/sales`): Today (attendance with selfie, today's beat, open visit), Beat (route in order, check in, take order or no-order reason, any-shop search, other days), New shops, Targets (with leaderboard), Attendance (calendar and leave).
- **Driver** (`/delivery`): Attendance (calendar and leave; check-out waits until they go off duty) and New shops; the duty switch note says positions are saved on duty only when the business turned tracking on, never off duty.
- **Supervisor / admin** (`/team`): Team today (counts, plot of last positions, people with exceptions), one person's day, Leave, Beats and the 14-day plan grid, Targets, New shops queue (with clashes), Reports, and (supervisors) My attendance.
- **Admin**: Field team link; Staff (`/admin/team`) with role chips, mobile, supervisor picker and "Team of n"; Settings → Field team.
- **Login**: Retailer / Staff tabs, staff OTP mode, `?phone=` and `?error=` for switching business.
- Business switch card on the field apps' home pages.

## Demo data (`npm run db:seed`)

- Tenant `demo`: supervisor `supervisor` / `123456789` (mobile 9000000001) with a team of Test Agent (9000000002), new sales agent `ravi` / `123456789` (9000000003) and the driver (9000000004).
- Seven more shops with pins; Sai Super Mart gets a pin. Beats "Andheri West" (Mon, Wed, Fri) and "Bandra to Dadar" (Tue, Thu, Sat) for Test Agent, "Andheri East and Bandra" (Mon–Sat) for Ravi; a dated swap tomorrow and a training day after.
- The four field logins "joined" on the first seeded day, so their calendars show no absences before it.
- 14 days of attendance (some late), positions every 5 minutes along the route, the driver's phone off for 2 hours one day, Ravi not checked in today. Today's walk follows the whole day's plan cut at the current time, so people are mid-route; the supervisor is tracked too. The driver has a duty shift for each day worked, open today (on duty).
- Visits: past ones end with a no-order reason (some far from the shop, some shops skipped); only **today's Patel Kirana visit is ORDER**, carrying Patel's open order. Both seeded orders are placed by Test Agent, so the order value and targets have numbers.
- Leave: the driver's approved sick day, Ravi's pending casual leave next week.
- Shops from the field: one approved (Kale General), one waiting, one waiting with a mobile that already belongs to Patel Kirana (shows the clash), one refused.
- Targets this month for all three; position recording is **on** in the demo.
- Tenant `second`: a Test Agent login (`agent` / `123456789`) with the same mobile 9000000002 and Sharma Stores on its book, for the business switch.

## Tests

`tests/field.test.ts` (fresh users on fixed past days):

- maths: IST days, late, distance with jitter / bad fixes / jumps, longest gap, payout floor and cap, FSSAI / mobile, settings parsing, CSV quoting and formula defusing;
- scope: admin all, supervisor team, others self;
- attendance: selfie and position rules, late, once a day, check-out blocked by an open visit, minutes and distance frozen, no positions after check-out, positions refused when tracking is off or off duty, retention purge;
- leave: overlaps, who may decide (not oneself, not another team), refusal reason, on-leave lookup;
- beats and plans: weekday beat, plan override, no-beat day, clearing, someone else's beat refused;
- visits: distance from the pin, one open visit, reason rules, an order on the visit makes it ORDER, another agent can't close it, off-beat setting;
- new shops: validation, duplicate mobile / waiting proposal, approval creates the shop and login, no second decision;
- targets: validation, replace, value / units / new shops measured, payout, leaderboard;
- team day: exceptions, reports only for the team, 92-day limit;
- business switch: wrong business, replay, bad token, no login there.

The tenant-isolation test already checks that every table with a tenantId has forced row-level security and a policy.

Checked by hand on a production build at phone width (375 px, no sideways scroll) with the demo data: every `/team` screen as supervisor and admin; the sales agent's Today, Beat (check in → no-order reason → checked out), Targets, Attendance and New shops (the duplicate-mobile clash shows); the driver's duty switch, Attendance and New shops; Admin → Staff and Settings → Field team; the login page's staff OTP mode with `?phone=` / `?error=`. Not checked by hand: the OTP code step (production has no SMS set up) and the business switch to `second` end to end (covered by the tests).

## Still open

- **Android wrapper**: background GPS (foreground service) posting to `/api/field/pings` with `source: "android"`; the browser only records while the app is open.
- **Maps provider**: the plot has no streets. Pick a provider (key, cost, terms) for real map tiles and road distance.
- **Global identity**: one person, one login, memberships in several businesses (the roadmap's wording). Today it is linked logins by mobile with a signed switch.
- **Sub-areas**: the roadmap mentions a sub-area on new shops; shops have an area only.
- Attendance correction by a supervisor (forgot to check out), and holidays / weekly offs other than Sunday in the "not checked in" exception.
- Incentive payouts are shown, not paid: no payroll or ledger posting.
- Selfie face match and fake-GPS detection.

## Traps

- `Attendance` is keyed by **userId** now (`tenantId_userId_date`). Anything that looked up attendance by sales agent is gone.
- Prisma ignores partial indexes: `Target_one_per_metric_key` and `StockLot_place_batch_key` are `NULLS NOT DISTINCT … WHERE "tenantId" IS NOT NULL` so `migrate diff` shows no drift. Do not let a generated migration drop them.
- Route files may only export route handlers: helpers like `assertAgentInScope` live in `src/lib/field.ts`.
- Test GSTINs must really fail the check digit to test "not valid": `27ABCDE1234F1Z0` is a **valid** GSTIN. Using it made the new-shop test pass only after a first run had left a waiting proposal behind (the clash error also says "GSTIN"), and fail on a freshly seeded database.
- Tests leave rows in the demo tenant: reseed (`npm run db:seed`) before a demo.
