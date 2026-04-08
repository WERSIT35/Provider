# 06 Frontend Slot Client

## Goal
Build performant HTML5 slot client integrated with backend outcomes.

## Tasks

1. Client architecture:
   - Render engine selection
   - State store for spin lifecycle
   - Deterministic animation from resolved outcomes
2. Core UX flows:
   - Loading/session ready
   - Bet controls
   - Spin actions
   - Reel spinning animation and staggered stops
   - Win display and summary
   - Bonus entry/exit
3. Reliability:
   - Reconnect and state recovery
   - Safe handling of duplicate responses
4. Performance:
   - 60fps targets on mid devices
   - Asset lazy loading and compression
5. Accessibility and localization:
   - Basic accessibility checks
   - Currency and language formatting readiness

## Deliverables

- UI flow map (`client/ui-flow.md`)
- State machine doc (`client/state-machine.md`)
- Client implementation (`client/`)
- Integration test notes (`client/integration-tests.md`)

## Exit Criteria

- Client renders outcomes exactly as backend resolves.
- Critical paths tested on desktop/mobile browsers.
- Placeholder assets can be swapped without code rewrite.
- Spin animation runs smoothly and does not desync from backend outcomes.

## Next

Proceed to [07 Security](07-security.md).
