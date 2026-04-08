# Client State Machine v1

## States

1. `BOOT`
2. `LOADING_SESSION`
3. `IDLE`
4. `SPIN_PENDING`
5. `SPIN_ANIMATING`
6. `BONUS_ENTRY`
7. `BONUS_ACTIVE`
8. `BONUS_EXIT`
9. `ERROR`

## Transitions

- `BOOT -> LOADING_SESSION` on app start
- `LOADING_SESSION -> IDLE` on successful init
- `IDLE -> SPIN_PENDING` on spin click
- `SPIN_PENDING -> SPIN_ANIMATING` on backend resolve
- `SPIN_ANIMATING -> BONUS_ENTRY` if bonus triggered
- `SPIN_ANIMATING -> IDLE` if no bonus
- `BONUS_ENTRY -> BONUS_ACTIVE`
- `BONUS_ACTIVE -> BONUS_EXIT` when free spins complete
- `BONUS_EXIT -> IDLE`
- Any state -> `ERROR` on unrecoverable failure

## Guard Rules

- Do not allow second spin while in `SPIN_PENDING` or `SPIN_ANIMATING`.
- Always bind visual result to resolved backend payload.
