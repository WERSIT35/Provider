# Game Design Document (GDD) v2

## Project

- Title: `Banana X` (profile build)
- Provider reference: `Fantasma Games`
- Platform: HTML5 (desktop + mobile)
- Engine type: server-authoritative slot with canvas-rendered client

## Core Pillars

1. Transparent outcomes and rules
2. High-volatility excitement with visible multiplier progression
3. Smooth visual flow (drop/tumble/explode) without result spoilers
4. Profile-driven RTP modes and runtime rule consistency

## Game Layout

- Grid: `5 reels x 4 rows`
- Win model: symbols pay anywhere
- Minimum matching symbols: `8`
- Symbols:
  - 9 regular symbol families in current profile
  - `MULTI` (wild multiplier)
  - `SCATTER`

## Feature Set

1. Tumble Sequence
- Winning symbols are removed.
- Remaining symbols collapse down.
- New symbols drop from above.
- Repeats until no new win appears.

2. Multipliers
- Multiplier symbols can appear in base and bonus rounds.
- Sequence multipliers are accumulated once per unique multiplier symbol.
- Free spin multiplier progression is persistent per bonus session.

3. Free Spins Bonus
- Trigger: 4+ scatters in base game.
- Award: 15 free spins.
- Retrigger: 3+ scatters during free spins for +5.

## Economy Targets

- RTP profiles:
  - 96.38% (`bananax`)
  - 94.40% (`bananax_94`)
  - 92.38% (`bananax_92`)
- Volatility: High
- Max win cap: `20000x`
- Validation gate: repeated 1,000,000-spin simulations must be checked per profile.

## UX Rules

- No client-side fake outcomes.
- Final board and wins originate from backend response.
- Rules modal is config-driven from `math/game-rules-v2.json`.
- Last 10 Spins panel includes both spin history and runtime event messages.

## Versioning

- GDD version: `v2.0`
- Updated: `2026-04-14`
