# Seller's Setu — landing page rebuild handoff

Read this first if continuing the Seller's Setu landing/branding work. Written at the end
of the session that rebuilt the landing page from the approved design mock.

## Where things stand

- **Repo:** `thevinstitution-virat/setu` (GitHub, private). Local checkout: `H:\Apps\setu`.
- **Branch:** `feat/sellers-setu-landing` — pushed to origin. **Not merged, no PR opened yet**
  (user hasn't asked for one). 3 commits on it:
  1. `05f3499` — brand tokens, fonts, landing copy, design reference checked in
  2. `936f310` — app-wide brand styling (buttons/cards/nav/toggle)
  3. `07b534d` — the actual landing page rebuild (all section components)
- **Dev server:** was running on port 3100 (`npm run dev` in a terminal tab) for the user to
  click through in EN/HI. May or may not still be running in a new session — just start it
  again if needed (`npm run dev` in `H:\Apps\setu`, port 3100 is hardcoded in `package.json`'s
  `dev` script and `H:\.claude\launch.json`'s `"setu"` config).
- `npm run lint` and `npm run build` both pass with **zero new errors**. There are 8
  **pre-existing** lint errors elsewhere in the app (admin/sales pages' `useEffect` + `load()`
  pattern, flagged by a newer `react-hooks/set-state-in-effect` rule) — confirmed pre-existing
  by stashing and re-running lint on top of the prior commit. Not this session's problem unless
  asked to clean up react-hooks lint debt app-wide.

## What the task was

User pasted a large design task (see the full original prompt in the conversation transcript
if you need the exact wording) plus a design mock file:
`C:\Users\thevi\Downloads\Seller's Setu — Landing page.html` (687KB, a self-extracting
"artifact bundle" export — not plain HTML). That file's content is now preserved at
**`docs/design/sellers-setu-landing.dc.html`** in this repo (copied verbatim, still in its
bundler-wrapped format).

The task: give the Seller's Setu app a cohesive "Kesar/Mor/Genda/Pudina" brand (replacing the
old teal/gold Setu look), rebuild the landing page section-by-section from the design mock,
and apply the brand app-wide. Full detail is in the original pasted task text — the short
version is captured below.

### How the design mock was extracted (if you need to re-extract anything)

The `.dc.html` file is **not readable directly** — it's a "bundler" export that unpacks itself
via JS into `document.body` at runtime (fonts/license text dominate the file size; the real
page is only ~88KB of HTML + ~78KB of CSS once unpacked). To get at it:

1. Serve the file over HTTP (file:// doesn't work for the unpacking JS): e.g.
   `python -m http.server 4590` from `docs/design/`.
2. Open it in a browser (the Claude Code built-in browser pane could NOT reach
   `localhost:*` in this session — a known limitation this session hit repeatedly; used
   `curl` instead for verification. Try the browser pane fresh in a new session; it may work).
3. Once loaded, `document.body.innerHTML` has the real rendered markup (English, stage 0 of
   the journey stepper, motion on). `document.styleSheets` (iterate `cssRules`, skip
   `CSSRule.FONT_FACE_RULE` — those are huge embedded Google Fonts data URIs) has the real CSS.
4. The actual **DICT** (en/hi copy), **STAGES**, **REG** (stock register), **FAQ** arrays and
   the stepper's `Component` class logic are inside a `<script type="text/x-dc">` tag — search
   the unpacked body HTML for `const DICT`. This is the authoritative copy source; it's fully
   transcribed into `src/lib/i18n/landing-content.ts` already, so you shouldn't need to
   re-extract it unless the user supplies an updated design file.
5. CSS keyframe percentages (hero scene choreography, confetti, stepper fades, etc.) were
   grepped out of the extracted CSS and are now baked into `src/components/landing/landing.css`
   with the same timing. If the user says "the design changed," re-extract and diff.

### Brand spec (from the task prompt, now implemented in `src/app/globals.css`)

- **Kesar (saffron)**, primary action: gradient `#DB5C17 → #C94A0C → #A93C08`, text
  `#A93C08`, tint `#FDE7D7`.
- **Mor (deep teal)**, dark surfaces: `linear-gradient(150deg,#155651,#0C3634 60%,#082625)`.
- **Genda (marigold)**, highlights/warnings: `#F2B33D`, tint `#FCEFD0`, text `#6E4E00`.
- **Pudina (mint)**, success/delivered: `#3CC9A0`, tint `#DDF6EC`, text `#0E6B52`.
- Ground `#F6F1E7` w/ soft aurora glows, ink `#0F2A2A`, secondary `#36504E`, muted `#5B6F6C`.
- Fonts via `next/font/google` (all three exist in this Next version's font-data.json,
  confirmed): **Sansation** (headings, weights 300/400/700 + italics — max weight 700, no
  800), **Funnel Sans** (body, 400–800), **Anek Devanagari** (Hindi fallback in both stacks,
  400–800). Wired up in `src/app/layout.tsx` as `--font-heading` / `--font-body` / `--font-deva`.

## File map (what was touched/created)

```
docs/design/sellers-setu-landing.dc.html   — design mock, verbatim copy (reference only)
docs/design/SELLERS-SETU-LANDING-HANDOFF.md — this file

src/lib/brand.ts                 — APP_NAME, APP_NAME_HI, APP_SHORT_NAME, ROADMAP flags
src/lib/i18n/landing-content.ts  — REPLACED entirely; flat DICT-shaped bilingual content
                                    (LandingContent type + en/hi records), matches the design
                                    mock's DICT/STAGES/REG/FAQ almost 1:1
src/app/globals.css              — new color tokens (@theme), app-wide .btn/.glass/.chip/.card
src/app/layout.tsx                — new font loading (Sansation/Funnel Sans/Anek Devanagari)
public/manifest.webmanifest       — theme_color/background_color updated to new brand
src/components/AppShell.tsx       — brand mark (bridge icon), font/color touch-ups
src/components/LanguageToggle.tsx — restyled to match the design's segmented toggle
.env.example                      — NEW, documents NEXT_PUBLIC_WHATSAPP_NUMBER
.gitignore                        — added `!.env.example` exception

src/app/page.tsx                  — assembles the new section component list (see below)
src/components/landing/
  landing.css                     — NEW, all the landing-only CSS + keyframes (prefixed `ls-`)
  use-landing.tsx                 — NEW (renamed from .ts since it has JSX), useReducedMotion
                                    (useSyncExternalStore-based, SSR-safe), useInView,
                                    Confetti component (seeded-random, not Math.random-in-render)
  LandingNav.tsx                  — rewritten for new nav structure
  HeroSection.tsx                 — rewritten: pill/h1/lead/CTAs + the full 16s choreographed
                                    delivery scene (office map + retailer phone mirror)
  BuiltForStrip.tsx               — NEW
  JourneySection.tsx              — NEW, 5-stage stepper (5s auto-advance, pauses on
                                    document.hidden, stops auto-advance once user taps a stage)
  GodownSection.tsx                — NEW, stock dashboard + scrolling register
  LiveMapSection.tsx               — NEW, live GPS map mock + agents list
  BeatSection.tsx                  — NEW, sales beat/visits/attendance
  BillingSection.tsx               — NEW, GST invoice mock + collections
  OwnerDashboardSection.tsx        — NEW, pipeline stages + regions + team panel
  BilingualSection.tsx             — NEW, EN/HI flip card demo
  StepsSection.tsx                 — NEW, 3-step "go live" cards
  FaqSection.tsx                    — rewritten, accordion (first item open by default)
  CtaFooterSection.tsx              — rewritten, CTA panel + footer w/ VPD/VGraphics attribution

DELETED (old landing components, fully superseded):
  BilingualDemoSection.tsx, BridgeAnimation.tsx, ComparisonSection.tsx,
  DayTimelineSection.tsx, FeatureGridSection.tsx, StatsCountSection.tsx, use-landing.ts
```

## Known deviations from the design mock (told to the user already)

- **Stepper phone screens**: only stage 1 ("sales agent visits") had its exact markup
  recoverable from the unpacked DOM (the other 4 stages are conditionally rendered and weren't
  the active one when extracted). The other 4 screens (catalogue, pack & assign, on the way,
  delivered) are built from the DICT copy + the same visual pattern — consistent but not a
  byte-for-byte clone of the original.
- **Confetti**: original random `--dx/--dy/--r` values weren't recoverable (the `<i>` elements
  had empty inline styles in the static export — likely set by the live `dc` runtime which
  isn't in the bundle). `Confetti` component in `use-landing.tsx` generates 16 seeded-random
  pieces instead — same mechanism (CSS custom properties + the real `popA`/`popB` keyframes),
  different exact scatter pattern.
- Everything else (colors, fonts, copy, keyframe timings/percentages, layout) was ported with
  real extracted values, not guessed.

## Things NOT done / explicitly out of scope

- **No PR opened** — user said "yes, push it" for the branch push only; hasn't asked for a PR.
  Ask before opening one, per the task's own "Before you finish" step 1 ("Don't push" was in
  the original task text, but user overrode that for this session — they explicitly asked to
  push after the fact).
- **No backend changes.** Live GPS tracking and inventory/stock models don't exist in Prisma
  yet — `ROADMAP.liveTracking` / `ROADMAP.inventory` are both `false` in `src/lib/brand.ts`,
  and the relevant landing sections show a "Rolling out" chip instead of claiming the feature
  is live. If asked to actually build these:
  - **Inventory**: needs a stock/movement ledger per `Product` (in/out/return events), low-stock
    thresholds, reorder suggestions — none of this exists in `prisma/schema.prisma` yet.
  - **Live GPS**: needs location pings from delivery/sales agents (a `LocationPing` model or
    similar), a live map data feed (polling or WebSocket), and ETA calculation — none of this
    exists yet either. `Visit` model already has geo-tagging for sales check-ins, but delivery
    agents have no live-location concept at all currently.
- **8 pre-existing lint errors** (react-hooks/set-state-in-effect in admin/sales pages) were
  left alone — confirmed pre-existing, out of scope for this task.
- Didn't do a full Lighthouse pass (mobile 90+/95+ perf/a11y target from the original task) —
  browser pane couldn't reach localhost this session, so only server-rendered HTML was
  verified via `curl` (both langs render correctly, routes 200, no runtime errors in server
  logs). **If continuing: actually open it in a browser and eyeball it / run Lighthouse** —
  this hasn't been visually verified by Claude, only by the user.

## If the user asks to continue

- If they report something looks wrong on a specific section, the component file names above
  map 1:1 to sections — find the right one, it's self-contained.
- If they want the design changed further, ask if they have an updated design mock; if so,
  re-extract using the recipe above rather than guessing.
- If they want a PR: standard flow, `gh pr create` from `feat/sellers-setu-landing` into
  whatever the default branch is (check with `git remote show origin` or `gh repo view`).
- If they want this merged/deployed: no deploy pipeline has been mentioned for this project
  yet (unlike the other vinstitution-family apps) — ask where/how it should be hosted before
  assuming anything.
