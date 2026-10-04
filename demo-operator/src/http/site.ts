import type { FastifyPluginAsync } from "fastify";
import type { DemoOperatorConfig } from "../config";

/**
 * The demo casino's front end: one static page, vanilla JS, no framework — same
 * spirit as the platform's own admin console and /play page (no build step).
 * Auth uses a bearer token in localStorage (exactly like the admin console's
 * `state.token`), not cookies, so no extra Fastify plugin is needed for sessions.
 */
export default function siteRoutes(cfg: DemoOperatorConfig): FastifyPluginAsync {
  return async (app) => {
    app.get("/", async (_req, reply) => {
      reply.type("text/html").send(PAGE(cfg));
    });
    app.get("/back-office", async (_req, reply) => {
      reply.type("text/html").send(ADMIN_PAGE(cfg));
    });
  };
}

const ADMIN_PAGE = (cfg: DemoOperatorConfig): string => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>Casino Back Office</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e8eaf0; --muted:#8b93a7; --accent:#4caf78; }
  body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,sans-serif; }
  header { padding:14px 20px; border-bottom:1px solid var(--line); display:flex; gap:20px; align-items:center; }
  header h1 { font-size:18px; margin:0; }
  nav button { background:transparent; border:none; color:var(--muted); font-weight:600; padding:8px 4px; border-bottom:2px solid transparent; cursor:pointer; }
  nav button.active { color:var(--text); border-color:var(--accent); }
  main { max-width:1000px; margin:0 auto; padding:20px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:18px; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; margin-top:10px; }
  th, td { text-align:left; padding:8px; border-bottom:1px solid var(--line); }
  input { background:#0c0e12; border:1px solid var(--line); color:var(--text); padding:6px 10px; border-radius:4px; margin-right:5px; }
  button.action { background:var(--accent); color:#fff; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; }
  button.danger { background:#e2574c; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<header>
  <h1>🎰 Casino Back Office</h1>
  <nav id="nav">
    <button data-view="players" class="active">Players</button>
    <button data-view="transactions">Transactions</button>
    <button data-view="providers">Providers</button>
  </nav>
</header>
<main>
  <section id="playersView">
    <div class="panel">
      <h2>Registered Players</h2>
      <div id="playersList">loading...</div>
    </div>
  </section>

  <section id="transactionsView" hidden>
    <div class="panel">
      <h2>All Transactions</h2>
      <div id="transactionsList">loading...</div>
    </div>
  </section>

  <section id="providersView" hidden>
    <div class="panel">
      <h2>Connected Providers</h2>
      <div id="providersList">loading...</div>
      <h3 style="margin-top:30px;">Add Provider</h3>
      <div>
        <input id="pName" placeholder="Name" />
        <input id="pPlatformUrl" placeholder="Platform URL" />
        <input id="pOperatorId" placeholder="Operator ID" />
        <input id="pApiKeyId" placeholder="API Key ID" />
        <input id="pApiSecret" placeholder="API Secret" />
        <input id="pWebhookSecret" placeholder="Webhook Secret" />
        <input id="pAdminToken" placeholder="Admin Token" />
        <button class="action" onclick="addProvider()">Add</button>
      </div>
      <p id="pErr" style="color:#e2574c;"></p>
    </div>
  </section>
</main>
<script>
  async function api(path, opts={}) {
    const res = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'request failed');
    return data;
  }
  function $(id) { return document.getElementById(id); }

  const VIEWS = ['players', 'transactions', 'providers'];
  function show(view) {
    VIEWS.forEach(v => $(v + 'View').hidden = true);
    $(view + 'View').hidden = false;
    document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
    if (view === 'players') loadPlayers();
    if (view === 'transactions') loadTransactions();
    if (view === 'providers') loadProviders();
  }
  document.querySelectorAll('#nav button[data-view]').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

  async function loadPlayers() {
    try {
      const d = await api('/api/admin/players');
      $('playersList').innerHTML = '<table><tr><th>ID</th><th>Email</th><th>Balance</th><th>Joined</th></tr>' +
        d.players.map(p => '<tr><td>' + p.id + '</td><td>' + p.email + '</td><td>' + p.balance + '</td><td>' + p.createdAt + '</td></tr>').join('') + '</table>';
    } catch (e) { $('playersList').textContent = e.message; }
  }

  async function loadTransactions() {
    try {
      const d = await api('/api/admin/transactions');
      $('transactionsList').innerHTML = '<table><tr><th>ID</th><th>Player</th><th>Type</th><th>Amount</th><th>Round</th><th>Date</th></tr>' +
        d.transactions.map(t => '<tr><td>' + t.id + '</td><td>' + t.playerId + '</td><td>' + t.type + '</td><td>' + t.amount + ' ' + t.currency + '</td><td>' + t.roundRef + '</td><td>' + t.createdAt + '</td></tr>').join('') + '</table>';
    } catch (e) { $('transactionsList').textContent = e.message; }
  }

  async function loadProviders() {
    try {
      const d = await api('/api/admin/providers');
      $('providersList').innerHTML = '<table><tr><th>Name</th><th>URL</th><th>Operator ID</th><th>Actions</th></tr>' +
        d.providers.map(p => '<tr><td>' + p.name + '</td><td>' + p.platformUrl + '</td><td>' + p.operatorId + '</td>' +
        '<td><button class="action danger" onclick="deleteProvider(\\'' + p.id + '\\')">Delete</button></td></tr>').join('') + '</table>';
    } catch (e) { $('providersList').textContent = e.message; }
  }

  async function addProvider() {
    const body = {
      name: $('pName').value, platformUrl: $('pPlatformUrl').value, operatorId: $('pOperatorId').value,
      apiKeyId: $('pApiKeyId').value, apiSecret: $('pApiSecret').value, webhookSecret: $('pWebhookSecret').value,
      adminToken: $('pAdminToken').value
    };
    try {
      await api('/api/admin/providers', { method: 'POST', body: JSON.stringify(body) });
      $('pErr').textContent = '';
      loadProviders();
    } catch (e) { $('pErr').textContent = e.message; }
  }

  async function deleteProvider(id) {
    if (!confirm('Delete provider?')) return;
    try {
      await api('/api/admin/providers/' + id, { method: 'DELETE' });
      loadProviders();
    } catch(e) { alert(e.message); }
  }

  // Init
  show('players');
</script>
</body></html>`;

const PAGE = (cfg: DemoOperatorConfig): string => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Lumina Sandbox Casino</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --line:#262b36; --text:#e8eaf0; --muted:#8b93a7; --accent:#f5c518; --ok:#4caf78; --err:#e2574c; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 system-ui,sans-serif; }
  header { display:flex; align-items:center; justify-content:space-between; padding:14px 20px; border-bottom:1px solid var(--line); }
  header h1 { font-size:18px; margin:0; }
  header h1 span { color:var(--accent); }
  #balancePill { background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:6px 14px; font-weight:600; }
  main { max-width:900px; margin:0 auto; padding:20px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:18px; margin-bottom:16px; }
  .row { display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
  input { background:#0c0e12; border:1px solid var(--line); color:var(--text); padding:9px 10px; border-radius:6px; }
  button { background:var(--accent); color:#1a1a1a; border:none; padding:9px 16px; border-radius:6px; font-weight:600; cursor:pointer; }
  button.ghost { background:transparent; border:1px solid var(--line); color:var(--text); }
  button:disabled { opacity:.5; cursor:default; }
  .muted { color:var(--muted); }
  .err { color:var(--err); }
  .ok { color:var(--ok); }
  nav button { background:transparent; border:none; color:var(--muted); font-weight:600; padding:8px 4px; margin-right:14px; border-bottom:2px solid transparent; }
  nav button.active { color:var(--text); border-color:var(--accent); }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px; }
  .game-card { background:#0c0e12; border:1px solid var(--line); border-radius:10px; overflow:hidden; display:flex; flex-direction:column; }
  .game-card img { width:100%; aspect-ratio:1; object-fit:cover; background:#000; }
  .game-card .thumb-fallback { width:100%; aspect-ratio:1; display:flex; align-items:center; justify-content:center; font-size:34px; background:linear-gradient(135deg,#2a2f3a,#0c0e12); }
  .game-card .body { padding:10px; display:flex; flex-direction:column; gap:8px; flex:1; }
  iframe#gameFrame { width:100%; height:70vh; border:0; border-radius:10px; background:#000; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--line); }
  #authErr, #playErr { min-height:1.2em; }
  [hidden] { display:none !important; }
</style>
</head>
<body>
<header>
  <h1>Lumina <span>Sandbox</span> Casino <span class="muted" style="font-weight:400;font-size:12px;">— demo operator</span></h1>
  <div class="row" id="headerRight"></div>
</header>
<main>
  <nav id="nav" hidden>
    <button data-view="lobby">Lobby</button>
    <button data-view="account">My account</button>
  </nav>

  <section id="authView">
    <div class="panel" style="max-width:380px;margin:40px auto;">
      <div class="row" style="margin-bottom:12px;">
        <button id="tabLogin">Sign in</button>
        <button id="tabRegister" class="ghost">Register</button>
      </div>
      <div class="row" style="flex-direction:column;align-items:stretch;">
        <input id="authEmail" placeholder="email" autocomplete="username"/>
        <input id="authPassword" type="password" placeholder="password (8+ chars)" autocomplete="current-password"/>
        <button id="authSubmit" onclick="submitAuth()">Sign in</button>
      </div>
      <p class="err" id="authErr"></p>
      <p class="muted">New accounts start with ${cfg.startingBalance} Demo Credits (${cfg.currency}). No real money anywhere on this site.</p>
    </div>
  </section>

  <section id="lobbyView" hidden>
    <div class="panel">
      <h2>Lobby</h2>
      <p class="muted">Games this Operator currently has enabled — live from the platform, nothing hardcoded.</p>
      <div class="grid" id="lobbyGrid">loading…</div>
    </div>
  </section>

  <section id="playView" hidden>
    <div class="panel">
      <div class="row" style="justify-content:space-between;">
        <button class="ghost" onclick="backToLobby()">← Back to lobby</button>
        <span class="muted" id="playHint">Launched via the platform's signed /operator/v1/launch API.</span>
      </div>
      <p class="err" id="playErr"></p>
      <iframe id="gameFrame" hidden></iframe>
    </div>
  </section>

  <section id="accountView" hidden>
    <div class="panel">
      <h2>My account</h2>
      <div class="row"><b>Balance:</b> <span id="acctBalance">–</span></div>
    </div>
    <div class="panel">
      <h2>Transaction history</h2>
      <div id="txList">loading…</div>
    </div>
  </section>
</main>
<script>${CLIENT_JS}</script>
</body></html>`;

const CLIENT_JS = /* js */ `
const TOKEN_KEY = 'demoop_token';
const state = { token: localStorage.getItem(TOKEN_KEY) || '', player: null, currency: 'GEL', mode: 'login' };

async function api(path, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  if (state.token) headers.authorization = 'Bearer ' + state.token;
  const res = await fetch(path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data.error && data.error.message) || (data.error && data.error.code) || 'request failed');
  return data;
}
function $(id) { return document.getElementById(id); }
function fmtMoney(n) { return (Number(n) || 0).toFixed(2) + ' ' + state.currency; }

function setTab(mode) {
  state.mode = mode;
  $('tabLogin').className = mode === 'login' ? '' : 'ghost';
  $('tabRegister').className = mode === 'register' ? '' : 'ghost';
  $('authSubmit').textContent = mode === 'login' ? 'Sign in' : 'Create account';
  $('authErr').textContent = '';
}
$('tabLogin').addEventListener('click', () => setTab('login'));
$('tabRegister').addEventListener('click', () => setTab('register'));

async function submitAuth() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  $('authErr').textContent = '';
  try {
    const d = await api(state.mode === 'login' ? '/api/login' : '/api/register', { method: 'POST', body: { email, password } });
    signedIn(d);
  } catch (e) { $('authErr').textContent = e.message; }
}

function signedIn(d) {
  if (d.token) { state.token = d.token; localStorage.setItem(TOKEN_KEY, state.token); }
  state.player = d.player; state.currency = d.currency;
  $('authView').hidden = true; $('nav').hidden = false;
  renderHeader();
  show('lobby');
}
function renderHeader() {
  $('headerRight').innerHTML = state.player
    ? '<span id="balancePill">' + fmtMoney(state.player.balance) + '</span> <button class="ghost" onclick="signOut()">Sign out</button>'
    : '';
}
function signOut() {
  state.token = ''; state.player = null; localStorage.removeItem(TOKEN_KEY);
  $('nav').hidden = true; $('headerRight').innerHTML = '';
  hideAllViews(); $('authView').hidden = false;
}

const VIEWS = ['lobby', 'play', 'account'];
function hideAllViews() { VIEWS.forEach(v => { const s = $(v + 'View'); if (s) s.hidden = true; }); }
function show(view) {
  hideAllViews();
  $(view + 'View').hidden = false;
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  if (view === 'lobby') loadLobby();
  if (view === 'account') loadAccount();
}
document.querySelectorAll('#nav button[data-view]').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));

async function loadLobby() {
  const el = $('lobbyGrid');
  try {
    const d = await api('/api/lobby');
    state.currency = d.currency;
    if (!d.games.length) { el.innerHTML = '<p class="muted">No games are live in the lobby right now — check back soon.</p>'; return; }
    el.innerHTML = d.games.map(g => {
      const name = g.display_name || g.title;
      const thumb = g.thumbnail_url
        ? '<img src="' + g.thumbnail_url + '" alt="' + escHtml(name) + '"/>'
        : '<div class="thumb-fallback">🎰</div>';
      return '<div class="game-card">' + thumb +
        '<div class="body"><b>' + escHtml(name) + '</b><span class="muted">bets: ' + g.allowed_bets.join(', ') + ' ' + g.currency + '</span>' +
        '<button data-provider="' + g.provider_id + '" data-code="' + g.game_code + '">Play</button></div></div>';
    }).join('');
    el.querySelectorAll('button[data-code]').forEach(b => b.addEventListener('click', () => play(b.dataset.provider, b.dataset.code)));
  } catch (e) { el.innerHTML = '<span class="err">' + e.message + '</span>'; }
}
function escHtml(s) { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function play(providerId, gameCode) {
  show('play');
  $('playErr').textContent = ''; const frame = $('gameFrame'); frame.hidden = true;
  try {
    const d = await api('/api/play/' + encodeURIComponent(providerId) + '/' + encodeURIComponent(gameCode), { method: 'POST' });
    frame.src = d.launch_url; frame.hidden = false;
  } catch (e) { $('playErr').textContent = e.message; }
}
function backToLobby() { $('gameFrame').src = 'about:blank'; show('lobby'); refreshBalance(); }

async function refreshBalance() {
  try { const d = await api('/api/me'); state.player = d.player; renderHeader(); } catch {}
}

async function loadAccount() {
  try {
    const d = await api('/api/account');
    state.player = d.player; state.currency = d.currency; renderHeader();
    $('acctBalance').textContent = fmtMoney(d.player.balance);
    const tx = d.transactions;
    $('txList').innerHTML = !tx.length ? '<p class="muted">No transactions yet — play a round!</p>' :
      '<table><tr><th>type</th><th>amount</th><th>round</th><th>when</th></tr>' +
      tx.map(t => '<tr><td>' + t.type + '</td><td>' + fmtMoney(t.amount) + '</td><td><code>' + t.roundRef + '</code></td><td>' + t.createdAt.replace('T',' ').slice(0,19) + '</td></tr>').join('') +
      '</table>';
  } catch (e) { $('txList').innerHTML = '<span class="err">' + e.message + '</span>'; }
}

// Resume a session from localStorage.
if (state.token) { api('/api/me').then(signedIn).catch(signOut); }
`;
