# Banana X — Operator's Guide

This is the short, click-by-click guide for **you (the provider)** and **a casino**
running on top of Banana X. No code editing required.

---

## 1. Start the platform

In a terminal:

```
cd platform
npm install        # first time only
npm run dev:seed
```

That single command:

- boots the platform on `http://127.0.0.1:8080`
- creates a demo casino (operator slug `demo`) with an approved math config
- plays 50 spins so the **Round Inspector** has something to show
- prints **PROVIDER** and **OPERATOR** admin tokens you'll need to sign in
- prints a sample **Round ID** (e.g. `r_seed-3`) to paste into the inspector
- prints a **player launch URL** at `/play?lt=…`

Leave that terminal running. Open these in your browser:

| What                      | URL                                               |
|---------------------------|---------------------------------------------------|
| Admin Portal              | `http://127.0.0.1:8080/admin`                     |
| Player demo (launch URL)  | shown in the terminal — open it in another tab    |

> If you've already started the platform with `npm run dev` (no seed), the
> portal still works but starts empty.

---

## 2. Sign in to the Admin Portal

1. Open `http://127.0.0.1:8080/admin`.
2. Paste the **PROVIDER** token from the terminal into the sign-in box → **Sign in**.
3. You'll land on the **Dashboard** showing the seeded operator, RTP, GGR, and the
   latest rounds.

You can sign out at any time from the **Token** tab (right-most nav button).

---

## 3. Onboard a new casino (no code)

In the portal click **Onboarding**. Walk down the panels:

1. **Create operator** — enter a Name + Slug + Default currency → **Create**.
2. **Allowlist a launch domain** — pick the operator, enter the casino's domain
   (e.g. `play.luckyspin.com`) and environment → **Add**.
3. **Issue API credential** — pick the operator + environment → **Issue**. The
   `api_secret` is shown **once**. Copy it now and hand it to the operator over a
   secure channel (it can never be retrieved again).
4. **Register game + approve math config** — register the game (e.g. `bananax` /
   `Banana X`), then in the second row pick the game, version, RTP profile, and
   theoretical RTP → **Create + approve**. Only approved configs can go live.
5. **Assign the game** — pick the operator, the game, the approved math config,
   the currency, and the allowed bets → **Assign**.
6. **(Optional)** Use **Launch a demo player** to open `/play` for that operator
   — the easiest way to confirm everything is wired correctly end-to-end.

Every step writes an immutable audit record under the hood.

---

## 4. How a casino launches a player

The casino's backend signs a request to `POST /operator/v1/launch` (HMAC over the
exact request bytes, using the `api_key_id` + `api_secret` you issued in step 3).
The platform returns a `launch_token`. The casino redirects the player to the
game URL (e.g. an iframe pointing at `http://your-platform/play?lt=<launch_token>`).

A working example lives in `platform/scripts/e2e-operator.ts`:

```
npm run e2e
```

It prints every step (signed launch, session init, idempotent spin, RBAC checks,
and a Round Inspector lookup) over real HTTP.

---

## 5. How a player plays — and finds their Round ID

The demo player UI is at `/play?lt=<launch_token>`.

1. The page calls `POST /game/v1/session/init` with the launch token; the player
   sees their balance and the allowed bets.
2. The player picks a bet and clicks **Spin**. The platform debits the wallet,
   resolves the spin server-authoritatively, records the immutable round, and
   credits any win — all in one call.
3. **Buy Free Spins** is also server-authoritative: it calls
   `POST /game/v1/buy-feature` (same idempotent debit → resolve → record →
   credit lifecycle as a spin), charges `bet × buy-cost` (default 100×), forces
   the bonus trigger, and the awarded free spins then play out as normal
   0-charge spins. Disabled while an Ante bet is active.
4. After every spin, the page shows a "**Round ID**" card with the round's
   `round_ref` (looks like `r_3a8b…`). There's a **Copy** button.

The player UI is **mobile-first (portrait)**: the same `/play/` URL is the one a
casino embeds in its iframe on desktop and phone alike — no separate mobile
build. When a player calls support, they share the Round ID. You look it up next.

---

## 6. Round Inspector — what the player actually caught

This is the centerpiece. From the Admin Portal:

1. Click the **Round Inspector** tab.
2. Paste the Round ID into the search box → **Look up**.
3. Two panels appear:
   - **Text panel** — round + operator + game + math-config metadata, bet/win,
     scatter count, multiplier applied, free-spin flag, RNG algo + seed
     reference, chain seq + outcome hash, and a **per-step breakdown** of every
     winning cluster (`symbol × count → payout × = amount`) plus the
     multipliers caught.
   - **Visual panel** — a 6 × 5 grid rendered with the **real symbol PNGs** from
     `client/assets/symbols/`. Winning cells glow with the brand-yellow
     outline. SCATTER cells get a red **S** badge; MULTI cells get a yellow
     multiplier badge. A free-spin trigger shows as a purple banner; an active
     free spin shows as an orange banner.
4. Use the playback control:
   - **⏮ Prev** / **Next ⏭** to step through stages (initial board → tumble
     step 1 → tumble step 2 → …)
   - **▶ Play** to auto-walk the cascade
   - Keyboard: **←** / **→** / **Space**
5. The totals bar shows the running win as you step forward and the final
   total at the end.

The view is **read-only playback of the stored outcome** — never re-computed.
If the inspector can render it, that's exactly what the player saw.

> The Round Inspector ID `r_…` is shown to the player after every spin and is
> printed by the seed script for quick testing.

---

## 7. Reports (RTP / GGR / reconciliation / failed settlements)

The **Reports** tab pulls live numbers from the same Admin API:

- **Summary** — rounds, total bet, total win, GGR, hold %
- **RTP** — actual RTP %, rounds, total bet & win
- **GGR by day** — table
- **Reconciliation** — rounds ledger vs money ledger; `ok` should be true
- **Failed settlements** — wins where the operator wallet credit failed; these
  are kept on a queue rather than silently dropped

Operator-scoped admins are always forced back to their own operator's data —
they cannot read another casino's rounds or reports.

---

## 8. Postgres path (optional)

The default in-memory repositories let you run the whole platform with no
external dependencies (the test suite relies on them). For production-shaped
storage, a `docker-compose.yml` is included:

```
docker compose -f platform/docker-compose.yml up -d
psql "postgres://bananax:bananax@127.0.0.1:5432/bananax" \
  -f platform/migrations/0001_core.sql
```

The schema mirrors the in-memory model. To swap in a Postgres-backed
implementation, write a class that implements the `RoundRepository`,
`AuditRepository`, and (eventually) `WalletAdapter` interfaces against the SQL
above, and replace the constructor calls in `platform/src/container.ts`. The
public API does not change.

---

## 9. Known gaps before real money

- **Math RTP re-tune.** The currently committed math simulates ~**88%** RTP
  against a target of **96.38%**. The reel weights / cluster payouts need to be
  tuned by a math analyst before this game is jurisdictionally certified.
  `npm run smoke:rtp` runs a fast Monte Carlo against the engine.
- **Real wallet integration.** The `WalletAdapter` interface
  (`platform/src/modules/wallet/wallet.types.ts`) is implemented in dev by a
  `SandboxWallet`. Going live requires writing a `WalletAdapter` that calls a
  specific casino's wallet API (debit / credit / rollback / balance), with the
  same idempotency semantics. The round lifecycle code does not change.

Everything else — server-authoritative outcomes, immutable hash-chained ledger,
RBAC + tenant scoping, the Round Inspector, the certification gate on math
configs — is in place and tested.
