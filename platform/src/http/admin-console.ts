import type { FastifyPluginAsync } from "fastify";

/**
 * Banana X Admin Portal — a single served SPA (no separate build step) covering
 * everything an admin actually needs:
 *
 *   • Dashboard      — operators + rounds summary + reconciliation
 *   • Round Inspector — paste a round_ref and see TEXT + VISUAL playback of a
 *                       stored spin, using the real symbol PNGs
 *   • Onboarding     — create operator, allowlist a domain, issue a credential,
 *                       register a game, create+approve a math config, assign it,
 *                       and get a one-click launch link to a demo player
 *   • Reports        — RTP / GGR / reconciliation / failed settlements
 *
 * Token-paste auth (the dev-seed script prints one); state is persisted to
 * localStorage so a refresh keeps you signed in. Everything talks to /admin/v1/*.
 */
const PAGE = /* html */ `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Banana X · Admin</title>
<style>
  :root { color-scheme: dark; --bg:#0b1020; --panel:#111935; --panel-2:#0e1430;
          --line:#1f2a4d; --accent:#FFD400; --text:#e6ecff; --muted:#8a98c8;
          --ok:#5fe3a1; --err:#ff8b8b; --warn:#ffb56b; --hl:rgba(255,212,0,.18); }
  * { box-sizing: border-box; }
  html, body { margin:0; }
  body { font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
  a { color: var(--accent); text-decoration: none; }
  button { background:var(--accent); border:0; color:#000; font-weight:700; padding:8px 14px; border-radius:8px; cursor:pointer; font:inherit; }
  button:hover { filter: brightness(1.05); }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--text); font-weight:600; }
  button.danger { background:#c84455; color:#fff; }
  button:disabled { opacity:.5; cursor:not-allowed; }
  input, select, textarea { background:var(--bg); border:1px solid var(--line); color:var(--text); padding:8px 10px; border-radius:8px; font:inherit; }
  input:focus, select:focus, textarea:focus { outline:2px solid var(--accent); outline-offset:1px; }
  label { display:flex; flex-direction:column; gap:4px; font-size:13px; color:var(--muted); }
  label > input, label > select, label > textarea { color:var(--text); }
  .muted { color:var(--muted); }
  .ok { color:var(--ok); }
  .err { color:var(--err); }
  header { display:flex; gap:14px; align-items:center; flex-wrap:wrap; padding:12px 18px; background:var(--panel); border-bottom:1px solid var(--line); position:sticky; top:0; z-index:2; }
  header h1 { margin:0; font-size:16px; font-weight:700; }
  header .pill { padding:2px 10px; border:1px solid var(--line); border-radius:20px; font-size:12px; color:var(--muted); }
  nav { display:flex; gap:6px; margin-left:auto; flex-wrap:wrap; }
  nav button { background:transparent; border:1px solid var(--line); color:var(--text); font-weight:600; padding:6px 12px; }
  nav button.active { background:var(--accent); color:#000; border-color:var(--accent); }
  main { padding:18px; max-width:1240px; margin:0 auto; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:14px 16px; margin-bottom:14px; }
  .panel h2 { margin:0 0 10px; font-size:15px; }
  .cards { display:grid; grid-template-columns: repeat(auto-fill, minmax(160px,1fr)); gap:10px; }
  .card { background:var(--panel-2); border:1px solid var(--line); border-radius:10px; padding:10px 12px; }
  .card span { display:block; color:var(--muted); font-size:12px; }
  .card b { display:block; font-size:18px; margin-top:2px; }
  table { width:100%; border-collapse:collapse; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); font-size:13px; }
  th { color:var(--muted); font-weight:600; }
  tr.clickable { cursor:pointer; }
  tr.clickable:hover td { background: rgba(255,212,0,.05); }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
  .row > * { flex: 1 1 220px; }
  .grid-2 { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
  @media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
  .status { padding:6px 10px; border-radius:8px; font-size:13px; }
  .status.ok { background:#10301f; color:var(--ok); border:1px solid #1b4f33; }
  .status.err { background:#2a1320; color:var(--err); border:1px solid #5c2236; }
  .login { max-width:520px; margin:60px auto; padding:24px; background:var(--panel); border:1px solid var(--line); border-radius:14px; }
  .login h2 { margin-top:0; }
  pre.code { background:#070b1a; border:1px solid var(--line); padding:8px 10px; border-radius:8px; font-size:12px; overflow:auto; max-height:140px; }

  /* Round Inspector grid */
  .inspector { display:grid; gap:14px; grid-template-columns: 1fr 1fr; }
  @media (max-width: 1100px) { .inspector { grid-template-columns: 1fr; } }
  .inspector .panel { margin:0; }
  .kv { display:grid; grid-template-columns: 140px 1fr; gap:6px 12px; font-size:13px; }
  .kv span { color: var(--muted); }
  .kv code { color: var(--accent); font-family: ui-monospace,Menlo,Consolas,monospace; word-break: break-all; }

  .matrix { display:grid; gap:6px; padding:10px; background:#070b1a; border:1px solid var(--line); border-radius:10px; }
  .matrix .cell { aspect-ratio:1; background:#0b1530; border:1px solid #1c2747; border-radius:8px;
                  position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; transition: box-shadow .25s ease; }
  .matrix .cell img { width:80%; height:80%; object-fit:contain; }
  .matrix .cell.win { box-shadow: 0 0 0 2px var(--accent), 0 0 14px rgba(255,212,0,.55) inset; background:#1b2042; }
  .matrix .cell.scatter::after { content: 'S'; position:absolute; top:3px; left:5px; font-size:10px; color:#fff;
                                  background: #c84455; padding:1px 4px; border-radius:5px; font-weight:700; }
  .matrix .cell .mbadge { position:absolute; bottom:3px; right:4px; font-size:11px; color:#000; background:var(--accent);
                          padding:1px 5px; border-radius:6px; font-weight:700; }
  .matrix .cell .lbl { position:absolute; bottom:2px; left:4px; font-size:9px; color:#aebbe6; }

  .step-ctrl { display:flex; gap:8px; align-items:center; margin-top:8px; flex-wrap:wrap; }
  .totals { display:flex; gap:14px; flex-wrap:wrap; margin-top:8px; }
  .totals .t { padding:6px 12px; border:1px solid var(--line); border-radius:8px; background:var(--panel-2); font-size:13px; }

  .banner { padding:8px 12px; border-radius:8px; border:1px solid var(--line); margin-top:8px; font-weight:600; }
  .banner.fs { background: #28203a; color:#d8c4ff; border-color:#3e3270; }
  .banner.bonus { background:#3a2a10; color:#ffd089; border-color:#6e4d20; }

  .breakdown { font-size:13px; }
  .breakdown details { background:var(--panel-2); border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin-bottom:6px; }
  .breakdown summary { cursor:pointer; font-weight:600; }
  .breakdown ul { margin:6px 0 0 18px; }

  .toolbar { display:flex; gap:8px; flex-wrap:wrap; align-items:center; margin-bottom:10px; }
  .toolbar input.search { min-width: 280px; }
</style></head>
<body>

<header>
  <h1>🍌 Banana X · Admin Portal</h1>
  <span class="pill" id="scopePill">not signed in</span>
  <nav id="nav" hidden>
    <button data-view="dashboard" class="active">Dashboard</button>
    <button data-view="inspector">Round Inspector</button>
    <button data-view="games">Games</button>
    <button data-view="disputes">Disputes</button>
    <button data-view="players">Players</button>
    <button data-view="onboarding" data-provider>Onboarding</button>
    <button data-view="reports">Reports</button>
    <button data-view="settings" class="ghost">Token</button>
  </nav>
</header>

<main>
  <!-- LOGIN -->
  <div id="loginView" class="login">
    <h2>Sign in</h2>
    <p class="muted">Paste an admin bearer token. The dev seed script prints both a
       <b>PROVIDER</b> token (sees everything + can onboard operators) and an
       <b>OPERATOR</b> token (scoped to one casino's data).</p>
    <label>Bearer token
      <input id="loginToken" type="password" autocomplete="off" placeholder="eyJ…"/>
    </label>
    <div style="margin-top:12px; display:flex; gap:8px;">
      <button onclick="signIn()">Sign in</button>
      <button class="ghost" onclick="document.getElementById('loginToken').type = document.getElementById('loginToken').type==='password'?'text':'password'">Show/hide</button>
    </div>
    <div id="loginErr" class="status err" hidden style="margin-top:10px;"></div>
  </div>

  <!-- DASHBOARD -->
  <section id="dashboardView" hidden>
    <div class="panel">
      <h2>Overview</h2>
      <div class="cards" id="overviewCards">loading…</div>
    </div>
    <div class="grid-2">
      <div class="panel">
        <h2>Operators</h2>
        <div id="operatorsList">loading…</div>
      </div>
      <div class="panel">
        <h2>Latest rounds</h2>
        <div class="toolbar">
          <input class="search" id="filterOp" placeholder="filter by operator id (optional)"/>
          <button class="ghost" onclick="loadRounds()">Refresh</button>
        </div>
        <div id="roundsList">loading…</div>
      </div>
    </div>
  </section>

  <!-- INSPECTOR -->
  <section id="inspectorView" hidden>
    <div class="panel">
      <h2>Round Inspector</h2>
      <p class="muted">Paste a Round ID a player shared (e.g. <code>r_abc…</code>) to see exactly what happened on that spin. The matrix below is a faithful playback of the stored outcome — no re-computation.</p>
      <div class="toolbar">
        <input class="search" id="roundRefInput" placeholder="r_… (paste round id)"/>
        <button onclick="lookupRound()">Look up</button>
        <span id="inspectorStatus" class="muted"></span>
      </div>
    </div>

    <!-- Legitimacy check + lifecycle actions for the round in the box above -->
    <div class="panel">
      <h2>Legitimacy &amp; actions</h2>
      <p class="muted">Verify recomputes the outcome from the stored server seed and checks the ledger hash-chain. Provider admins can void/settle directly; operator admins raise a request the provider approves.</p>
      <div class="toolbar">
        <button class="ghost" onclick="verifyRound()">✓ Verify legitimacy</button>
        <button class="ghost" onclick="loadRoundTx()">Transaction timeline</button>
        <span data-provider><button class="danger" onclick="voidRoundAction()">Void round</button></span>
        <span data-provider><button onclick="settleRoundAction()">Settle (re-credit)</button></span>
        <span data-operator><button class="ghost" onclick="raiseDisputeAction('void')">Request void</button></span>
        <span data-operator><button class="ghost" onclick="raiseDisputeAction('settle')">Request settle</button></span>
      </div>
      <div id="roundActionOut"></div>
    </div>

    <div id="inspectorContent"></div>
  </section>

  <!-- GAMES (on/off) -->
  <section id="gamesView" hidden>
    <div class="panel">
      <h2>Games — turn on / off</h2>
      <p class="muted">Disabling an assignment immediately stops new player sessions for that game. <span data-provider>Provide an operator id to view another tenant;</span> operator admins see only their own.</p>
      <div class="toolbar">
        <input class="search" id="gamesOp" placeholder="operator id (provider only)"/>
        <button class="ghost" onclick="loadGames()">Load</button>
      </div>
      <div id="gamesList">–</div>
    </div>
  </section>

  <!-- DISPUTES -->
  <section id="disputesView" hidden>
    <div class="panel">
      <h2>Disputes</h2>
      <p class="muted">Operators raise a void/settle request against one of their rounds; provider admins approve (executes it) or reject.</p>
      <div class="toolbar">
        <input class="search" id="dspOp" placeholder="operator id (provider only)"/>
        <select id="dspStatus"><option value="">all</option><option value="open">open</option><option value="approved">approved</option><option value="rejected">rejected</option></select>
        <button class="ghost" onclick="loadDisputes()">Load</button>
      </div>
      <div id="disputesList">–</div>
    </div>
  </section>

  <!-- PLAYERS -->
  <section id="playersView" hidden>
    <div class="panel">
      <h2>Player lookup</h2>
      <p class="muted">Every round for one player id — the support / dispute triage view.</p>
      <div class="toolbar">
        <input class="search" id="plOp" placeholder="operator id (provider only)"/>
        <input class="search" id="plPlayer" placeholder="operator_player_id (e.g. p1)"/>
        <button onclick="loadPlayer()">Look up</button>
        <span id="plStatus" class="muted"></span>
      </div>
      <div id="playerRounds">–</div>
    </div>
  </section>

  <!-- ONBOARDING -->
  <section id="onboardingView" hidden>
    <div class="panel">
      <h2>Onboard a casino</h2>
      <p class="muted">Each step is the same Admin API the dev-seed script uses — no code editing required.</p>
      <ol style="padding-left:18px; line-height:1.9">
        <li><b>Create operator</b> — a tenant for the casino.</li>
        <li><b>Allowlist a launch domain</b> — only requests from this origin can launch.</li>
        <li><b>Issue an API credential</b> — secret shown ONCE; hand it over securely.</li>
        <li><b>Register the game + approve a math config</b> — only approved configs can go live (certification gate).</li>
        <li><b>Assign the game</b> — links operator ↔ game ↔ approved config + allowed bets.</li>
        <li><b>(Demo)</b> Mint a launch URL to verify the operator end-to-end.</li>
      </ol>
    </div>

    <div class="panel">
      <h2>1 · Create operator</h2>
      <div class="row">
        <label>Name <input id="opName" placeholder="LuckySpin Casino"/></label>
        <label>Slug <input id="opSlug" placeholder="luckyspin"/></label>
        <label>Default currency <input id="opCurrency" placeholder="GEL" value="GEL"/></label>
        <button onclick="createOperator()">Create</button>
      </div>
      <div id="opResult" class="status" hidden style="margin-top:8px;"></div>
    </div>

    <div class="panel">
      <h2>2 · Allowlist launch domain</h2>
      <div class="row">
        <label>Operator <select id="domainOp"></select></label>
        <label>Domain <input id="domainHost" placeholder="play.luckyspin.com"/></label>
        <label>Environment
          <select id="domainEnv"><option value="prod">prod</option><option value="sandbox">sandbox</option></select>
        </label>
        <button onclick="addDomain()">Add</button>
      </div>
      <div id="domainResult" class="status" hidden style="margin-top:8px;"></div>
    </div>

    <div class="panel">
      <h2>3 · Issue API credential</h2>
      <div class="row">
        <label>Operator <select id="credOp"></select></label>
        <label>Environment
          <select id="credEnv"><option value="prod">prod</option><option value="sandbox">sandbox</option></select>
        </label>
        <button onclick="issueCredential()">Issue</button>
      </div>
      <div id="credResult" class="status" hidden style="margin-top:8px;"></div>
    </div>

    <div class="panel">
      <h2>4 · Register game + approve math config</h2>
      <div class="row">
        <label>Game code <input id="gameCode" placeholder="bananax"/></label>
        <label>Game title <input id="gameTitle" placeholder="Banana X"/></label>
        <button onclick="registerGame()">Register game</button>
      </div>
      <div id="gameResult" class="status" hidden style="margin-top:8px;"></div>
      <hr style="border:0; border-top:1px solid var(--line); margin:12px 0;"/>
      <div class="row">
        <label>Game <select id="mcGame"></select></label>
        <label>Version <input id="mcVersion" placeholder="3.0.0" value="3.0.0"/></label>
        <label>RTP profile key <input id="mcKey" placeholder="bananax" value="bananax"/></label>
        <label>Theoretical RTP % <input id="mcRtp" type="number" step="0.01" value="96.38"/></label>
        <label>Config hash <input id="mcHash" placeholder="sha256:…" value="sha256:demo"/></label>
        <button onclick="createMathConfig()">Create + approve</button>
      </div>
      <div id="mcResult" class="status" hidden style="margin-top:8px;"></div>
    </div>

    <div class="panel">
      <h2>5 · Assign game to operator</h2>
      <div class="row">
        <label>Operator <select id="asnOp"></select></label>
        <label>Game <select id="asnGame"></select></label>
        <label>Math config <select id="asnConfig"></select></label>
        <label>Currency <input id="asnCurrency" placeholder="GEL" value="GEL"/></label>
        <label>Allowed bets (comma-sep) <input id="asnBets" value="1, 5, 10, 50, 500"/></label>
        <button onclick="assignGame()">Assign</button>
      </div>
      <div id="asnResult" class="status" hidden style="margin-top:8px;"></div>
    </div>

    <div class="panel">
      <h2>6 · Launch a demo player (optional)</h2>
      <p class="muted">Opens a player session in the demo client at <code>/play</code>. Use this to verify a new operator end-to-end.</p>
      <div class="row">
        <label>Operator <select id="launchOp"></select></label>
        <label>Game code <input id="launchGame" value="bananax"/></label>
        <label>Player id <input id="launchPlayer" value="player-1"/></label>
        <label>Currency <input id="launchCurrency" value="GEL"/></label>
        <label>Origin (must be allowlisted) <input id="launchOrigin" placeholder="play.luckyspin.com"/></label>
        <button onclick="launchDemo()">Open player</button>
      </div>
      <div id="launchResult" class="status" hidden style="margin-top:8px;"></div>
    </div>
  </section>

  <!-- REPORTS -->
  <section id="reportsView" hidden>
    <div class="panel">
      <h2>Reports</h2>
      <div class="toolbar">
        <input class="search" id="repOp" placeholder="operator id (provider only; leave blank for all)"/>
        <button class="ghost" onclick="loadReports()">Refresh</button>
      </div>
      <div class="grid-2">
        <div class="panel"><h2>Rounds summary</h2><div id="repSummary">–</div></div>
        <div class="panel"><h2>RTP (actual)</h2><div id="repRtp">–</div></div>
        <div class="panel"><h2>GGR by day</h2><div id="repGgr">–</div></div>
        <div class="panel"><h2>Reconciliation</h2><div id="repRecon">–</div></div>
        <div class="panel"><h2>Failed settlements</h2><div id="repFailed">–</div></div>
      </div>
    </div>
  </section>

  <!-- SETTINGS -->
  <section id="settingsView" hidden>
    <div class="panel">
      <h2>Token</h2>
      <p class="muted">Replace your bearer token (e.g. to switch from PROVIDER to OPERATOR).</p>
      <label>Bearer token <input id="setToken" type="password" autocomplete="off"/></label>
      <div style="margin-top:10px;">
        <button onclick="updateToken()">Save</button>
        <button class="ghost" onclick="signOut()">Sign out</button>
      </div>
      <div id="settingsStatus" class="status" hidden style="margin-top:10px;"></div>
    </div>
  </section>
</main>

<script>
// ── state ─────────────────────────────────────────────────────────────────────
const state = { token: localStorage.getItem('adminToken') || '', scope: null, operators: [], games: [], mathConfigs: [] };

const $ = (id) => document.getElementById(id);
const fmtMoney = (n) => Number(n ?? 0).toFixed(2);
const fmt = (v) => v === undefined || v === null ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v));
function flash(el, msg, ok) {
  if (!el) return;
  el.hidden = false; el.className = 'status ' + (ok ? 'ok' : 'err'); el.textContent = msg;
}
function clearFlash(el) { if (el) { el.hidden = true; el.textContent = ''; } }

async function api(path, opts = {}) {
  const headers = { 'authorization': 'Bearer ' + state.token, ...(opts.headers || {}) };
  if (opts.body && typeof opts.body !== 'string') {
    headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (res.status === 401) {
    // The token is invalid or expired — don't leave a half-broken dashboard with
    // "invalid admin token" smeared across every panel. Bounce to a clean login.
    handleAuthExpired();
    const err = new Error('admin token invalid or expired'); err.status = 401; err.body = body; throw err;
  }
  if (!res.ok) {
    const msg = body?.error?.message || ('HTTP ' + res.status);
    const err = new Error(msg); err.status = res.status; err.body = body; throw err;
  }
  return body;
}

// Force a clean re-auth when a 401 is seen mid-session (expired/invalid token).
let _authExpiredFlashed = false;
function handleAuthExpired() {
  signOut();
  if (_authExpiredFlashed) return;
  _authExpiredFlashed = true;
  flash($('loginErr'), 'Your admin token is invalid or expired. Paste a fresh one — re-run "npm run dev:seed" to mint new tokens.', false);
  setTimeout(() => { _authExpiredFlashed = false; }, 1500);
}

// ── views ────────────────────────────────────────────────────────────────────
const VIEWS = ['login','dashboard','inspector','games','disputes','players','onboarding','reports','settings'];
function show(view) {
  for (const v of VIEWS) $(v + 'View').hidden = (v !== view);
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'dashboard') refreshDashboard();
  if (view === 'inspector') $('roundRefInput')?.focus();
  if (view === 'games') loadGames();
  if (view === 'disputes') loadDisputes();
  if (view === 'players') $('plPlayer')?.focus();
  if (view === 'onboarding') refreshOnboardingDropdowns();
  if (view === 'reports') loadReports();
  history.replaceState(null, '', '#' + view);
}

document.querySelectorAll('#nav button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

// ── sign in ──────────────────────────────────────────────────────────────────
async function signIn() {
  const tok = $('loginToken').value.trim();
  if (!tok) return flash($('loginErr'), 'paste a token first', false);
  state.token = tok;
  try {
    // Probe scope: provider tokens can hit /operators (200); operator tokens are
    // forbidden there (403) but valid. A 401 means the token is invalid or
    // expired — don't "sign in" into a dashboard that will 401 on every panel.
    const ops = await fetch('/admin/v1/operators', { headers: { authorization: 'Bearer ' + tok } });
    if (ops.status === 401) {
      state.token = '';
      return flash($('loginErr'), 'Token invalid or expired — paste a fresh one. Re-run "npm run dev:seed" to mint new tokens.', false);
    }
    if (ops.status !== 200 && ops.status !== 403) {
      state.token = '';
      return flash($('loginErr'), 'Sign-in failed (HTTP ' + ops.status + ').', false);
    }
    state.scope = ops.status === 200 ? 'provider' : 'operator';
    localStorage.setItem('adminToken', tok);
    afterSignIn();
  } catch (e) {
    flash($('loginErr'), 'sign-in failed: ' + e.message, false);
  }
}
function afterSignIn() {
  $('scopePill').textContent = (state.scope || '?') + ' admin';
  $('nav').hidden = false;
  applyScopeVisibility();
  const initial = (location.hash || '#dashboard').slice(1);
  show(VIEWS.includes(initial) && initial !== 'login' ? initial : 'dashboard');
}

// Show provider-only controls (data-provider) only to provider admins, and
// operator-only controls (data-operator) only to operator admins.
function applyScopeVisibility() {
  const isProvider = state.scope === 'provider';
  document.querySelectorAll('[data-provider]').forEach(el => { el.style.display = isProvider ? '' : 'none'; });
  document.querySelectorAll('[data-operator]').forEach(el => { el.style.display = isProvider ? 'none' : ''; });
}

function signOut() {
  state.token = ''; state.scope = null; localStorage.removeItem('adminToken');
  $('scopePill').textContent = 'not signed in'; $('nav').hidden = true;
  $('loginToken').value = '';
  show('login');
}

function updateToken() {
  const tok = $('setToken').value.trim();
  if (!tok) return flash($('settingsStatus'), 'paste a token first', false);
  state.token = tok; localStorage.setItem('adminToken', tok);
  flash($('settingsStatus'), 'updated', true);
}

// ── dashboard ────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  // Overview cards (RTP / GGR / rounds).
  try {
    const summary = await api('/admin/v1/reports/summary');
    const rtp = await api('/admin/v1/reports/rtp');
    const recon = await api('/admin/v1/reports/reconciliation');
    $('overviewCards').innerHTML =
      cardHtml('rounds', summary.rounds) +
      cardHtml('total bet', fmtMoney(summary.total_bet)) +
      cardHtml('total win', fmtMoney(summary.total_win)) +
      cardHtml('GGR', fmtMoney(summary.ggr)) +
      cardHtml('hold %', summary.hold_percent) +
      cardHtml('RTP % (actual)', rtp.actual_rtp_percent) +
      cardHtml('reconciliation', recon.ok ? '✅ ok' : '⚠ drift');
  } catch (e) { $('overviewCards').innerHTML = '<span class="err">'+e.message+'</span>'; }

  if (state.scope === 'provider') {
    try {
      const data = await api('/admin/v1/operators');
      state.operators = data.operators || [];
      renderOperators();
    } catch (e) { $('operatorsList').innerHTML = '<span class="err">'+e.message+'</span>'; }
  } else {
    $('operatorsList').innerHTML = '<p class="muted">Operator scope — your own operator only.</p>';
  }
  await loadRounds();
}

async function loadRounds() {
  const opFilter = $('filterOp').value.trim();
  const qs = opFilter ? ('?operator_id=' + encodeURIComponent(opFilter)) : '';
  try {
    const data = await api('/admin/v1/rounds' + qs);
    const rows = data.rounds || [];
    if (!rows.length) { $('roundsList').innerHTML = '<p class="muted">no rounds yet</p>'; return; }
    const head = ['<tr><th>round_ref</th><th>operator</th><th>bet</th><th>win</th><th>status</th><th>created_at</th></tr>'].join('');
    const body = rows.slice().reverse().slice(0, 50).map((r) =>
      '<tr class="clickable" data-ref="' + r.round_ref + '">' +
        '<td><code>' + r.round_ref + '</code></td>' +
        '<td>' + (r.operator_id ? r.operator_id.slice(0, 8) + '…' : '') + '</td>' +
        '<td>' + fmtMoney(r.bet_charged ?? r.bet_amount) + '</td>' +
        '<td>' + (r.total_win > 0 ? '<span class="ok">+' + fmtMoney(r.total_win) + '</span>' : fmtMoney(r.total_win)) + '</td>' +
        '<td>' + r.status + '</td>' +
        '<td>' + (r.created_at || '').replace('T', ' ').slice(0, 19) + '</td>' +
      '</tr>').join('');
    $('roundsList').innerHTML = '<table>' + head + body + '</table>';
    $('roundsList').querySelectorAll('tr.clickable').forEach(tr => tr.addEventListener('click', () => { $('roundRefInput').value = tr.dataset.ref; show('inspector'); lookupRound(); }));
  } catch (e) { $('roundsList').innerHTML = '<span class="err">'+e.message+'</span>'; }
}

function cardHtml(label, value) { return '<div class="card"><span>'+label+'</span><b>'+fmt(value)+'</b></div>'; }
function tableHtml(rows, cols, onRowClick) {
  if (!rows || !rows.length) return '<p class="muted">no rows</p>';
  const head = '<tr>'+cols.map(c => '<th>'+c+'</th>').join('')+'</tr>';
  const body = rows.map(r => '<tr>'+cols.map(c => '<td>'+fmt(r[c])+'</td>').join('')+'</tr>').join('');
  return '<table>'+head+body+'</table>';
}

// ── ROUND INSPECTOR ──────────────────────────────────────────────────────────
let inspectorRound = null;
let stepIdx = 0;
let playTimer = null;

const SYMBOL_LABELS = {
  TOP_CROWN:'crown', HOURGLASS:'hourglass', RING:'ring', CHALICE:'chalice', RED_GEM:'gem',
  PURPLE_TRIANGLE:'purple', YELLOW_HEX:'yellow', GREEN_TRIANGLE:'green', BLUE_DIAMOND:'diamond',
  SCATTER:'scatter'
};

function symbolImageUrl(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  // MULTI cells use the multi.svg badge plus an overlay value badge.
  if (c.startsWith('MULTI')) return '/assets/symbols/' + encodeURIComponent(c) + '.png';
  return '/assets/symbols/' + encodeURIComponent(c) + '.png';
}

function multiValueFromCode(code) {
  const m = /MULTI(\\d+)/i.exec(String(code || ''));
  return m ? Number(m[1]) : null;
}

async function lookupRound() {
  const ref = $('roundRefInput').value.trim();
  $('inspectorContent').innerHTML = '';
  clearFlash($('inspectorStatus'));
  if (!ref) { flash($('inspectorStatus'), 'paste a Round ID first', false); return; }
  $('inspectorStatus').className = 'muted'; $('inspectorStatus').textContent = 'looking up…'; $('inspectorStatus').hidden = false;
  try {
    const data = await api('/admin/v1/rounds/' + encodeURIComponent(ref));
    inspectorRound = data;
    stepIdx = 0;
    renderInspector();
    $('inspectorStatus').textContent = '';
    $('inspectorStatus').className = 'ok';
  } catch (e) {
    inspectorRound = null;
    if (e.status === 404) renderInspectorEmpty(ref);
    else flash($('inspectorStatus'), e.message, false);
  }
}

function renderInspectorEmpty(ref) {
  $('inspectorContent').innerHTML = '<div class="panel"><h2>Not found</h2>' +
    '<p>No round matches <code>'+ref+'</code> — check that you copied the full ID (it looks like <code>r_…</code>) ' +
    'and that you have permission to view this round.</p></div>';
  $('inspectorStatus').textContent = '';
}

function renderInspector() {
  if (!inspectorRound) return;
  const r = inspectorRound;
  const outcome = r.outcome || {};
  const steps = Array.isArray(outcome.tumble_steps) ? outcome.tumble_steps : [];
  const initialMatrix = outcome.matrix;

  // Total stages = 1 (initial board) + tumble steps
  const totalStages = 1 + steps.length;
  if (stepIdx >= totalStages) stepIdx = totalStages - 1;
  if (stepIdx < 0) stepIdx = 0;

  const wins = Array.isArray(outcome.ways_wins) ? outcome.ways_wins : [];
  const totalSymbolsCaught = wins.reduce((s, w) => s + (Number(w.count) || 0), 0);
  const biggest = wins.slice().sort((a,b) => (Number(b.amount)||0) - (Number(a.amount)||0))[0];
  const multipliers = Array.isArray(outcome.multipliers) ? outcome.multipliers : [];

  // ── TEXT panel
  const text = '' +
  '<div class="panel">' +
    '<h2>Round details</h2>' +
    '<div class="kv">' +
      kv('Round ID', '<code>'+r.round_ref+'</code>') +
      kv('Operator', r.operator ? (r.operator.name + ' <span class="muted">('+r.operator.slug+')</span>') : r.operator_id) +
      kv('Game', r.game ? (r.game.title + ' <span class="muted">'+r.game.code+'</span>') : r.game_id) +
      kv('Math config', r.math_config ? (r.math_config.version + ' · RTP ' + r.math_config.theoretical_rtp + '% · ' + r.math_config.status) : r.math_config_id) +
      kv('Currency', r.currency || '—') +
      kv('Bet', fmtMoney(r.bet_amount) + (r.ante_enabled ? ' (ante)' : '')) +
      kv('Bet charged', fmtMoney(r.bet_charged)) +
      kv('Total win', '<b'+(r.total_win > 0 ? ' class="ok"' : '')+'>'+fmtMoney(r.total_win)+'</b>') +
      kv('Multiplier applied', r.multiplier_applied + '×') +
      kv('Free spin?', r.is_free_spin ? 'yes' : 'no') +
      kv('Free spins awarded', outcome.free_spins_awarded ?? 0) +
      kv('Scatters', outcome.scatter_count ?? 0) +
      kv('Status', r.status) +
      kv('Created at', r.created_at) +
      kv('Outcome hash', '<code>'+r.outcome_hash+'</code>') +
      kv('RNG', r.rng_algo + ' (seed ref)') +
      kv('Seq', r.chain?.seq) +
    '</div>' +
  '</div>' +
  '<div class="panel">' +
    '<h2>What the player caught</h2>' +
    '<div class="cards">' +
      cardHtml('symbols caught', totalSymbolsCaught) +
      cardHtml('clusters', wins.length) +
      cardHtml('biggest cluster', biggest ? (biggest.symbol+' ×'+biggest.count+' = '+fmtMoney(biggest.amount)) : '—') +
      cardHtml('multipliers', multipliers.length) +
      cardHtml('tumble steps', steps.length) +
    '</div>' +
    (outcome.free_spins_awarded ? '<div class="banner fs">🎁 Free spins triggered: '+outcome.free_spins_awarded+'</div>' : '') +
    (r.is_free_spin ? '<div class="banner bonus">⭐ This spin was a FREE SPIN</div>' : '') +
    '<h2 style="margin-top:14px;">Per-step breakdown</h2>' +
    '<div class="breakdown">' + buildBreakdown(steps) + '</div>' +
  '</div>';

  // ── VISUAL panel
  const visual = '' +
  '<div class="panel">' +
    '<h2>Visual playback</h2>' +
    renderStageHtml(outcome, initialMatrix, steps, stepIdx) +
    renderStepControls(totalStages) +
  '</div>';

  $('inspectorContent').innerHTML = '<div class="inspector">'+text+visual+'</div>';
  bindStepControls(totalStages);
}

function kv(k, v) { return '<span>'+k+'</span><div>'+(v ?? '')+'</div>'; }

function buildBreakdown(steps) {
  if (!steps.length) return '<p class="muted">no tumble steps (no win on initial board)</p>';
  return steps.map((s, i) => {
    const wins = (s.ways_wins || []).map(w => '<li>'+w.symbol+' × '+w.count+' → '+fmtMoney(w.payout)+'× = '+fmtMoney(w.amount)+'</li>').join('');
    const mults = (s.multipliers || []).length ? ('<li>multipliers caught: ' + (s.multipliers || []).map(m => (multiValueFromCode((m).code) || m.value)+'× @ ['+m.row+','+m.col+']').join(', ') + '</li>') : '';
    const winPos = (s.winning_positions || []).length;
    return '<details '+(i===0?'open':'')+'><summary>Step '+(i+1)+' · win '+fmtMoney(s.win_total)+' · '+winPos+' cells highlighted</summary>'
      + '<ul>'+wins+mults+'</ul></details>';
  }).join('');
}

function renderStageHtml(outcome, initialMatrix, steps, idx) {
  // Stage 0 = initial board; stage k>=1 = tumble step k-1 (post-cascade)
  let matrix, winningPositions = [], stepWin = 0, stepMultipliers = [], stepLabel = '';
  if (idx === 0) {
    matrix = initialMatrix; stepLabel = 'Initial board';
  } else {
    const s = steps[idx - 1] || {};
    matrix = s.matrix;
    winningPositions = s.winning_positions || [];
    stepWin = s.win_total || 0;
    stepMultipliers = s.multipliers || [];
    stepLabel = 'Tumble step ' + idx + ' / ' + steps.length;
  }
  const rows = matrix?.length ?? 5, cols = matrix?.[0]?.length ?? 6;
  const winSet = new Set(winningPositions.map(p => p.row+','+p.col));
  // Multipliers can also appear in outcome.multipliers (post-roll). For per-step
  // highlight we use stepMultipliers if present, otherwise none for stage 0.
  const multiMap = new Map();
  for (const m of stepMultipliers) {
    if (m && typeof m.row === 'number' && typeof m.col === 'number') {
      multiMap.set(m.row+','+m.col, (m.value ?? multiValueFromCode(m.code) ?? '×'));
    }
  }

  let html = '<div class="totals">' +
    '<div class="t">Stage: <b>'+stepLabel+'</b></div>' +
    (idx > 0 ? '<div class="t">Step win: <b class="ok">+'+fmtMoney(stepWin)+'</b></div>' : '') +
    '<div class="t">Running total: <b>'+fmtMoney(runningTotal(steps, idx))+'</b></div>' +
    '<div class="t">Final win: <b>'+fmtMoney(outcome.total_win || 0)+'</b></div>' +
    (outcome.multiplier_applied && outcome.multiplier_applied !== 1 ? '<div class="t">Multiplier applied: <b>'+outcome.multiplier_applied+'×</b></div>' : '') +
  '</div>';

  html += '<div class="matrix" style="grid-template-columns: repeat('+cols+',1fr); margin-top:10px;">';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sym = matrix?.[r]?.[c];
      const isWin = winSet.has(r+','+c);
      const isScatter = String(sym||'').toUpperCase() === 'SCATTER';
      const multiBadge = multiMap.get(r+','+c) ?? (String(sym||'').toUpperCase().startsWith('MULTI') ? multiValueFromCode(sym) : null);
      const url = sym ? symbolImageUrl(sym) : null;
      html += '<div class="cell ' + (isWin?'win ':'') + (isScatter?'scatter':'') + '" data-rc="'+r+','+c+'">';
      if (url) html += '<img src="'+url+'" alt="'+sym+'" onerror="this.style.display=\\'none\\'; this.parentElement.querySelector(\\'.lbl\\').style.display=\\'block\\';"/>';
      html += '<span class="lbl" style="display:'+(url?'none':'block')+';">'+(SYMBOL_LABELS[String(sym||'').toUpperCase()] || sym || '')+'</span>';
      if (multiBadge != null) html += '<span class="mbadge">'+multiBadge+'×</span>';
      html += '</div>';
    }
  }
  html += '</div>';
  return html;
}

function runningTotal(steps, idx) {
  if (idx === 0) return 0;
  let s = 0;
  for (let i = 0; i < idx; i++) s += Number(steps[i]?.win_total || 0);
  return s;
}

function renderStepControls(totalStages) {
  return '<div class="step-ctrl">' +
    '<button class="ghost" id="prevStep">⏮ Prev</button>' +
    '<button id="playStep">▶ Play</button>' +
    '<button class="ghost" id="nextStep">Next ⏭</button>' +
    '<span class="muted">stage <b id="stepLabel">'+(stepIdx+1)+'</b> / '+totalStages+'</span>' +
  '</div>';
}

function bindStepControls(totalStages) {
  const goto = (i) => { stepIdx = Math.max(0, Math.min(totalStages-1, i)); renderInspector(); };
  $('prevStep').onclick = () => { stopPlay(); goto(stepIdx - 1); };
  $('nextStep').onclick = () => { stopPlay(); goto(stepIdx + 1); };
  $('playStep').onclick = () => togglePlay(totalStages);
  document.addEventListener('keydown', handleKeyNav);
}
function handleKeyNav(e) {
  if ($('inspectorView').hidden) return;
  if (e.target && /(INPUT|TEXTAREA|SELECT)/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') document.getElementById('prevStep')?.click();
  if (e.key === 'ArrowRight') document.getElementById('nextStep')?.click();
  if (e.key === ' ') { e.preventDefault(); document.getElementById('playStep')?.click(); }
}
function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; const b = $('playStep'); if (b) b.textContent = '▶ Play'; } }
function togglePlay(totalStages) {
  if (playTimer) { stopPlay(); return; }
  const b = $('playStep'); if (b) b.textContent = '⏸ Pause';
  playTimer = setInterval(() => {
    if (stepIdx >= totalStages - 1) { stopPlay(); return; }
    stepIdx += 1; renderInspector();
  }, 900);
}

// ── ONBOARDING ────────────────────────────────────────────────────────────────
async function refreshOnboardingDropdowns() {
  try {
    if (state.scope === 'provider') {
      const ops = await api('/admin/v1/operators'); state.operators = ops.operators || [];
    }
  } catch {/* ignore */}
  try {
    const data = await api('/admin/v1/games'); state.games = data.games || []; state.mathConfigs = data.math_configs || [];
  } catch {/* ignore */}

  const fillOps = (selId) => {
    const sel = $(selId); if (!sel) return;
    sel.innerHTML = state.operators.map(o => '<option value="'+o.id+'">'+o.slug+' — '+o.name+'</option>').join('');
  };
  ['domainOp','credOp','asnOp','launchOp'].forEach(fillOps);

  const fillGames = (selId) => {
    const sel = $(selId); if (!sel) return;
    sel.innerHTML = state.games.map(g => '<option value="'+g.id+'">'+g.code+' — '+g.title+'</option>').join('');
  };
  ['mcGame','asnGame'].forEach(fillGames);

  const sel = $('asnConfig');
  if (sel) sel.innerHTML = state.mathConfigs.map(c => '<option value="'+c.id+'">'+c.version+' · '+c.status+' · RTP '+c.theoretical_rtp+'%</option>').join('');
}

async function createOperator() {
  clearFlash($('opResult'));
  const name = $('opName').value.trim(), slug = $('opSlug').value.trim(), default_currency = $('opCurrency').value.trim() || 'GEL';
  if (!name || !slug) return flash($('opResult'), 'name and slug are required', false);
  try {
    const data = await api('/admin/v1/operators', { method: 'POST', body: { name, slug, default_currency } });
    flash($('opResult'), 'created operator '+data.operator.slug+' ('+data.operator.id+')', true);
    await refreshOnboardingDropdowns();
  } catch (e) { flash($('opResult'), e.message, false); }
}

async function addDomain() {
  clearFlash($('domainResult'));
  const operatorId = $('domainOp').value, domain = $('domainHost').value.trim(), environment = $('domainEnv').value;
  if (!operatorId || !domain) return flash($('domainResult'), 'operator + domain required', false);
  try {
    const data = await api('/admin/v1/operators/'+operatorId+'/domains', { method: 'POST', body: { domain, environment } });
    flash($('domainResult'), 'allowlisted '+data.domain.domain+' ('+data.domain.environment+')', true);
  } catch (e) { flash($('domainResult'), e.message, false); }
}

async function issueCredential() {
  clearFlash($('credResult'));
  const operatorId = $('credOp').value, environment = $('credEnv').value;
  if (!operatorId) return flash($('credResult'), 'operator required', false);
  try {
    const data = await api('/admin/v1/operators/'+operatorId+'/credentials', { method: 'POST', body: { environment } });
    $('credResult').hidden = false; $('credResult').className = 'status ok';
    $('credResult').innerHTML = 'issued credential (secret shown ONCE — copy now):' +
      '<pre class="code">api_key_id: '+data.credential.api_key_id+'\\napi_secret: '+data.api_secret+'</pre>';
  } catch (e) { flash($('credResult'), e.message, false); }
}

async function registerGame() {
  clearFlash($('gameResult'));
  const code = $('gameCode').value.trim(), title = $('gameTitle').value.trim();
  if (!code || !title) return flash($('gameResult'), 'code + title required', false);
  try {
    const data = await api('/admin/v1/games', { method: 'POST', body: { code, title } });
    flash($('gameResult'), 'registered game '+data.game.code+' ('+data.game.id+')', true);
    await refreshOnboardingDropdowns();
  } catch (e) { flash($('gameResult'), e.message, false); }
}

async function createMathConfig() {
  clearFlash($('mcResult'));
  const body = {
    game_id: $('mcGame').value,
    version: $('mcVersion').value.trim(),
    rtp_profile_key: $('mcKey').value.trim(),
    theoretical_rtp: Number($('mcRtp').value),
    config_hash: $('mcHash').value.trim()
  };
  if (!body.game_id || !body.version || !body.rtp_profile_key || !body.config_hash) return flash($('mcResult'), 'all fields required', false);
  try {
    const created = await api('/admin/v1/math-configs', { method: 'POST', body });
    const approved = await api('/admin/v1/math-configs/'+created.math_config.id+'/approve', { method: 'POST', body: {} });
    flash($('mcResult'), 'approved math config '+approved.math_config.id+' ('+approved.math_config.status+')', true);
    await refreshOnboardingDropdowns();
  } catch (e) { flash($('mcResult'), e.message, false); }
}

async function assignGame() {
  clearFlash($('asnResult'));
  const operatorId = $('asnOp').value, game_id = $('asnGame').value, math_config_id = $('asnConfig').value;
  const currency = $('asnCurrency').value.trim() || 'GEL';
  const allowed_bets = $('asnBets').value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  if (!operatorId || !game_id || !math_config_id || !allowed_bets.length) return flash($('asnResult'), 'operator, game, config + at least one bet required', false);
  try {
    const data = await api('/admin/v1/operators/'+operatorId+'/assignments', { method: 'POST', body: { game_id, math_config_id, currency, allowed_bets } });
    flash($('asnResult'), 'assigned ('+data.operator_game.id+', allowed bets: '+data.operator_game.allowed_bets.join(', ')+')', true);
  } catch (e) { flash($('asnResult'), e.message, false); }
}

async function launchDemo() {
  clearFlash($('launchResult'));
  const operatorId = $('launchOp').value;
  const body = {
    game_code: $('launchGame').value.trim(),
    operator_player_id: $('launchPlayer').value.trim(),
    currency: $('launchCurrency').value.trim(),
    origin: $('launchOrigin').value.trim()
  };
  if (!operatorId || !body.game_code || !body.operator_player_id || !body.currency || !body.origin) return flash($('launchResult'), 'all fields required (origin must be an allowlisted domain)', false);
  try {
    const data = await api('/admin/v1/operators/'+operatorId+'/launch-demo', { method: 'POST', body });
    $('launchResult').hidden = false; $('launchResult').className = 'status ok';
    $('launchResult').innerHTML = 'launch ready — <a target="_blank" rel="noopener" href="'+data.launch_url+'">open player ↗</a>';
  } catch (e) { flash($('launchResult'), e.message, false); }
}

// ── REPORTS ──────────────────────────────────────────────────────────────────
async function loadReports() {
  const opId = $('repOp').value.trim();
  const qs = opId ? ('?operator_id=' + encodeURIComponent(opId)) : '';
  try {
    const s = await api('/admin/v1/reports/summary'+qs);
    $('repSummary').innerHTML = '<div class="cards">' +
      cardHtml('rounds', s.rounds) + cardHtml('total bet', fmtMoney(s.total_bet)) +
      cardHtml('total win', fmtMoney(s.total_win)) + cardHtml('GGR', fmtMoney(s.ggr)) +
      cardHtml('hold %', s.hold_percent) + '</div>';
  } catch (e) { $('repSummary').innerHTML = '<span class="err">'+e.message+'</span>'; }
  try {
    const r = await api('/admin/v1/reports/rtp'+qs);
    $('repRtp').innerHTML = '<div class="cards">' +
      cardHtml('rounds', r.rounds) + cardHtml('total bet', fmtMoney(r.total_bet)) +
      cardHtml('total win', fmtMoney(r.total_win)) + cardHtml('actual RTP %', r.actual_rtp_percent) + '</div>';
  } catch (e) { $('repRtp').innerHTML = '<span class="err">'+e.message+'</span>'; }
  try {
    const g = await api('/admin/v1/reports/ggr'+qs);
    $('repGgr').innerHTML = tableHtml(g.ggr_by_day || [], ['date','rounds','total_bet','total_win','ggr']);
  } catch (e) { $('repGgr').innerHTML = '<span class="err">'+e.message+'</span>'; }
  try {
    const re = await api('/admin/v1/reports/reconciliation'+qs);
    $('repRecon').innerHTML = '<div class="cards">' +
      cardHtml('ok', re.ok ? 'yes' : 'no') + cardHtml('rounds bet', fmtMoney(re.rounds_total_bet)) +
      cardHtml('rounds win', fmtMoney(re.rounds_total_win)) + cardHtml('debits (tx)', fmtMoney(re.tx_debits)) +
      cardHtml('credits (tx)', fmtMoney(re.tx_credits)) + cardHtml('rollbacks (tx)', fmtMoney(re.tx_rollbacks)) +
      cardHtml('bet vs debit diff', fmtMoney(re.bet_vs_debit_diff)) + cardHtml('win vs credit diff', fmtMoney(re.win_vs_credit_diff)) +
      '</div>';
  } catch (e) { $('repRecon').innerHTML = '<span class="err">'+e.message+'</span>'; }
  try {
    const f = await api('/admin/v1/transactions/failed'+qs);
    $('repFailed').innerHTML = tableHtml(f.failed_settlements || [], ['round_ref','type','amount','currency','status','error_code']);
  } catch (e) { $('repFailed').innerHTML = '<span class="err">'+e.message+'</span>'; }
}

function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── ROUND: verify / transactions / lifecycle / dispute ─────────────────────────
async function verifyRound() {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id above first', false); return; }
  out.hidden = false; out.className = 'status'; out.textContent = 'verifying…';
  try {
    const v = await api('/admin/v1/rounds/' + encodeURIComponent(ref) + '/verify');
    out.className = 'status ' + (v.verdict === 'tampered' ? 'err' : 'ok');
    out.innerHTML = '<b>Verdict: ' + v.verdict.toUpperCase() + '</b>' +
      '<div class="cards" style="margin-top:8px;">' +
        cardHtml('outcome ok', v.outcome_ok === null ? 'n/a' : (v.outcome_ok ? 'yes' : 'NO')) +
        cardHtml('chain ok', v.chain_ok ? 'yes' : 'NO') + '</div>' +
      '<pre class="code">stored:     ' + v.stored_hash + '\\nrecomputed: ' + (v.recomputed_hash || '(not replayed)') + '</pre>' +
      (v.notes && v.notes.length ? '<p class="muted">' + esc(v.notes.join(' · ')) + '</p>' : '');
  } catch (e) { flash(out, e.message, false); }
}

async function loadRoundTx() {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id above first', false); return; }
  try {
    const d = await api('/admin/v1/rounds/' + encodeURIComponent(ref) + '/transactions');
    out.hidden = false; out.className = 'status';
    out.innerHTML = '<p>effective status: <b>' + d.effective_status + '</b> (recorded: ' + d.recorded_status + ')</p>' +
      tableHtml(d.transactions, ['type','amount','currency','status','error_code','idempotency_key']);
  } catch (e) { flash(out, e.message, false); }
}

async function voidRoundAction() { await lifecycleAction('void'); }
async function settleRoundAction() { await lifecycleAction('settle'); }
async function lifecycleAction(kind) {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id first', false); return; }
  const reason = prompt('Reason for ' + kind + ' on ' + ref + ':');
  if (reason === null || !reason.trim()) return;
  try {
    const r = await api('/admin/v1/rounds/' + encodeURIComponent(ref) + '/' + kind, { method: 'POST', body: { reason: reason.trim() } });
    flash(out, kind + ' done — effective status: ' + r.effective_status + (r.already ? ' (no-op)' : '') + '. ' + (r.notes || []).join('; '), true);
  } catch (e) { flash(out, e.message, false); }
}

async function raiseDisputeAction(kind) {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id first', false); return; }
  const reason = prompt('Reason for requesting ' + kind + ' on ' + ref + ':');
  if (reason === null || !reason.trim()) return;
  try {
    const r = await api('/admin/v1/disputes', { method: 'POST', body: { round_ref: ref, kind, reason: reason.trim() } });
    flash(out, 'dispute raised (' + r.dispute.id + ', ' + r.dispute.status + ') — a provider admin will review it.', true);
  } catch (e) { flash(out, e.message, false); }
}

// ── GAMES on/off ───────────────────────────────────────────────────────────────
async function loadGames() {
  const el = $('gamesList'); const opId = $('gamesOp').value.trim();
  const qs = opId ? ('?operator_id=' + encodeURIComponent(opId)) : '';
  try {
    const d = await api('/admin/v1/operator-games' + qs);
    const rows = d.operator_games || [];
    if (!rows.length) { el.innerHTML = '<p class="muted">no game assignments</p>'; return; }
    el.innerHTML = '<table><tr><th>assignment</th><th>game_id</th><th>currency</th><th>bets</th><th>status</th><th></th></tr>' +
      rows.map(g => '<tr><td><code>' + g.id.slice(0,8) + '…</code></td><td>' + g.game_id.slice(0,8) + '…</td><td>' + g.currency + '</td><td>' + g.allowed_bets.join(', ') + '</td>' +
        '<td>' + (g.status === 'enabled' ? '<span class="ok">enabled</span>' : '<span class="err">disabled</span>') + '</td>' +
        '<td><button class="ghost" data-id="' + g.id + '" data-to="' + (g.status === 'enabled' ? 'disabled' : 'enabled') + '">' + (g.status === 'enabled' ? 'Turn OFF' : 'Turn ON') + '</button></td></tr>').join('') + '</table>';
    el.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => toggleGame(b.dataset.id, b.dataset.to)));
  } catch (e) { el.innerHTML = '<span class="err">' + e.message + '</span>'; }
}
async function toggleGame(id, to) {
  try { await api('/admin/v1/operator-games/' + id + '/status', { method: 'POST', body: { status: to } }); loadGames(); }
  catch (e) { alert(e.message); }
}

// ── DISPUTES ───────────────────────────────────────────────────────────────────
async function loadDisputes() {
  const el = $('disputesList'); const opId = $('dspOp').value.trim(); const st = $('dspStatus').value;
  const params = []; if (opId) params.push('operator_id=' + encodeURIComponent(opId)); if (st) params.push('status=' + st);
  const qs = params.length ? ('?' + params.join('&')) : '';
  try {
    const d = await api('/admin/v1/disputes' + qs); const rows = d.disputes || [];
    if (!rows.length) { el.innerHTML = '<p class="muted">no disputes</p>'; return; }
    const prov = state.scope === 'provider';
    el.innerHTML = '<table><tr><th>id</th><th>round</th><th>kind</th><th>reason</th><th>status</th><th>by</th><th></th></tr>' +
      rows.map(x => '<tr><td><code>' + x.id + '</code></td><td class="clickable" data-ref="' + x.round_ref + '"><code>' + x.round_ref + '</code></td><td>' + x.kind + '</td><td>' + esc(x.reason) + '</td>' +
        '<td>' + x.status + '</td><td>' + esc(x.requested_by) + '</td>' +
        '<td>' + ((prov && x.status === 'open') ? ('<button data-app="' + x.id + '">Approve</button> <button class="danger" data-rej="' + x.id + '">Reject</button>') : '') + '</td></tr>').join('') + '</table>';
    el.querySelectorAll('button[data-app]').forEach(b => b.addEventListener('click', () => approveDispute(b.dataset.app)));
    el.querySelectorAll('button[data-rej]').forEach(b => b.addEventListener('click', () => rejectDispute(b.dataset.rej)));
    el.querySelectorAll('td[data-ref]').forEach(td => td.addEventListener('click', () => { $('roundRefInput').value = td.dataset.ref; show('inspector'); lookupRound(); }));
  } catch (e) { el.innerHTML = '<span class="err">' + e.message + '</span>'; }
}
async function approveDispute(id) { const note = prompt('Approval note (optional):') || ''; try { await api('/admin/v1/disputes/' + id + '/approve', { method: 'POST', body: { note } }); loadDisputes(); } catch (e) { alert(e.message); } }
async function rejectDispute(id) { const note = prompt('Rejection reason (required):'); if (note === null || !note.trim()) return; try { await api('/admin/v1/disputes/' + id + '/reject', { method: 'POST', body: { note: note.trim() } }); loadDisputes(); } catch (e) { alert(e.message); } }

// ── PLAYER lookup ──────────────────────────────────────────────────────────────
async function loadPlayer() {
  const el = $('playerRounds'); const st = $('plStatus');
  const opId = $('plOp').value.trim(); const pid = $('plPlayer').value.trim();
  if (!pid) { flash(st, 'enter a player id', false); return; }
  const qs = opId ? ('?operator_id=' + encodeURIComponent(opId)) : '';
  st.hidden = false; st.className = 'muted'; st.textContent = 'loading…';
  try {
    const d = await api('/admin/v1/players/' + encodeURIComponent(pid) + '/rounds' + qs);
    st.textContent = d.count + ' rounds';
    if (!d.rounds.length) { el.innerHTML = '<p class="muted">no rounds for this player</p>'; return; }
    el.innerHTML = '<table><tr><th>round</th><th>bet</th><th>win</th><th>free?</th><th>status</th><th>created</th></tr>' +
      d.rounds.map(r => '<tr class="clickable" data-ref="' + r.round_ref + '"><td><code>' + r.round_ref + '</code></td><td>' + fmtMoney(r.bet_charged) + '</td>' +
        '<td>' + (r.total_win > 0 ? '<span class="ok">+' + fmtMoney(r.total_win) + '</span>' : fmtMoney(r.total_win)) + '</td><td>' + (r.is_free_spin ? 'yes' : '') + '</td>' +
        '<td>' + (r.effective_status !== r.status ? ('<span class="err">' + r.effective_status + '</span>') : r.status) + '</td><td>' + (r.created_at || '').replace('T',' ').slice(0,19) + '</td></tr>').join('') + '</table>';
    el.querySelectorAll('tr.clickable').forEach(tr => tr.addEventListener('click', () => { $('roundRefInput').value = tr.dataset.ref; show('inspector'); lookupRound(); }));
  } catch (e) { flash(st, e.message, false); el.innerHTML = ''; }
}

// ── OPERATORS management (provider) ────────────────────────────────────────────
function renderOperators() {
  const el = $('operatorsList');
  const rows = state.operators;
  if (!rows.length) { el.innerHTML = '<p class="muted">no operators</p>'; return; }
  el.innerHTML = '<table><tr><th>slug</th><th>name</th><th>status</th><th>ccy</th><th>actions</th></tr>' +
    rows.map(o => '<tr><td>' + esc(o.slug) + '</td><td>' + esc(o.name) + '</td><td>' + o.status + '</td><td>' + o.default_currency + '</td>' +
      '<td>' + (o.status === 'suspended'
         ? '<button data-act="live" data-op="' + o.id + '">Reactivate</button>'
         : '<button class="danger" data-act="suspended" data-op="' + o.id + '">Suspend</button>') + ' ' +
        '<button class="ghost" data-creds="' + o.id + '">Credentials</button></td></tr>').join('') + '</table>' +
    '<div id="opManageOut"></div>';
  el.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', () => setOperatorStatus(b.dataset.op, b.dataset.act)));
  el.querySelectorAll('button[data-creds]').forEach(b => b.addEventListener('click', () => loadCredentials(b.dataset.creds)));
}
async function setOperatorStatus(id, status) {
  if (status === 'suspended' && !confirm('Suspend this operator? New sessions & spins will be blocked immediately.')) return;
  try { await api('/admin/v1/operators/' + id + '/status', { method: 'POST', body: { status } }); refreshDashboard(); } catch (e) { alert(e.message); }
}
async function loadCredentials(id) {
  const out = $('opManageOut');
  try {
    const d = await api('/admin/v1/operators/' + id + '/credentials'); const rows = d.credentials || [];
    out.innerHTML = '<div class="panel"><h2>Credentials</h2>' + (rows.length
      ? ('<table><tr><th>api_key_id</th><th>env</th><th>status</th><th>last4</th><th></th></tr>' +
        rows.map(c => '<tr><td><code>' + c.api_key_id + '</code></td><td>' + c.environment + '</td><td>' + c.status + '</td><td>' + c.secret_last4 + '</td>' +
          '<td>' + (c.status !== 'revoked' ? ('<button class="danger" data-rev="' + id + '|' + c.api_key_id + '">Revoke</button> <button class="ghost" data-rot="' + id + '|' + c.api_key_id + '">Rotate</button>') : '') + '</td></tr>').join('') + '</table>')
      : '<p class="muted">no credentials</p>') + '</div>';
    out.querySelectorAll('button[data-rev]').forEach(b => b.addEventListener('click', () => revokeCred(b.dataset.rev)));
    out.querySelectorAll('button[data-rot]').forEach(b => b.addEventListener('click', () => rotateCred(b.dataset.rot)));
  } catch (e) { out.innerHTML = '<span class="err">' + e.message + '</span>'; }
}
async function revokeCred(pair) { const parts = pair.split('|'); const op = parts[0], key = parts[1]; if (!confirm('Revoke ' + key + '? This is immediate and permanent.')) return; try { await api('/admin/v1/operators/' + op + '/credentials/' + key + '/revoke', { method: 'POST', body: {} }); loadCredentials(op); } catch (e) { alert(e.message); } }
async function rotateCred(pair) { const parts = pair.split('|'); const op = parts[0], key = parts[1]; try { const d = await api('/admin/v1/operators/' + op + '/credentials/' + key + '/rotate', { method: 'POST', body: {} }); alert('New api_key_id: ' + d.credential.api_key_id + '\\napi_secret (shown once):\\n' + d.api_secret); loadCredentials(op); } catch (e) { alert(e.message); } }

// ── boot ─────────────────────────────────────────────────────────────────────
if (state.token) {
  // Try silent restore; otherwise show login.
  (async () => {
    try {
      const ops = await fetch('/admin/v1/operators', { headers: { authorization: 'Bearer ' + state.token } });
      state.scope = ops.status === 200 ? 'provider' : (ops.status === 403 ? 'operator' : null);
      if (state.scope) { afterSignIn(); return; }
    } catch {/* fall through */}
    show('login');
  })();
} else {
  show('login');
}
</script>
</body></html>`;

const adminConsoleRoutes: FastifyPluginAsync = async (app) => {
  // The portal HTML/JS is inlined, so never let a browser serve a stale copy —
  // otherwise an old build's sign-in logic (or a fixed bug) lingers after a deploy.
  const serve = async (_req: unknown, reply: import("fastify").FastifyReply) =>
    reply.type("text/html").header("cache-control", "no-store").send(PAGE);
  app.get("/", serve);
  app.get("/admin", serve);
};

export default adminConsoleRoutes;
