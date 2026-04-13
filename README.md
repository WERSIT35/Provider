# Provider Slot MVP

Initial runnable prototype for a server-authoritative slot.

## Requirements

- Node.js 18+

## Run

```bash
npm start
```

Open:

`http://localhost:3000`

## Math Simulation

Run quick RTP/hit-frequency simulation:

```bash
npm run simulate
```

Optional params:

```bash
node math/simulate.js <steps> <bet>
```

Example:

```bash
node math/simulate.js 1000000 1
```

UI/API comparison simulation:

- UI button: `Imitate 1M Spins`
- API: `POST /api/v1/simulate` with `{ "steps": 1000000, "bet_amount": 1 }`
- Current release target:
  - RTP band: `96.20%` to `96.80%`
  - Profitability gate: `casino_net > 0` on repeated 1M validation runs

## What Is Implemented

- Session init API: `POST /api/v1/session/init`
- Spin API: `POST /api/v1/spin`
- Health API: `GET /api/v1/health`
- Server-authoritative reel outcome resolution
- Basic line/scatter evaluation
- Free spins and multiplier progression
- Expanding wild reel modifier
- Browser client wired to backend APIs
- Player-facing symbol theme in UI (emoji symbols + legend)
- Interactive multi-page Rules modal (`Game Rules` button)
- Rules API: `GET /api/v1/game-rules` backed by strict config validation
- Tumble reveal pipeline with delayed post-drop highlight (no pre-drop spoiler highlights)
- Tiered blast animations (`small` / `medium` / `great`) by win strength
- Scatter-specific special animation
- Persistent multiplier badges that always show explicit `Nx` values

## Rebuild Guides

- Styling rebuild: `docs/styling-guide.md`
- Animation rebuild: `docs/animation-guide.md`
- Multiplier rules: `docs/multiplier-rules.md`
- Simulation streaming notes: `docs/simulation-streaming.md`

## Symbol Theme

- 🍒 `A`, 🍋 `B`, 🍇 `C`, 🍀 `D`, 🔔 `E`, 💎 `F`, 🪙 `G`, 👑 `H`
- 🌟 `WILD`, 🎯 `SCATTER`

## Notes

- In-memory sessions only (no database yet).
- Current math config is placeholder and not certification-ready.
