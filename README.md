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

## Symbol Theme

- 🍒 `A`, 🍋 `B`, 🍇 `C`, 🍀 `D`, 🔔 `E`, 💎 `F`, 🪙 `G`, 👑 `H`
- 🌟 `WILD`, 🎯 `SCATTER`

## Notes

- In-memory sessions only (no database yet).
- Current math config is placeholder and not certification-ready.
