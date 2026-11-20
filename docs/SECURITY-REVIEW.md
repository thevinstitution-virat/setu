# Security review — 20 Nov 2026

A read of every API route (about 222) and the foundations (sessions, row
security, storage, webhooks, billing, the console), done before the first
external business goes live. Each finding below was checked by reading the
code before it was fixed. This is a code review, not a pen test: a pen test
is still due before the first paying external business.

Severity: **High** = money or accounts can be taken, or one business's data
reached by another; **Medium** = abuse, cost or data exposure that needs a
signed-in user or extra effort; **Low** = hardening.

## Fixed

### High

| Finding | Fix |
|---|---|
| **OTP guesses in parallel.** The 5-try limit was read, then compared: many guesses sent at once all read "fewer than 5" and were checked, so a 6-digit code could be brute-forced and a shop's account taken. Same for sign-up codes. | The try is claimed in one statement before comparing (`attempts < 5` in the update); codes compared in constant time. `src/lib/otp.ts`, `src/lib/signup.ts`. Test: 12 parallel guesses → exactly 5 checked. |
| **UPI / bank money taken in the field counted at once.** A salesperson or driver could record "UPI received" with any reference and clear a shop's dues with no money landing; the same reference could be used again. | Field UPI / bank now waits in Payments → To verify until the office confirms it (Settings → Money → "UPI and bank taken in the field", on by default). A reference already on a pending or confirmed UPI / bank payment is refused (409). `src/lib/money-api.ts`, payments, deliver and spot-sale routes. |
| **Webhook address check could be bypassed** with IPv6 forms of private addresses (`::ffff:127.0.0.1`, `::ffff:7f00:1`, NAT64, 6to4), reaching the server's own network or cloud metadata. | `privateIp` rewritten: mapped, NAT64, 6to4, unique-local, link-local, multicast, documentation and benchmark ranges are refused; anything unreadable is refused. `src/lib/webhooks.ts`. 24 cases tested. |
| **Push endpoints were any URL.** A browser "subscription" with an internal address made our server send requests there. | Only https endpoints of the known push services (Google, Mozilla, Apple, Microsoft), no port or user info, on subscribe and on send. `pushEndpointAllowed` in `src/lib/security.ts`. |

### Medium

| Finding | Fix |
|---|---|
| Admin home page relied on the layout's sign-in check; a client navigation renders a page without its layout, so a deactivated admin with a live cookie could still load it. | The page checks the session itself. `src/app/admin/page.tsx`. |
| No per-address limits on sending or checking OTPs (SMS cost pumping, guessing across phones). | 20 sends an hour per address, 10 a day per phone per business, 60 checks an hour per address. `src/lib/rate-limit.ts`. |
| Delivery code: 5-try limit counted from audit rows, so parallel tries passed it. | A `codeTries` counter claimed atomically (migration `20261121150000_security_review`). |
| Double submits: delivering an order, opening a trip and writing off a cash shortage could run twice at once and post twice. | Row locks (`FOR UPDATE`) on the order and trip; an advisory lock on the staff member's cash. |
| Client address read from the left of `X-Forwarded-For` (written by the client), so every address-based limit could be dodged. | Read from the right, `TRUST_PROXY_HOPS` entries in (default 1 for Traefik). `clientIp` in `src/lib/audit.ts`. |
| Sessions: algorithm not pinned, no audience, and no way to end a session before it expired (a fired staff member's phone stayed signed in until deactivation was noticed). | HS256 pinned, audience `setu-tenant`, `User.sessionVersion` carried in the cookie. Team page → "Sign out" ends a person's sessions everywhere; `POST /api/auth/logout {"everywhere": true}` does it for yourself. Checked end to end on a local server. |
| Shops saw our buying cost (`lastCost`), supplier and reorder fields of products, and fuller user rows than needed, in order responses. | Those fields are left out; user and actor rows trimmed to id, name, phone (role for actors). |
| Workspace list and switching worked after a password sign-in, so anyone who knew a login and password could see and enter other businesses tied to that phone. | Only after an OTP (or a switch that came from one) for that same phone. |
| Files: data exports could be opened through `/api/files` by any staff member; shops could open staff selfies. Expired exports stayed in storage. | Exports are never served there (owner-only route); selfies are staff-only; expired export files are deleted by the daily clean-up. |
| Hidden (negotiated) plans could be picked by code; a business could sit on the top plan all month and drop to the cheapest the day before the bill. | Only public plans can be picked; a plan with a smaller monthly bill at today's staff and shops starts with the next billing month. (Rates alone mislead: Premium has a lower seat rate than Growth.) |
| Console support staff could mark platform invoices paid, extend trials and reactivate businesses. | Owner only. |
| Spreadsheet imports: a small zip could unpack to gigabytes; very wide sheets; no size check before reading the upload. | Unpacked size read from the zip directory (60 MB cap), 60 columns, row cap, and a 413 on oversized uploads before parsing. |
| AI costs uncapped: order-by-text, Ask and shelf photo reading could be called in a loop. | Per-shop and per-person hourly / daily caps; past the cap the rules-only path is used or the person types it in. |
| Announcements and referrals were missing from the plan-module map, so plans without "engage" could still use their APIs. | Added to `PATH_FEATURES`. |
| Payment simulator: a business set to the practice gateway kept self-paying links in production. | Off in production unless `ALLOW_GATEWAY_SIMULATOR=1` (link creation and the pay button). |

### Low

- Announcement links must be a page in the app (`/x`, never `//host` or `/\host`); the image must be this business's file.
- CSV exports defuse cells starting with `= + - @`, tab or CR (negative numbers left alone).
- Assigning a salesperson checks they exist in this business; new areas check the region is this business's (foreign keys ignore row security); names must be text.
- An order only links the visit of that shop made by the person ordering.
- Staff can't order for a deactivated shop.
- Quantity cap applied after repeated lines of the same product are merged.
- A driver can't take back more crates than the shop holds plus what was just given.
- Attendance selfies must be a fresh upload in this business's selfie folder, never one used before.
- Field staff get a shop's dues, not its full statement history.
- Referral code checks (no sign-in) capped at 30 an hour per address.
- More reserved web addresses at sign-up (console, auth, secure, webmail, smtp, ns1…).
- Unknown login IDs cost the same password check as real ones (no timing hint).
- Webhook "send test" capped at 20 an hour per address.
- The field team's shop list (`/api/field/shops`) returns nothing to a shop's own login (it could list other shops).

## Checked and fine

- Row security: `FORCE ROW LEVEL SECURITY` on 88 of 89 tenant tables (`TenantDomain` is a platform table by design). No raw SQL takes request input unescaped.
- Saved secrets (gateway, webhooks) are AES-GCM encrypted; API keys are stored hashed; webhook signatures compared in constant time.
- Uploads: type read from the bytes, never the browser's label; no SVG or HTML accepted.
- Every console route is guarded; prices and totals are always worked out on the server.
- Sign-in links and support tokens are single-use with their own audiences.

## Not fixed yet

| Item | Why it matters | Suggested fix |
|---|---|---|
| Webhook DNS rebinding | The address is checked, then fetched; a host can answer a public address first and a private one second. | Resolve once and connect to that address (custom lookup in the HTTP agent). |
| Custom domains before verification | A business can add another's domain and hold it until the owner verifies. | Expire unverified domains after a few days; let a verified claim replace an unverified one. |
| Razorpay webhook event ids | Repeated events are made harmless by state checks, but not deduplicated by event id. | Store event ids, skip repeats. |
| `?notice=` on the login page | Shows text from the address bar (plain text, no HTML), usable for convincing phishing messages. | Map short codes to our own messages. |
| One secret for every cookie | Tenant and console sessions are told apart by audience, but share `SESSION_SECRET`. | A separate console secret. |
| Invoice share links | Don't expire. | Expiry plus "revoke link". |
| Supervisors on plans without the field module | Not yet walked through for what they can still open. | Check and gate. |
| Cooldowns | Sending a khata statement again and again; account delete / export loops. | Short per-shop cooldowns. |
| Field staff UI | Staff aren't yet told that a UPI / bank collection now waits for the office. | A line on the collect screen and receipt. |
| Dependencies | `npm audit`: 6 findings, none reachable in the running app (see DEPLOY.md §5). | Recheck with Prisma 7 / exceljs 5. |
| Pen test | A code review misses what only shows in a running system. | Before the first paying external business. |

## How it was checked

- `tests/security-review.test.ts` (new): client address, private addresses, push endpoints, file access, CSV cells, zip size, field money rule, reserved addresses, login timing, OTP parallel guesses, plan changes. `tests/field.test.ts` updated for fresh selfies.
- Full suite: 28 files, 420 tests pass. `tsc` clean; eslint on changed files: no errors. Production build passes.
- Local production server: sign-in, the admin pages changed, the new settings switch, and session revocation (a signed-out person's old cookie gets 401, a fresh sign-in works, others stay signed in).
