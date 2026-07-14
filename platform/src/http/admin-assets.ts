import type { FastifyPluginAsync } from "fastify";

/**
 * Shared shell for the two consoles (provider-console.ts and operator-console.ts).
 * Served once as /console/app.css + /console/app.js so both pages share one
 * stylesheet and one application script. Each page sets window.__CONSOLE__ to
 * declare its kind ('provider' | 'operator'), title, and expected login scope; the
 * script renders the login/2FA flow, gates the scope, and drives whatever nav
 * buttons + view sections that page includes.
 */

export const CONSOLE_CSS = /* css */ `
:root { color-scheme: dark; --bg:#0b1020; --panel:#111935; --panel-2:#0e1430;
        --line:#1f2a4d; --accent:#4f8cff; --accent-2:#7aa7ff; --text:#e6ecff; --muted:#8a98c8;
        --ok:#5fe3a1; --err:#ff8b8b; --warn:#ffb56b; }
* { box-sizing: border-box; }
html, body { margin:0; }
body { font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif; background:var(--bg); color:var(--text); min-height:100vh; }
a { color: var(--accent-2); text-decoration: none; }
button { background:var(--accent); border:0; color:#00122e; font-weight:700; padding:8px 14px; border-radius:8px; cursor:pointer; font:inherit; }
button:hover { filter: brightness(1.08); }
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
header .brandtag { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
nav { display:flex; gap:6px; margin-left:auto; flex-wrap:wrap; align-items:center; }
nav button { background:transparent; border:1px solid var(--line); color:var(--text); font-weight:600; padding:6px 12px; }
nav button.active { background:var(--accent); color:#00122e; border-color:var(--accent); }
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
tr.clickable:hover td { background: rgba(79,140,255,.08); }
.row { display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; }
.row > * { flex: 1 1 220px; }
.grid-2 { display:grid; grid-template-columns: 1fr 1fr; gap:14px; }
@media (max-width: 900px) { .grid-2 { grid-template-columns: 1fr; } }
.status { padding:6px 10px; border-radius:8px; font-size:13px; }
.status.ok { background:#10301f; color:var(--ok); border:1px solid #1b4f33; }
.status.err { background:#2a1320; color:var(--err); border:1px solid #5c2236; }
.login { max-width:460px; margin:56px auto; padding:24px; background:var(--panel); border:1px solid var(--line); border-radius:14px; }
.login h2 { margin-top:0; }
.login .field { margin-top:12px; }
.login .actions { margin-top:16px; display:flex; gap:8px; }
.secretbox { font-family: ui-monospace,Menlo,Consolas,monospace; font-size:15px; letter-spacing:.06em; word-break:break-all;
             background:#070b1a; border:1px solid var(--line); padding:10px 12px; border-radius:8px; margin:8px 0; }
.steps { display:flex; gap:6px; margin-bottom:12px; }
.steps .st { flex:1; text-align:center; font-size:11px; padding:5px; border:1px solid var(--line); border-radius:6px; color:var(--muted); }
.steps .st.on { background:var(--accent); color:#00122e; border-color:var(--accent); font-weight:700; }
pre.code { background:#070b1a; border:1px solid var(--line); padding:8px 10px; border-radius:8px; font-size:12px; overflow:auto; max-height:160px; white-space:pre-wrap; word-break:break-all; }

.inspector { display:grid; gap:14px; grid-template-columns: 1fr 1fr; }
@media (max-width: 1100px) { .inspector { grid-template-columns: 1fr; } }
.inspector .panel { margin:0; }
.kv { display:grid; grid-template-columns: 140px 1fr; gap:6px 12px; font-size:13px; }
.kv span { color: var(--muted); }
.kv code { color: var(--accent-2); font-family: ui-monospace,Menlo,Consolas,monospace; word-break: break-all; }
.matrix { display:grid; gap:6px; padding:10px; background:#070b1a; border:1px solid var(--line); border-radius:10px; }
.matrix .cell { aspect-ratio:1; background:#0b1530; border:1px solid #1c2747; border-radius:8px;
                position:relative; display:flex; align-items:center; justify-content:center; overflow:hidden; transition: box-shadow .25s ease; }
.matrix .cell img { width:80%; height:80%; object-fit:contain; }
.matrix .cell.win { box-shadow: 0 0 0 2px var(--accent), 0 0 14px rgba(79,140,255,.55) inset; background:#12224a; }
.matrix .cell.scatter::after { content: 'S'; position:absolute; top:3px; left:5px; font-size:10px; color:#fff;
                                background: #c84455; padding:1px 4px; border-radius:5px; font-weight:700; }
.matrix .cell .mbadge { position:absolute; bottom:3px; right:4px; font-size:11px; color:#00122e; background:var(--accent);
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
`;

// The application script. Kept as one served file so both consoles share it.
export const CONSOLE_JS = /* js */ `
"use strict";
const CONSOLE = window.__CONSOLE__ || { kind: "provider", expectedScope: "provider", title: "Console" };
const TOKEN_KEY = "adminToken:" + CONSOLE.kind;
const SCOPE_KEY = "adminScope:" + CONSOLE.kind;
const state = { token: localStorage.getItem(TOKEN_KEY) || "", scope: localStorage.getItem(SCOPE_KEY) || null, operators: [], games: [], mathConfigs: [] };

const $ = (id) => document.getElementById(id);
const fmtMoney = (n) => Number(n ?? 0).toFixed(2);
const fmt = (v) => v === undefined || v === null ? "" : (typeof v === "object" ? JSON.stringify(v) : String(v));
const setHTML = (id, html) => { const e = $(id); if (e) e.innerHTML = html; };
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function flash(el, msg, ok) { if (!el) return; el.hidden = false; el.className = "status " + (ok ? "ok" : "err"); el.textContent = msg; }
function clearFlash(el) { if (el) { el.hidden = true; el.textContent = ""; } }

// ── API (bearer) ───────────────────────────────────────────────────────────────
async function api(path, opts = {}) {
  const headers = { "authorization": "Bearer " + state.token, ...(opts.headers || {}) };
  if (opts.body && typeof opts.body !== "string") { headers["content-type"] = "application/json"; opts.body = JSON.stringify(opts.body); }
  const res = await fetch(path, { ...opts, headers });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (res.status === 401) { handleAuthExpired(); const err = new Error("session invalid or expired"); err.status = 401; err.body = body; throw err; }
  if (!res.ok) { const msg = (body && body.error && body.error.message) || ("HTTP " + res.status); const err = new Error(msg); err.status = res.status; err.body = body; throw err; }
  return body;
}
let _authExpiredFlashed = false;
function handleAuthExpired() {
  signOut();
  if (_authExpiredFlashed) return; _authExpiredFlashed = true;
  const err = $("authErr"); if (err) flash(err, "Your session expired — please sign in again.", false);
  setTimeout(() => { _authExpiredFlashed = false; }, 1500);
}
// Unauthenticated POST (login flow).
async function authPost(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  return { status: res.status, data };
}

// ── AUTH: username + password → TOTP 2FA (with first-login enrollment) ──────────
let auth = { step: "login", ticket: null, mfaToken: null, secret: null, otpauth: null, needsPassword: false };

function renderAuth() {
  const root = $("authRoot"); if (!root) return;
  if (state.token) { root.hidden = true; return; }
  root.hidden = false;
  let inner = "";
  if (auth.step === "login") inner = loginFormHtml();
  else if (auth.step === "mfa") inner = mfaFormHtml();
  else if (auth.step === "setpw") inner = setPwFormHtml();
  else if (auth.step === "totp") inner = totpFormHtml();
  root.innerHTML = '<div class="login">' + inner + '<div id="authErr" class="status err" hidden style="margin-top:10px;"></div></div>';
  wireAuth();
}
function stepBar(active) {
  const steps = [["login","1 · Password"],["setpw","2 · New password"],["totp","3 · Authenticator"]];
  return '<div class="steps">' + steps.map(s => '<div class="st ' + (s[0]===active?"on":"") + '">' + s[1] + '</div>').join("") + '</div>';
}
function loginFormHtml() {
  return '<h2>Sign in</h2>' +
    '<p class="muted">' + esc(CONSOLE.title) + ' — sign in with your username, password, and authenticator code.</p>' +
    '<div class="field"><label>Username<input id="inUser" autocomplete="username" placeholder="username"/></label></div>' +
    '<div class="field"><label>Password<input id="inPass" type="password" autocomplete="current-password" placeholder="••••••••"/></label></div>' +
    '<div class="actions"><button id="btnLogin">Continue</button></div>';
}
function mfaFormHtml() {
  return '<h2>Two-factor code</h2>' +
    '<p class="muted">Enter the 6-digit code from your authenticator app.</p>' +
    '<div class="field"><label>Authenticator code<input id="inCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"/></label></div>' +
    '<div class="actions"><button id="btnMfa">Verify</button><button class="ghost" id="btnCancel">Cancel</button></div>';
}
function setPwFormHtml() {
  return stepBar("setpw") + '<h2>Set a new password</h2>' +
    '<p class="muted">First sign-in: choose a new password (at least 8 characters).</p>' +
    '<div class="field"><label>New password<input id="inNewPw" type="password" autocomplete="new-password" placeholder="new password"/></label></div>' +
    '<div class="field"><label>Confirm password<input id="inNewPw2" type="password" autocomplete="new-password" placeholder="repeat password"/></label></div>' +
    '<div class="actions"><button id="btnSetPw">Save & continue</button><button class="ghost" id="btnCancel">Cancel</button></div>';
}
function totpFormHtml() {
  return stepBar("totp") + '<h2>Set up your authenticator</h2>' +
    '<p class="muted">Add this secret to an authenticator app (Google Authenticator, Authy, 1Password…), then enter the 6-digit code it shows.</p>' +
    '<div class="secretbox" id="totpSecret">' + esc(auth.secret || "") + '</div>' +
    (auth.otpauth ? '<p class="muted"><a href="' + esc(auth.otpauth) + '">Open in authenticator</a> (or paste the secret above manually)</p>' : "") +
    '<div class="field"><label>Authenticator code<input id="inTotpCode" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"/></label></div>' +
    '<div class="actions"><button id="btnConfirmTotp">Verify & finish</button><button class="ghost" id="btnCancel">Cancel</button></div>';
}
function wireAuth() {
  const err = $("authErr");
  const on = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
  on("btnCancel", () => { auth = { step: "login", ticket: null, mfaToken: null, secret: null, otpauth: null, needsPassword: false }; renderAuth(); });
  on("btnLogin", async () => {
    clearFlash(err);
    const username = ($("inUser").value || "").trim(), password = $("inPass").value || "";
    if (!username || !password) return flash(err, "enter username and password", false);
    const { status, data } = await authPost("/admin/v1/auth/login", { username, password });
    if (status === 429) return flash(err, "too many attempts — wait a moment and retry", false);
    if (status === 423) return flash(err, "account locked after failed attempts — try again later", false);
    if (status === 403) return flash(err, "this account is disabled", false);
    if (status !== 200) return flash(err, (data && data.error && data.error.message) || "invalid username or password", false);
    if (data.setup_required) {
      auth.ticket = data.ticket; auth.needsPassword = data.needs_password;
      if (data.needs_password) { auth.step = "setpw"; renderAuth(); }
      else { await beginTotp(); }
      return;
    }
    auth.mfaToken = data.mfa_token; auth.step = "mfa"; renderAuth();
  });
  on("btnMfa", async () => {
    clearFlash(err);
    const code = ($("inCode").value || "").trim();
    const { status, data } = await authPost("/admin/v1/auth/login/mfa", { mfa_token: auth.mfaToken, code });
    if (status !== 200) return flash(err, status === 401 ? "invalid authenticator code" : "verification failed", false);
    finishAuth(data.token, data.scope);
  });
  on("btnSetPw", async () => {
    clearFlash(err);
    const pw = $("inNewPw").value || "", pw2 = $("inNewPw2").value || "";
    if (pw.length < 8) return flash(err, "password must be at least 8 characters", false);
    if (pw !== pw2) return flash(err, "passwords do not match", false);
    const { status, data } = await authPost("/admin/v1/auth/first-login/password", { ticket: auth.ticket, new_password: pw });
    if (status !== 200) return flash(err, (data && data.error && data.error.message) || "could not set password", false);
    if (data.done) return finishAuth(data.token, data.scope);
    await beginTotp();
  });
  on("btnConfirmTotp", async () => {
    clearFlash(err);
    const code = ($("inTotpCode").value || "").trim();
    const { status, data } = await authPost("/admin/v1/auth/first-login/totp/confirm", { ticket: auth.ticket, code });
    if (status !== 200) return flash(err, status === 401 ? "invalid authenticator code" : "verification failed", false);
    finishAuth(data.token, data.scope);
  });
}
async function beginTotp() {
  const { status, data } = await authPost("/admin/v1/auth/first-login/totp/begin", { ticket: auth.ticket });
  if (status !== 200) { auth.step = "login"; renderAuth(); flash($("authErr"), "could not start authenticator setup — sign in again", false); return; }
  auth.secret = data.secret; auth.otpauth = data.otpauth_uri; auth.step = "totp"; renderAuth();
}
function finishAuth(token, scope) {
  if (scope !== CONSOLE.expectedScope) {
    auth = { step: "login", ticket: null, mfaToken: null, secret: null, otpauth: null, needsPassword: false };
    renderAuth();
    flash($("authErr"), "This login is for the " + CONSOLE.expectedScope + " console. Use the correct portal.", false);
    return;
  }
  state.token = token; state.scope = scope;
  localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(SCOPE_KEY, scope);
  auth = { step: "login", ticket: null, mfaToken: null, secret: null, otpauth: null, needsPassword: false };
  afterSignIn();
}
function afterSignIn() {
  const pill = $("scopePill"); if (pill) pill.textContent = (state.scope || "?") + " · signed in";
  const nav = $("nav"); if (nav) nav.hidden = false;
  const so = $("signOutBtn"); if (so) so.hidden = false;
  renderAuth();
  applyScopeVisibility();
  const initial = (location.hash || "#dashboard").slice(1);
  show(VIEWS.includes(initial) ? initial : "dashboard");
}
function applyScopeVisibility() {
  const isProvider = state.scope === "provider";
  document.querySelectorAll("[data-provider]").forEach(el => { el.style.display = isProvider ? "" : "none"; });
  document.querySelectorAll("[data-operator]").forEach(el => { el.style.display = isProvider ? "none" : ""; });
}
function signOut() {
  state.token = ""; state.scope = null; localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(SCOPE_KEY);
  const pill = $("scopePill"); if (pill) pill.textContent = "not signed in";
  const nav = $("nav"); if (nav) nav.hidden = true;
  const so = $("signOutBtn"); if (so) so.hidden = true;
  hideAllViews();
  auth = { step: "login", ticket: null, mfaToken: null, secret: null, otpauth: null, needsPassword: false };
  renderAuth();
}

// ── views ────────────────────────────────────────────────────────────────────
const VIEWS = Array.from(document.querySelectorAll("#nav button[data-view]")).map(b => b.dataset.view);
function hideAllViews() { VIEWS.forEach(v => { const s = $(v + "View"); if (s) s.hidden = true; }); }
function show(view) {
  if (!VIEWS.includes(view)) view = VIEWS[0];
  hideAllViews();
  const s = $(view + "View"); if (s) s.hidden = false;
  document.querySelectorAll("#nav button").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  if (view === "dashboard") refreshDashboard();
  if (view === "inspector") { const i = $("roundRefInput"); if (i) i.focus(); }
  if (view === "games") loadGames();
  if (view === "disputes") loadDisputes();
  if (view === "players") { const i = $("plPlayer"); if (i) i.focus(); }
  if (view === "onboarding") refreshOnboardingDropdowns();
  if (view === "reports") loadReports();
  if (view === "accounts") loadAccounts();
  history.replaceState(null, "", "#" + view);
}
document.querySelectorAll("#nav button[data-view]").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
const _signOutBtn = $("signOutBtn"); if (_signOutBtn) _signOutBtn.addEventListener("click", signOut);

function cardHtml(label, value) { return '<div class="card"><span>'+label+'</span><b>'+fmt(value)+'</b></div>'; }
function tableHtml(rows, cols) {
  if (!rows || !rows.length) return '<p class="muted">no rows</p>';
  const head = '<tr>'+cols.map(c => '<th>'+c+'</th>').join('')+'</tr>';
  const body = rows.map(r => '<tr>'+cols.map(c => '<td>'+fmt(r[c])+'</td>').join('')+'</tr>').join('');
  return '<table>'+head+body+'</table>';
}

// ── dashboard ────────────────────────────────────────────────────────────────
async function refreshDashboard() {
  try {
    const summary = await api("/admin/v1/reports/summary");
    const rtp = await api("/admin/v1/reports/rtp");
    const recon = await api("/admin/v1/reports/reconciliation");
    setHTML("overviewCards",
      cardHtml("rounds", summary.rounds) + cardHtml("total bet", fmtMoney(summary.total_bet)) +
      cardHtml("total win", fmtMoney(summary.total_win)) + cardHtml("GGR", fmtMoney(summary.ggr)) +
      cardHtml("hold %", summary.hold_percent) + cardHtml("RTP % (actual)", rtp.actual_rtp_percent) +
      cardHtml("reconciliation", recon.ok ? "✅ ok" : "⚠ drift"));
  } catch (e) { setHTML("overviewCards", '<span class="err">'+e.message+'</span>'); }
  if (state.scope === "provider" && $("operatorsList")) {
    try { const data = await api("/admin/v1/operators"); state.operators = data.operators || []; renderOperators(); }
    catch (e) { setHTML("operatorsList", '<span class="err">'+e.message+'</span>'); }
  }
  await loadRounds();
}
async function loadRounds() {
  if (!$("roundsList")) return;
  const of = $("filterOp"); const opFilter = of ? of.value.trim() : "";
  const qs = opFilter ? ("?operator_id=" + encodeURIComponent(opFilter)) : "";
  try {
    const data = await api("/admin/v1/rounds" + qs);
    const rows = data.rounds || [];
    if (!rows.length) { setHTML("roundsList", '<p class="muted">no rounds yet</p>'); return; }
    const head = '<tr><th>round_ref</th><th>operator</th><th>bet</th><th>win</th><th>status</th><th>created_at</th></tr>';
    const body = rows.slice().reverse().slice(0, 50).map((r) =>
      '<tr class="clickable" data-ref="' + r.round_ref + '">' +
        '<td><code>' + r.round_ref + '</code></td>' +
        '<td>' + (r.operator_id ? r.operator_id.slice(0, 8) + '…' : '') + '</td>' +
        '<td>' + fmtMoney(r.bet_charged ?? r.bet_amount) + '</td>' +
        '<td>' + (r.total_win > 0 ? '<span class="ok">+' + fmtMoney(r.total_win) + '</span>' : fmtMoney(r.total_win)) + '</td>' +
        '<td>' + r.status + '</td>' +
        '<td>' + (r.created_at || '').replace('T', ' ').slice(0, 19) + '</td></tr>').join('');
    setHTML("roundsList", '<table>' + head + body + '</table>');
    $("roundsList").querySelectorAll('tr.clickable').forEach(tr => tr.addEventListener('click', () => { $("roundRefInput").value = tr.dataset.ref; show('inspector'); lookupRound(); }));
  } catch (e) { setHTML("roundsList", '<span class="err">'+e.message+'</span>'); }
}

__INSPECTOR__
__ONBOARDING__
__REPORTS__
__ROUNDACTIONS__
__GAMES__
__DISPUTES__
__PLAYERS__
__OPERATORS__
__ACCOUNTS__

// ── boot ─────────────────────────────────────────────────────────────────────
if (state.token && state.scope) { afterSignIn(); } else { renderAuth(); }
`;

// The inspector/onboarding/etc. blocks are big and unchanged in behavior from the
// original single console; kept in separate template pieces for readability.
import { INSPECTOR_JS, ONBOARDING_JS, REPORTS_JS, ROUNDACTIONS_JS, GAMES_JS, DISPUTES_JS, PLAYERS_JS, OPERATORS_JS, ACCOUNTS_JS } from "./admin-console-views";

function buildAppJs(): string {
  return CONSOLE_JS
    .replace("__INSPECTOR__", INSPECTOR_JS)
    .replace("__ONBOARDING__", ONBOARDING_JS)
    .replace("__REPORTS__", REPORTS_JS)
    .replace("__ROUNDACTIONS__", ROUNDACTIONS_JS)
    .replace("__GAMES__", GAMES_JS)
    .replace("__DISPUTES__", DISPUTES_JS)
    .replace("__PLAYERS__", PLAYERS_JS)
    .replace("__OPERATORS__", OPERATORS_JS)
    .replace("__ACCOUNTS__", ACCOUNTS_JS);
}

const adminAssetsRoutes: FastifyPluginAsync = async (app) => {
  const js = buildAppJs();
  app.get("/console/app.css", async (_req, reply) =>
    reply.type("text/css").header("cache-control", "no-store").send(CONSOLE_CSS));
  app.get("/console/app.js", async (_req, reply) =>
    reply.type("application/javascript").header("cache-control", "no-store").send(js));
};

export default adminAssetsRoutes;
