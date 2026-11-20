# Phase 13 — Ordering by text and voice, and Ask your business

Branch: `feat/phase13-ordering-ask` (cut from `feat/phase12-forecast-ai`).
Plan: `docs/ROADMAP.md` §7: **A1** a shop types, pastes, speaks or WhatsApps an order the way it would say it ("5 peti nimbu, 2 jeera") and gets a cart to check, and **A11** the owner asks questions about the business in Hindi or English. Exit check: **a typed or spoken order in Hindi, Hinglish or English becomes cart lines matched to the shop's products, units and cases, with the unsure lines marked; a text sent to the WhatsApp order number comes back as a link that opens those lines in the app; nothing is ordered until the shop places it; the owner's questions about dues, sales, products, shops, the team, stock and pending orders are answered from the report queries; all of it works with no AI key**. Covered by `tests/order-text.test.ts`, `tests/ask-rules.test.ts` and `tests/phase13.test.ts`.

Photos (A3 payment screenshots, A8 delivery proof, A10 shelf audit) are Phase 14.

## The guardrail

Nothing is ordered or answered by guesswork. A read order only fills a cart (or a WhatsApp draft) that a person checks and places. The AI, when there is one, may only pick from a numbered list of the shop's own products, or from a fixed list of report questions; it never writes SQL, prices or the numbers in an answer.

## A1 — reading an order (`src/lib/order-text.ts`, `src/lib/order-intake.ts`)

- **Splitting** (`splitOrderText`): new lines, commas, `;` `।` `|` `&` `+`, "aur / and / और", and a bare number after product words when the phrase began with a number ("5 peti nimbu 2 jeera"). A size after product words ("chai 250 g") is not a new item.
- **One phrase** (`parsePhrase`): the quantity (digits, Hindi and English number words, aadha / dedh / dhai), a unit and a pack size. Units: cases (peti, carton, box, dibba, bori, case…), pieces (packet, piece, nag…), dozen, weights (g, kilo…) and volumes (ml, litre…), in Latin and Devanagari, long vowels read short ("dibbaa" = "dibba"). A weight or volume is the quantity when no other number is in the phrase, else the pack size. Fillers ("bhej do", "chahiye", "please", greetings) are dropped.
- **Matching** (`matchProducts`): each word against the product's search text (name, Hindi name, aliases, SKU, brand, category): exact 1, prefix 0.85, synonym 0.9 (nimbu = lemon, cheeni = sugar, tel = oil, from the catalogue word list), sound-alike 0.8, sound prefix 0.65, one letter off 0.55. A match needs one word at 0.75 or more; extra words in the name cost a little; a size that fits the name's pack adds 0.2, a wrong one takes 0.15.
- **Quantity for the cart** (`cartQty`): cases when asked for and the product has a case (else units, with "No case size" as a note); a dozen = 12; a weight or volume turns into packs by the name's size ("5 kilo" of a 1 kg pack = 5). "5 kilo chawal" with a 5 kg bag = 1 bag.
- **Sure or not** (`confidenceOf`): high at 0.85 with a 0.1 lead over the next product; medium at 0.65; else low. A line with nothing found keeps its number and asks to pick a product. A phrase with no number and no product (a greeting) is dropped.
- **With AI** (`readOrder`): the rules always run first. When the business has AI, the message is read again with candidates numbered `i. name | Hindi | brand | unit | case`: the whole catalogue up to 150 products, else what the rules found for each line and word (at most 120). The answer is `{ lines: [{ said, i | null, qty, per }] }`; a number outside the list becomes "pick one", fractions round up, a case on a product without one becomes units. A line the rules agree with is high; otherwise medium. If the AI fails, the rules' lines come back with a note. Logged as feature `order.read`.
- Limits: 2,000 letters per message, 100,000 per line.

## A1 — on screen (`src/components/store/OrderByText.tsx`)

- In the storefront (shops, and agents ordering for a shop), above Usual order: **Type or speak your order**. A text box (paste a WhatsApp message, or type) and a **mic** that uses the phone's own speech-to-text (Web Speech API, `hi-IN`, which also catches English product names). The mic shows only where the browser has it (Chrome, Android); Firefox and the in-app pane have none, so only typing there.
- **Read order** → each line with what was said, the product (a select with the close matches and "Another product…", or a search box in Hindi or English), the number, and units ↔ cases. Lines to check are marked **Check** or **Pick one**; out-of-stock chips show; "in cart · adds to it". **Add N to cart** adds to what is in the cart (same units), else sets it. The server prices it as always.
- Settings → Automation → **Orders by text and voice**: on/off for the card, and for WhatsApp.

## A1 — orders on WhatsApp (`src/lib/order-drafts.ts`)

- Meta sends messages to `GET/POST /api/platform/webhooks/whatsapp`. GET answers Meta's check with `WHATSAPP_VERIFY_TOKEN`; POST must carry `X-Hub-Signature-256` (HMAC-SHA256 of the body with `WHATSAPP_APP_SECRET`). With neither set the address is 404. It always answers 200 once the signature is good, so Meta doesn't resend.
- The sender's last 10 digits are looked up among active shop logins in live businesses. **One** business → a draft. **Several** (a shop buying from two distributors on Setu) → a reply to order in the right app, no draft. **None** → no reply.
- A text becomes an `OrderDraft` (READING), one per WhatsApp message id, and a new job `order.message` reads it (inline when the queue is down). It then turns OPEN with its lines and the shop gets a reply: what we read, a link `/retailer/catalogue?draft=<id>` and "Nothing is ordered until you tap Place order". Audio and images get a reply asking for text or the app's mic. The business's switch off → a reply to order in the app.
- Replies are `MessageLog` rows with event `reply.order`, sent by the usual sender. `reply.*` events go out as plain WhatsApp text (allowed inside the 24 hours after the shop's message); every other event still needs an approved template.
- The link opens the storefront with the draft's lines in the review card. Placing an order with that cart sends `draftId`, and the draft turns USED with the order id in the same transaction as the order (only an open, unexpired draft of the same shop). Drafts expire after **3 days** (the daily 06:00 run marks them EXPIRED).
- The reply is in the shop's language (`User.lang`, en or hi).

## A11 — Ask your business (`src/lib/ask-rules.ts`, `src/lib/ask.ts`)

- **Reports → Ask** (`/admin/reports/ask`, `reports.view`): a question box with a mic, example questions, and answers newest first, each with a summary, "Read as" chips (what we understood), a table and **Full report**.
- **Nine questions** it can answer, each one report query: **dues** (owing at least ₹N, oldest bill at least N days, overdue only) from `outstanding`; **collections** (`collections`, default today); **sales total** against the period before (`salesTotals`, `orderTotals`, default this month); **top products** and slowest (`productMix`); **top shops** and least (`retailerAnalytics`); **inactive shops** (no order for N days, default 30; never ordered counts); **sales by person** (`agentPerformance`); **low stock** (`reorderList`; says so when stock tracking is off); **pending orders** by stage.
- **Reading** (`readQuestion`): Hindi is spelt out in Latin letters and long vowels shortened ("baaki" = "baki"; "week" reads "wik"); ऑ is read as ओ. Keywords pick the question (baki, udhaar, owe → dues; vasooli → collections; order nahi kiya → inactive; kisne becha → the team; khatam, stock → low stock…). Amounts: "20,000", "₹20k", "20 hazar", "2 lakh"; days: "30 din", "ek mahina", "2 weeks"; periods: aaj, kal, is hafte, is mahine, pichhle mahine, is saal, last N days; "top 5"; least / sabse kam.
- **With AI**, only when the rules can't tell: the AI picks an intent from the list and its params (`cleanQuery` checks them again: intents from the list, numbers in range, periods from the presets or 1–366 days). Feature `ask`, about 400 tokens. Still not understood → the list of what it can answer.
- Summaries are templates filled from the query results; money in whole rupees.
- Settings → Automation → **Ask your business**: on/off.

## API

- `POST /api/order-text { text, retailerId? }` → `{ lines, source, credits, note }` (signed in; `retailerId` checked as for the catalogue; off → 403).
- `GET /api/order-drafts/<id>?retailerId=` → `{ draft: { id, text, lines, status, source, orderId } }` (that shop's drafts only; an expired one comes back EXPIRED with no lines).
- `POST /api/orders` takes `draftId`.
- `GET /api/catalogue` now includes `orderText`.
- `GET/POST /api/platform/webhooks/whatsapp` (Meta).
- `POST /api/admin/ask { question }` → `{ answer }` or 422 with what it can answer (`reports.view`; off → 403).

## Schema

Migration `20261120200000_order_drafts` (applied locally): `OrderDraft` (tenant, shop, channel, text, lines JSON, source, status READING / OPEN / USED / EXPIRED, WhatsApp message id unique per business, order id, reply, expires at), check `OrderDraft_used_check` (a USED draft has an order), row-level security like every tenant table. Settings: `automation.orderText { on, whatsapp }` and `automation.ask { on }`, all on by default.

## Checked in a browser

Production build on port 3101, 20 Nov, seeded demo, local seed accounts, no AI key (the browser pane was hidden, so the screens were read as text and driven from the page):

- As a shop: "2 dibba chai, 5 kilo chawal, tel 1 carton" → 2 boxes of chai, 1 rice bag, 1 carton of oil; "तीन साबुन और दो पैकेट चिप्स", "arhar dal 4, coffee 2 jar, toothpaste 1 darjan" and "bartan dhone wala 6" all matched. The card: read, an unknown word left to pick, a Hindi line marked, **Add 3 to cart** filled the cart (priced, scheme applied).
- WhatsApp: a message from a second demo shop through the intake made a draft and a reply with the link; the link opened the draft's lines in the card; adding them filled the cart. The first demo phone is a shop in two businesses in the dev database, and got "order in the right app" instead.
- As the owner: dues over ₹5,000 for 7 days (6 shops), sales this month against last, top 5 products for 90 days, shops with no order for 15 days (asked in Hindi), sales by person, low stock, today's collections, pending orders; an off-topic question declined. The Ask tab, settings cards.
- Found and fixed: a greeting read as an item, "boxs", "1 shop owe", ".00" in summaries, "Pick one" on a line that had a product.
- The test draft and replies were deleted afterwards.
- **Not checked**: the mic (no speech-to-text in the pane), 375 px (pane hidden), placing an order from a draft in the browser (covered by tests), a real Meta webhook call, a real AI call.

## Tests

- `tests/order-text.test.ts` (8): splitting, one phrase in Hindi and English, pack sizes, matching by spelling / sound / Hindi / synonyms and by size, cart quantities, whole messages (greetings dropped), asking when unsure.
- `tests/ask-rules.test.ts` (7): normalising, dues with amount / age / overdue, sales / collections / periods, products / shops / team, inactive / stock / pending, giving up rather than guessing, cleaning what the AI sends.
- `tests/phase13.test.ts` (10), on scratch businesses purged at the end: reading by rules; the AI picking from numbered candidates only (and "pick one" outside the list); falling back when the AI refuses; Meta's signature; a WhatsApp text → one draft per message id, reply with the link, another shop can't open it, placing uses it once; strangers ignored, audio answered, the switch, expiry; two businesses with the same shop phone; dues from the books; pending orders and "can't tell"; the AI picking a fixed question (and a made-up intent rejected).
- Full suite: 351 tests in 24 files pass. `tests/analytics.test.ts` can still fail on its own random shop phone (Phase 10); it passes on a rerun.

## Still open

- **WhatsApp number and Meta app**: the platform's own number, the webhook URL and the two secrets have to be set up in Meta's console; nothing has come in from Meta yet. Free-form replies only work within 24 hours of the shop's message (always true here, as we reply at once).
- A shop with the same phone at two distributors can't order on WhatsApp (it is told to use the app). Choosing by a code word in the message would fix it, if it happens often.
- Voice notes on WhatsApp aren't read (they get a reply to type or use the app's mic); that needs speech-to-text on the server.
- Ask covers nine questions; more (returns, schemes, routes, one shop's history) can be added the same way.
- AI for A1 / A11 follows the Phase 12 rules: only the premium plan has it today.

## Traps

- **Heredocs in the Bash tool lose backslashes** (`\b` became a backspace character in a regex). Make regex edits with the Edit tool, then check for `\x08` in the file.
- **`next build` rejects extra exports from a route file**: helpers like `validSignature` live in `src/lib`.
- **The React hooks lint rule flags functions named `use…`**: the draft helper is `spendDraft`. Props of client components that take functions end in `Action`.
- **`window.SpeechRecognition` differs on server and client**: read it with `useSyncExternalStore` (false on the server) to avoid a hydration mismatch and the set-state-in-effect lint.
- Seeded shop phones may exist in more than one business in a used dev database; the WhatsApp intake then won't make a draft.
