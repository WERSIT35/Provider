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
- Payline win direction: left-to-right, starting from reel 1
- Bet model:
  - Coin value configurable by operator
  - Total bet = line bet x 20
- Symbols:
  - 8 regular symbols
  - Wild symbol
  - Scatter symbol
  - Player-facing symbol theme:
    - 🍒 A
    - 🍋 B
    - 🍇 C
    - 🍀 D
    - 🔔 E
    - 💎 F
    - 🪙 G
    - 👑 H
    - 🌟 WILD
    - 🎯 SCATTER
- Payout communication:
  - show a clear in-game payout table for 3/4/5 matches per symbol
  - specify that line symbols pay by line bet multiplier
  - specify that scatter pays by total bet multiplier

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

- RTP target: 95.00% to 96.50% (profile dependent)
- Hit frequency target: ~36% to 40% (higher small-win feedback profile)
- Bonus trigger frequency target: every ~130 to 220 spins
- Volatility target: medium-high
- Max win target: x7,500

## UX Rules

- No fake spin outcomes; all outcomes come from backend result.
- Always show bet, win, balance, RTP version, and rules access.
- Always show line count and line-win logic in info view.
- Show symbol legend in info view (emoji display + internal symbol code).
- Show winning line count per resolved spin.
- Visually highlight caught payline cells on the reel grid.
- Win presentation must be skippable.

## Spin Animation Behavior (MVP)

- On spin request, reels enter animated spin state.
- Reels stop left-to-right in staggered sequence.
- Final symbols are revealed only at reel stop.
- Winning lines are highlighted after full reel stop.
- Win pulse effect plays for winning outcomes.

## Payline Communication Requirement

- Info panel must show:
  - total line count (20)
  - line win rule (3+ matching from reel 1, left-to-right)
  - wild and scatter behavior
  - example line paths

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
