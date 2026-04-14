# Provider Slot MVP (Banana X Profile Build)

Runnable server-authoritative slot prototype with Banana X-style profile wiring.

## Requirements

- Node.js 18+

## Run

```bash
npm start
```

Open:

`http://localhost:3000` (or next free port if 3000 is busy)

## Active Game Profile

- Game title: `Banana X`
- Default game id: `bananax`
- RTP modes:
  - `bananax` (slug `banana_x_fantasma`) - `96.38%`
  - `bananax_94` (slug `banana_x_94_fantasma`) - `94.40%`
  - `bananax_92` (slug `banana_x92_fantasma`) - `92.38%`
- Layout: `5 reels x 4 rows`
- Win model: symbols pay anywhere (minimum `8` matches)
- Volatility: `High`
- Max win cap: `20000x` bet

## Math Simulation

- UI button: `Imitate 1M Spins`
- API: `POST /api/v1/simulate` with:
  - `{ "steps": 1000000, "bet_amount": 1, "game_id": "bananax" }`
- Stream API:
  - `GET /api/v1/simulate/stream?steps=1000000&bet_amount=1&game_id=bananax`

## Implemented APIs

- `POST /api/v1/session/init`
- `POST /api/v1/spin`
- `POST /api/v1/buy-free-spins`
- `POST /api/v1/simulate`
- `GET /api/v1/simulate/stream`
- `GET /api/v1/game-rules`
- `GET /api/v1/health`

## Runtime Features

- Server-authoritative RNG outcomes
- Tumble flow with animated drop + explode
- Free spins, retriggers, and multiplier progression
- Per-profile RTP configuration via `math/game-rules-v2.json`
- In-client canvas renderer with futuristic dark/glass visual theme
- Last 10 Spins log + event feed merged in one panel

## Important Notes

- Sessions are in-memory (no persistent DB yet).
- RTP modes should be validated with repeated 1M runs before certification sign-off.
