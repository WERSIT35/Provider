/**
 * Casino back-office (staff) single page: sign-in view + Spin history / Players /
 * Transactions / Providers. Vanilla HTML/CSS/JS, no build step (same spirit as the
 * player site and the platform consoles).
 *
 * Security: served with a per-response CSP nonce (no inline handlers, no style
 * attributes, script/style only via the nonce), frame-ancestors 'none', and
 * Referrer-Policy no-referrer. Every value from the API is escaped before it reaches
 * the DOM — player emails are user-supplied. Auth is the HttpOnly staff cookie; the page
 * never sees the token. Any 401 drops back to the sign-in view.
 */
export function backOfficeCsp(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "connect-src 'self'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'"
  ].join("; ");
}

export const BACK_OFFICE_PAGE = (nonce: string, casinoName: string): string => `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<meta name="referrer" content="no-referrer"/>
<title>Back Office · ${escapeHtml(casinoName)}</title>
<style nonce="${nonce}">${CSS}</style>
</head>
<body>

<section id="loginView" class="login" hidden>
  <form id="loginForm" class="login-card" autocomplete="on" novalidate>
    <div class="brand"><span class="brand-mark">◆</span> ${escapeHtml(casinoName)}</div>
    <h1>Back Office</h1>
    <p class="muted">Staff sign-in</p>
    <label for="loginUser">Username</label>
    <input id="loginUser" name="username" autocomplete="username" required/>
    <label for="loginPass">Password</label>
    <input id="loginPass" name="password" type="password" autocomplete="current-password" required/>
    <p id="loginMsg" class="form-msg" role="alert"></p>
    <button id="loginBtn" type="submit" class="btn btn-primary btn-block">Sign in</button>
  </form>
</section>

<div id="appView" hidden>
  <header class="topbar">
    <div class="brand"><span class="brand-mark">◆</span> ${escapeHtml(casinoName)} <span class="muted">· Back Office</span></div>
    <nav id="nav" class="tabs" aria-label="Sections">
      <button type="button" data-view="rounds" class="tab">Spin history</button>
      <button type="button" data-view="players" class="tab">Players</button>
      <button type="button" data-view="transactions" class="tab">Transactions</button>
      <button type="button" data-view="providers" class="tab">Providers</button>
    </nav>
    <div class="who"><span id="whoName" class="muted"></span><button id="logoutBtn" type="button" class="btn btn-ghost">Sign out</button></div>
  </header>

  <main>
    <section id="roundsView" class="view" hidden>
      <div class="panel">
        <div class="panel-head">
          <div>
            <h2>Spin history</h2>
            <p class="muted">Every round, built from the signed wallet webhooks the provider sent this casino.
              <b>Verify on Provider</b> opens the provider's Round Inspector, which replays the round from its seed.</p>
          </div>
          <div class="toolbar">
            <input id="roundsFilter" type="search" placeholder="Filter by player, game or round" aria-label="Filter rounds"/>
            <button id="roundsRefresh" type="button" class="btn btn-ghost">Refresh</button>
          </div>
        </div>
        <div class="table-wrap">
          <table class="data">
            <thead><tr>
              <th>Timestamp</th><th>Player ID</th><th>Game</th><th>Round</th>
              <th class="num">Bet</th><th class="num">Win</th><th class="act"><span class="sr-only">Verify</span></th>
            </tr></thead>
            <tbody id="roundsBody"><tr><td colspan="7" class="empty">Loading…</td></tr></tbody>
          </table>
        </div>
        <p id="roundsMeta" class="muted small"></p>
      </div>
    </section>

    <section id="playersView" class="view" hidden>
      <div class="panel">
        <h2>Players</h2>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Player ID</th><th>Email</th><th class="num">Balance</th><th>Joined</th></tr></thead>
          <tbody id="playersBody"></tbody>
        </table></div>
      </div>
    </section>

    <section id="transactionsView" class="view" hidden>
      <div class="panel">
        <h2>Wallet transactions</h2>
        <p class="muted">The raw, append-only ledger: one row per webhook money movement.</p>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Timestamp</th><th>Player ID</th><th>Type</th><th class="num">Amount</th><th class="num">Balance after</th><th>Round</th></tr></thead>
          <tbody id="txBody"></tbody>
        </table></div>
      </div>
    </section>

    <section id="providersView" class="view" hidden>
      <div class="panel">
        <h2>Game providers</h2>
        <p class="muted">Secrets are never shown; leave a secret blank when editing to keep it.</p>
        <div class="table-wrap"><table class="data">
          <thead><tr><th>Name</th><th>Platform URL</th><th>Operator ID</th><th>Webhook secret</th><th class="act"></th></tr></thead>
          <tbody id="providersBody"></tbody>
        </table></div>
      </div>
      <form id="providerForm" class="panel" novalidate>
        <h2>Add provider</h2>
        <div class="form-grid">
          <label>Name<input name="name" required/></label>
          <label>Platform URL<input name="platformUrl" placeholder="http://127.0.0.1:8080" required/></label>
          <label>Operator ID<input name="operatorId" required/></label>
          <label>API key ID<input name="apiKeyId" required/></label>
          <label>API secret<input name="apiSecret" type="password" autocomplete="off" required/></label>
          <label>Webhook secret<input name="webhookSecret" type="password" autocomplete="off" required/></label>
          <label>Admin token<input name="adminToken" type="password" autocomplete="off" required/></label>
        </div>
        <p id="providerMsg" class="form-msg" role="alert"></p>
        <button type="submit" class="btn btn-primary">Add provider</button>
      </form>
    </section>
  </main>
</div>

<script nonce="${nonce}">${JS}</script>
</body></html>`;

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const CSS = /* css */ `
:root {
  --bg:#0d0f14; --panel:#151922; --panel-2:#10131a; --line:#252b37; --text:#e9ecf2; --muted:#8c94a8;
  --gold:#f5c518; --gold-ink:#1b1606; --ok:#3fbf7f; --err:#ef5b50; --focus:#7aa7ff;
  color-scheme: dark;
}
* { box-sizing:border-box; }
html, body { margin:0; background:var(--bg); color:var(--text); font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif; }
[hidden] { display:none !important; }
.muted { color:var(--muted); }
.small { font-size:12px; }
.sr-only { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
h1, h2 { margin:0; line-height:1.25; }
h2 { font-size:16px; }
.brand { font-weight:700; letter-spacing:.2px; display:flex; align-items:center; gap:8px; white-space:nowrap; }
.brand-mark { color:var(--gold); }

.btn { font:inherit; font-weight:600; border-radius:8px; padding:8px 14px; border:1px solid transparent; cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; justify-content:center; gap:6px; white-space:nowrap; }
.btn:focus-visible, input:focus-visible, .tab:focus-visible { outline:2px solid var(--focus); outline-offset:2px; }
.btn-primary { background:var(--gold); color:var(--gold-ink); }
.btn-primary:hover { filter:brightness(1.06); }
.btn-ghost { background:transparent; border-color:var(--line); color:var(--text); }
.btn-ghost:hover { border-color:#3a4252; }
.btn-danger { background:transparent; border-color:#5a2a27; color:var(--err); }
.btn-verify { background:transparent; border-color:#5e5320; color:var(--gold); padding:5px 10px; font-size:12px; }
.btn-verify:hover { background:rgba(245,197,24,.08); }
.btn[aria-disabled="true"], .btn:disabled { opacity:.45; cursor:not-allowed; }
.btn-block { width:100%; }

input { font:inherit; background:var(--panel-2); border:1px solid var(--line); color:var(--text); border-radius:8px; padding:9px 11px; width:100%; }
input::placeholder { color:#5d6577; }
label { display:block; font-size:12px; color:var(--muted); font-weight:600; }

/* ── Sign-in ───────────────────────────────────────────── */
.login { min-height:100vh; display:grid; place-items:center; padding:24px 16px; }
.login-card { width:100%; max-width:360px; background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:28px 24px; display:grid; gap:10px; }
.login-card h1 { font-size:22px; margin-top:6px; }
.login-card .muted { margin:0 0 6px; }
.login-card label { margin-top:4px; }
.form-msg { min-height:1.4em; margin:2px 0; color:var(--err); font-size:13px; }

/* ── App shell ─────────────────────────────────────────── */
.topbar { display:flex; align-items:center; gap:20px; padding:0 20px; min-height:56px; border-bottom:1px solid var(--line); background:var(--panel-2); flex-wrap:wrap; }
.tabs { display:flex; gap:4px; flex:1; overflow-x:auto; }
.tab { font:inherit; font-weight:600; background:transparent; border:0; border-bottom:2px solid transparent; color:var(--muted); padding:16px 10px 14px; cursor:pointer; white-space:nowrap; }
.tab.active { color:var(--text); border-bottom-color:var(--gold); }
.who { display:flex; align-items:center; gap:10px; }
main { max-width:1180px; margin:0 auto; padding:20px 16px 40px; }
.panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px; margin-bottom:16px; }
.panel > h2 { margin-bottom:12px; }
.panel-head { display:flex; justify-content:space-between; gap:16px; align-items:flex-end; flex-wrap:wrap; margin-bottom:14px; }
.panel-head p { margin:4px 0 0; max-width:640px; }
.toolbar { display:flex; gap:8px; }
.toolbar input { width:260px; max-width:60vw; }

/* ── Tables ────────────────────────────────────────────── */
.table-wrap { overflow-x:auto; border:1px solid var(--line); border-radius:10px; }
table.data { width:100%; border-collapse:collapse; font-variant-numeric:tabular-nums; }
.data th { text-align:left; font-size:11px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); font-weight:700; padding:10px 12px; background:var(--panel-2); border-bottom:1px solid var(--line); white-space:nowrap; }
.data td { padding:10px 12px; border-bottom:1px solid var(--line); white-space:nowrap; vertical-align:middle; }
.data tbody tr:last-child td { border-bottom:0; }
.data tbody tr:hover td { background:rgba(255,255,255,.02); }
.data .num { text-align:right; }
.data .act { text-align:right; width:1%; }
.data .empty { text-align:center; color:var(--muted); padding:28px 12px; white-space:normal; }
.mono { font-family:ui-monospace,SFMono-Regular,Consolas,monospace; font-size:12px; }
.sub { display:block; color:var(--muted); font-size:12px; }
.win { color:var(--ok); font-weight:700; }
.zero { color:var(--muted); }
.badge { display:inline-block; font-size:11px; font-weight:700; padding:2px 8px; border-radius:999px; border:1px solid var(--line); color:var(--muted); }
.badge.free_spin { color:#9fb8ff; border-color:#2c3a66; }
.badge.buy { color:var(--gold); border-color:#5e5320; }
.badge.free_round { color:#c49bff; border-color:#45306b; }
.badge.rolled { color:var(--err); border-color:#5a2a27; }

.form-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); gap:12px; margin-bottom:8px; }
.form-grid input { margin-top:4px; }

@media (max-width: 720px) {
  .topbar { gap:8px; padding:8px 16px; }
  .tabs { order:3; flex-basis:100%; }
  .toolbar { width:100%; }
  .toolbar input { width:100%; max-width:none; }
}
`;

const JS = /* js */ `
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n, cur) => (Number(n) || 0).toFixed(2) + (cur ? ' ' + esc(cur) : '');
const when = (iso) => { const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
const shortId = (id) => { const s = String(id || ''); return s.length > 14 ? s.slice(0, 8) + '…' + s.slice(-4) : s; };
const ROUND_LABEL = { paid: 'Paid', free_spin: 'Free spin', buy: 'Bonus buy', free_round: 'Free round' };

class AuthError extends Error {}
async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    credentials: 'same-origin',
    headers: opts.body ? { 'content-type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/api/staff/login') throw new AuthError('Your session has ended. Please sign in again.');
  if (!res.ok) {
    const e = new Error((data.error && (data.error.message || data.error.code)) || (typeof data.error === 'string' ? data.error : 'Request failed'));
    e.status = res.status;
    throw e;
  }
  return data;
}

// Any expired/invalid session anywhere drops back to the sign-in view.
function handle(err, el) {
  if (err instanceof AuthError) return showLogin(err.message);
  if (el) el.innerHTML = '<tr><td colspan="9" class="empty">' + esc(err.message) + '</td></tr>';
}

/* ── Sign-in ─────────────────────────────────────────── */
function showLogin(message) {
  $('appView').hidden = true;
  $('loginView').hidden = false;
  $('loginMsg').textContent = message || '';
  $('loginPass').value = '';
  ($('loginUser').value ? $('loginPass') : $('loginUser')).focus();
}
function showApp(username) {
  $('loginView').hidden = true;
  $('appView').hidden = false;
  $('whoName').textContent = username;
  show(viewFromHash());
}

$('loginForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const username = $('loginUser').value.trim();
  const password = $('loginPass').value;
  if (!username || !password) { $('loginMsg').textContent = 'Enter your username and password.'; return; }
  const btn = $('loginBtn');
  btn.disabled = true; btn.textContent = 'Signing in…'; $('loginMsg').textContent = '';
  try {
    const d = await api('/api/staff/login', { method: 'POST', body: { username, password } });
    showApp(d.username);
  } catch (e) {
    $('loginMsg').textContent = e.status === 429 ? 'Too many attempts. Wait a few minutes and try again.'
      : e.status === 401 ? 'Wrong username or password.' : e.message;
    $('loginPass').value = ''; $('loginPass').focus();
  } finally {
    btn.disabled = false; btn.textContent = 'Sign in';
  }
});

$('logoutBtn').addEventListener('click', async () => {
  try { await api('/api/staff/logout', { method: 'POST', body: {} }); } catch {}
  showLogin('You have signed out.');
});

/* ── Navigation ──────────────────────────────────────── */
const VIEWS = ['rounds', 'players', 'transactions', 'providers'];
const LOADERS = { rounds: loadRounds, players: loadPlayers, transactions: loadTransactions, providers: loadProviders };
function viewFromHash() { const v = location.hash.slice(1); return VIEWS.includes(v) ? v : 'rounds'; }
function show(view) {
  VIEWS.forEach((v) => { $(v + 'View').hidden = v !== view; });
  document.querySelectorAll('#nav .tab').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  if (location.hash.slice(1) !== view) history.replaceState(null, '', '#' + view);
  LOADERS[view]();
}
$('nav').addEventListener('click', (ev) => { const b = ev.target.closest('.tab'); if (b) show(b.dataset.view); });

/* ── Spin history ────────────────────────────────────── */
let rounds = [];
async function loadRounds() {
  const body = $('roundsBody');
  try {
    const d = await api('/api/admin/rounds?limit=500');
    rounds = d.rounds;
    renderRounds();
    $('roundsMeta').textContent = 'Showing the latest ' + rounds.length + ' rounds · updated ' + new Date().toLocaleTimeString();
  } catch (e) { handle(e, body); }
}
function renderRounds() {
  const q = $('roundsFilter').value.trim().toLowerCase();
  const list = q ? rounds.filter((r) => [r.playerId, r.playerEmail, r.gameCode, r.roundRef].some((v) => String(v || '').toLowerCase().includes(q))) : rounds;
  const body = $('roundsBody');
  if (!list.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty">' + (rounds.length ? 'No rounds match this filter.' : 'No rounds yet. They appear here as soon as a player spins.') + '</td></tr>';
    return;
  }
  body.innerHTML = list.map((r) => {
    const type = r.rolledBack ? '<span class="badge rolled">Rolled back</span>'
      : '<span class="badge ' + esc(r.roundType || '') + '">' + esc(ROUND_LABEL[r.roundType] || 'Round') + '</span>';
    const verify = r.verifyUrl
      ? '<a class="btn btn-verify" href="' + esc(r.verifyUrl) + '" target="_blank" rel="noopener noreferrer" title="Open round ' + esc(r.roundRef) + ' in the provider\\'s Round Inspector">Verify on Provider ↗</a>'
      : '<span class="btn btn-verify" aria-disabled="true" title="No provider portal configured">Verify on Provider</span>';
    return '<tr>' +
      '<td>' + when(r.settledAt) + '</td>' +
      '<td><span class="mono" title="' + esc(r.playerId) + '">' + esc(shortId(r.playerId)) + '</span>' + (r.playerEmail ? '<span class="sub">' + esc(r.playerEmail) + '</span>' : '') + '</td>' +
      '<td class="mono">' + esc(r.gameCode || '—') + '</td>' +
      '<td>' + type + '<span class="sub mono" title="' + esc(r.roundRef) + '">' + esc(shortId(r.roundRef)) + '</span></td>' +
      '<td class="num">' + money(r.bet, r.currency) + '</td>' +
      '<td class="num ' + (r.win > 0 ? 'win' : 'zero') + '">' + money(r.win, r.currency) + '</td>' +
      '<td class="act">' + verify + '</td>' +
    '</tr>';
  }).join('');
}
$('roundsFilter').addEventListener('input', renderRounds);
$('roundsRefresh').addEventListener('click', loadRounds);

/* ── Players / transactions ──────────────────────────── */
async function loadPlayers() {
  const body = $('playersBody');
  try {
    const d = await api('/api/admin/players');
    body.innerHTML = !d.players.length ? '<tr><td colspan="4" class="empty">No players yet.</td></tr>' : d.players.map((p) =>
      '<tr><td class="mono">' + esc(p.id) + '</td><td>' + esc(p.email) + '</td><td class="num">' + money(p.balance) + '</td><td>' + when(p.createdAt) + '</td></tr>').join('');
  } catch (e) { handle(e, body); }
}
async function loadTransactions() {
  const body = $('txBody');
  try {
    const d = await api('/api/admin/transactions?limit=500');
    body.innerHTML = !d.transactions.length ? '<tr><td colspan="6" class="empty">No transactions yet.</td></tr>' : d.transactions.map((t) =>
      '<tr><td>' + when(t.createdAt) + '</td><td class="mono" title="' + esc(t.playerId) + '">' + esc(shortId(t.playerId)) + '</td>' +
      '<td><span class="badge">' + esc(t.txType) + '</span></td>' +
      '<td class="num">' + (t.type === 'debit' ? '−' : '+') + money(t.amount, t.currency) + '</td>' +
      '<td class="num">' + money(t.balanceAfter, t.currency) + '</td>' +
      '<td class="mono" title="' + esc(t.roundRef) + '">' + esc(shortId(t.roundRef)) + '</td></tr>').join('');
  } catch (e) { handle(e, body); }
}

/* ── Providers ───────────────────────────────────────── */
async function loadProviders() {
  const body = $('providersBody');
  try {
    const d = await api('/api/admin/providers');
    body.innerHTML = !d.providers.length ? '<tr><td colspan="5" class="empty">No providers configured.</td></tr>' : d.providers.map((p) =>
      '<tr><td>' + esc(p.name) + '</td><td class="mono">' + esc(p.platformUrl) + '</td><td class="mono">' + esc(p.operatorId) + '</td>' +
      '<td class="mono">' + esc(p.webhookSecret || '—') + '</td>' +
      '<td class="act"><button type="button" class="btn btn-danger" data-delete="' + esc(p.id) + '" data-name="' + esc(p.name) + '">Remove</button></td></tr>').join('');
  } catch (e) { handle(e, body); }
}
$('providersBody').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-delete]');
  if (!b) return;
  if (!window.confirm('Remove provider "' + b.dataset.name + '"? Its games disappear from the lobby.')) return;
  try { await api('/api/admin/providers/' + encodeURIComponent(b.dataset.delete), { method: 'DELETE' }); loadProviders(); }
  catch (e) { handle(e); if (!(e instanceof AuthError)) $('providerMsg').textContent = e.message; }
});
$('providerForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const body = Object.fromEntries(new FormData(form).entries());
  if (Object.values(body).some((v) => !String(v).trim())) { $('providerMsg').textContent = 'All fields are required.'; return; }
  try {
    await api('/api/admin/providers', { method: 'POST', body });
    form.reset(); $('providerMsg').textContent = '';
    loadProviders();
  } catch (e) { handle(e); if (!(e instanceof AuthError)) $('providerMsg').textContent = e.message; }
});

/* ── Boot: signed in already? ────────────────────────── */
api('/api/staff/me').then((d) => showApp(d.username)).catch(() => showLogin(''));
`;
