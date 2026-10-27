---
name: lumina-web-style
description: Oto's web style for this repo's pages — the /play shell, the Provider and Operator consoles, the demo casino and its back-office, pitch pages. Use whenever asked to improve, restyle, redesign, polish or build any of them.
---

# Lumina web style

The direction for every web page in this repo. It sets **how** pages are designed; each page's
concrete look still comes from its own audience and brand. Two Lumina pages should feel made by
the same designer, never like the same template.

Not covered here: the game art (symbols, effects, chamber) — that is `client/assets/ART.md` and
the art bible; and the reels' motion — that is `docs/animation-guide.md`. This skill never
overrides `CLAUDE.md`; where they differ, `CLAUDE.md` wins.

## 0. Improve or redesign — say which, then go

Judge the page against the direction (section 2) first, then pick a scope and state it in one line:

- **Improve** when it already follows the direction: keep its palette, fonts, section order and
  layout; make it sharper, faster, more honest.
- **Redesign** when the look fights the direction (templated, generic, cluttered, slow) or the
  structure can't carry the content. Do it fully.
- **Oto's references win.** A screenshot, prompt or "keep X" from him sets the scope and the look.
  Never swap his direction for your own idea.
- Keep all real content and facts, whatever the scope.

## 1. How to work

- **Don't open with a list of questions.** Read the page's code, its data and the running page
  first. A missing fact → keep the current text and mark it `TODO(oto)` in code and in the report.
- **Never invent facts:** no made-up metrics, casinos, testimonials, RTPs, player counts, dates or
  promises. Numbers come from a real source (`tools/bench`, `docs/perf-baseline.md`, the rules
  JSON, a measured run). **Never claim certification, licences or regulatory approval.**
- **Never copy another provider's** art, icons, button graphics, colours, layouts or trade dress.
- **Ids never change** (game codes, routes, storage keys, `bananax` ids, DOM hooks the probes use).
- **Git:** branch from the latest `main`, one PR per task (≤800 changed text lines, no stacked
  PRs), push once when the work is finished. Merge only when every CI check is green.
- **Gates:** a visual-only change goes straight to CI. Anything touching boot, restore, embedding
  or behaviour runs the gates in `CLAUDE.md` locally first.
- **Stop and ask** before anything that touches money flow, bet validation, RTP, the operator API,
  wallet/ledger code or tables, or adds a migration — a restyle never needs to.
- **Proof:** screenshots before vs after at 390×844 (phones first) and 1440×900, side by side. If
  before and after look the same, the task isn't done.
- **Report (short):** what changed per task + screenshots · checks run · `TODO(oto)` list · one
  next step. No recap of steps. Oto prefers rendered results to descriptions.

## 1a. Art, not CSS (game pages: the player chrome, every game's look, the lobby)

Owner's rule, permanent: everything players see is art images (the owner's Gemini art,
keyed WebP, built from `art-src/` by a `tools/build-*.mjs` script) or SVG (gradients inside
the SVG). CSS only places things: layout, show/hide, opacity fades, transforms that move or
scale art, live text's font/size/weight/colour, focus rings. CSS never draws: no decorative
gradients, box-shadow, text-shadow, filter/drop-shadow, backdrop-filter glass, `::before` /
`::after` shapes, clip-path/mask shapes, keyframes that fake light; `border-image` only for
one 9-slice art frame. Missing art → a ready-to-paste Gemini prompt under "Art needed", never
a CSS stand-in. Text stays real text; text effects = SVG `<text>` or an art plate. Inventory
and order of work: `docs/lumina-overhaul/art-not-css.md`. (The consoles and the demo casino's
back-office are staff tools: this rule doesn't apply to them unless Oto says so.)

## 2. The direction (every page)

1. **Content is the hero.** The game, real numbers, real screens lead; decoration never competes.
2. **One signature moment per page**; calm, disciplined everything else.
3. **Restraint in colour.** Neutrals do the work; one deliberate accent. In the game and the
   consoles that accent already exists — use the page's brand tokens, don't add new ones.
4. **Typography carries it.** Confident display type, strong size contrast, tight headline
   tracking, readable body. No generic defaults (Inter, Roboto, Arial, Space Grotesk) on new work.
   The game shell's current `--font-ui` is Inter: swapping it is a brand call — propose it, don't
   do it silently.
5. **Editorial structure.** Hairlines, kickers (`03 / ROUNDS`), index numbers, negative space,
   asymmetric grids — not cards-in-cards or three-column "features" grids.
6. **Engineered feel.** 4px spacing grid, aligned edges, honest data, nothing fake.
7. **Motion with purpose.** Snappy, physical; never hides content; off under reduced motion.
8. **Fast and accessible by default** (section 5).
9. **Phones are designed, not squeezed.**

Choosing a look for a new page: who is it for and what does it do → a one-sentence mood →
palette + fonts + one signature moment that fit → state them in one line and build.

## 3. Per surface

- **Player chrome (Lumina Shell, `client/shell/`):** one liquid-glass chrome for every game. Its
  `--lsh-*` values live in `shell.css` only; a game never sets `--lsh-*` or styles `.lsh*`
  (`theme-lint`, `chrome-identity` fail otherwise). Restyling the chrome is a change to all games at
  once, proven by `npm run test:lumina` (identity, parity, the 9-size audit).
- **A game's own look** (board, logo, in-board HUDs, themed slots via `skin: { "--skin-…" }`):
  follows its brand sheet — Vault 20K = Colchis Treasury (`client/assets/ART.md`), the others in
  `docs/brand/` or the game's `DESIGN.md`. All the client invariants in `CLAUDE.md` apply: no shake,
  no idle motion or rAF at rest, zero layout thrash, `#psTicker` the one message line, every popup
  through `VxNotify`, displayed pays = paid pays, never edit an engine for looks, no mechanics text
  on the main screen.
- **Demo lobby (`demo/lobby.html`):** Lumina's own brand, not any one game's; lead with the games
  themselves.
- **Provider Control Plane `/provider` and Operator Portal `/admin`:** tools for busy staff. Dense,
  calm, data first: hairline tables, kickers, monospace for refs and hashes, one accent for state.
  Always `esc()` interpolated values. Keep `permissions`-based hiding of write controls.
- **Demo casino + back-office (`demo-operator/`):** the casino is a separate brand from Lumina —
  give it its own look, not the game's. The back-office runs under a per-response nonce CSP: no
  inline handlers or style attributes; escape every API value.
- **Pitch / marketing pages:** dark with one vivid accent fits a slot provider; lead with the game
  itself (real captures), real measured numbers, and an honest "what we are" — no licence claims.

## 4. Motion and copy

- Reveals `cubic-bezier(0.16,1,0.3,1)`, 200–600ms; springs (~15% overshoot) only for layout
  morphs. No bouncy-cheap easing, no entrance animation that hides the first paint.
- Micro-interactions (magnetic buttons, spotlights, count-ups) only for fine pointers with
  `prefers-reduced-motion: no-preference`. Reduced motion → no animation, transitions or grain.
- Copy: short, factual, no hype, no emoji, no fake urgency. Numbers over adjectives. Responsible
  gambling wording stays plain and visible; never make wins sound certain.

## 5. Quality bar (always on)

- **Accessibility:** visible focus rings, semantic headings, `aria-live` for status, alt text,
  contrast ≥4.5:1, hit areas ≥44px, keyboard-usable menus and dialogs.
- **Performance:** no layout shift, explicit image sizes, responsive WebP, lazy-load below the
  fold, no forced layout reads at startup, fonts subset + `font-display: swap` + preload only
  what's above the fold. The game holds 60fps without GC spikes (`docs/perf-baseline.md`).
- **Security:** CSPs stay strict; no inline script/style where a nonce CSP is in force; never
  `targetOrigin "*"`.

## 6. Never

- Ignore Oto's references or his stated scope.
- Invent facts, claim certification, or copy another provider's look.
- Hide content behind entrance animations or ship layout shift.
- Use purple "AI" gradients, glowing blobs, emoji icons, stock illustrations or generic
  three-card grids.
- Say "done" without before/after screenshots.
