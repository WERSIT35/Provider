# Lumina Games provider website

A static B2B site for casinos looking for providers: a home page (`index.html`) and one game
sheet per title (`games/vault-20k.html`). Plain HTML/CSS with a tiny `site.js`: no build, no
dependencies, no tracking. It uses the same fonts (Inter + Oswald, OFL) and art as the game.

## Before publishing: fill these in

| Placeholder | Where | What |
|---|---|---|
| `partners@example.com` | `index.html`, `games/vault-20k.html` (search for it) | The real partnerships email |

The demo links point at `https://provider-flame.vercel.app/` (the standalone game client).

## Deploy (Vercel, separate project, free)

1. vercel.com → **Add New… → Project** → import this GitHub repo.
2. **Root Directory:** `website`. Framework preset: **Other**. No build command, no output dir.
3. Deploy. `vercel.json` here turns on clean URLs (`/games/vault-20k`) and security headers.
4. Optional: add your domain under **Settings → Domains**.

The existing game project (repo root, `vercel.json` → `client/`) is untouched.

## Preview locally

```bash
npx serve website     # or any static server; open the printed URL
```

## Updating facts

Every number on the site comes from the repo. Update it when these change:
- RTP, ante RTP, hit rate, bonus frequency: `qa/rtp-certification-report*.md`
- Bets, multipliers, free spins, max win: `client/math/game-rules-v2.json`
- Screenshots: re-capture from the client (hide the empty `.ps-slot[data-empty]` art slots).
