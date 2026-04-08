# Game Design Document (GDD) v1

## Project

- Working title: `Project Khma` (placeholder)
- Genre: Video slot
- Target market wave 1: Georgia
- Platform: HTML5 (desktop + mobile)

## Core Pillars

1. Clear rules in first 30 seconds
2. Frequent low wins with periodic high-excitement bonus moments
3. Fast performance and short spin-to-result latency
4. Transparent math disclosures (RTP/version)

## Game Layout

- Grid: 5 reels x 3 rows
- Paylines: 20 fixed lines
- Bet model:
  - Coin value configurable by operator
  - Total bet = line bet x 20
- Symbols:
  - 8 regular symbols
  - Wild symbol
  - Scatter symbol

## Core Loop

1. Player sets bet.
2. Player spins.
3. Backend resolves final symbol matrix and outcomes.
4. Client animates results.
5. If scatter threshold met, enter bonus mode.
6. Return to base game.

## Feature Set v1

1. Expanding Wild Reel
- On random base spins, one reel is fully wild for that spin.

2. Free Spins Bonus
- Trigger: 3+ scatters
- Award: 10 free spins (retrigger allowed)
- During free spins, wild multiplier starts at x2 and can increase on retriggers.

3. Big Win Tiers
- `Big Win`, `Mega Win`, `Ultra Win` display bands based on total win multiples.

## Economy Targets (Design Intent)

- RTP target: 96.00%
- Hit frequency target: ~28% to 34%
- Bonus trigger frequency target: every ~130 to 220 spins
- Volatility target: medium-high
- Max win target: x7,500

## UX Rules

- No fake spin outcomes; all outcomes come from backend result.
- Always show bet, win, balance, RTP version, and rules access.
- Win presentation must be skippable.

## Audio/Visual Notes (Placeholder Period)

- Use temporary art packs and neutral SFX placeholders.
- Ensure all asset keys are data-driven to allow artist handoff later without code change.

## Telemetry Events

- `session_start`
- `bet_change`
- `spin_request`
- `spin_resolved`
- `bonus_enter`
- `bonus_exit`
- `error_client`

## Versioning

- GDD version: `v1.0`
- Frozen date: 2026-04-08
