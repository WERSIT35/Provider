# UI Flow v3 — Vault 20K client

## Main flow

1. **Boot** → rules + session init (engine in the browser, or the platform's `/game/v1/*` when
   launched from `/play?lt=…`). The ticker starts rotating idle tips.
2. **Idle** → bet −/+, Buy Feature, Ante Bet, turbo, autoplay, info/menu modals.
3. **Spin** → press (tap) or hold (400ms) for turbo; Space bar works on desktop. The spin lock
   allows exactly one round per press; a press during a round is a fast-stop/skip.
4. **Round** → spin-out, per-symbol drop-in, win steps and tumbles (see
   `docs/spin-animation-spec.md`). The ticker shows the spin line, then **WIN: amount** as wins
   are credited.
5. **Settle** → balance count-up; big-win overlay for ≥10×; the WIN line holds until the next
   spin.
6. **Free spins** → triggered by scatters or bought; the bonus runs as autoplay with the ticker
   showing free spins left and the Total Multiplier badge on the board.

## Screen areas

- **Left:** Buy Feature, Ante Bet.
- **Centre:** the board (canvas), Total Multiplier badge (bonus only), feature screen overlay.
- **Right:** art slots (game logo, character).
- **Deck:** menu / info / sound, the ticker + Credit / Bet readouts, spin cluster (−, spin, +,
  autoplay, turbo).
- **Overlays:** info/settings modal (tabs, focus trap, Esc), big-win overlay.

There is no top bar and no admin panel in player mode; simulation and inspector tools only
exist in admin mode.
