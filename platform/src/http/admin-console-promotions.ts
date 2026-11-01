/**
 * Promotions views of both consoles: Tournaments, Prize Drops and Promo Win Search, over
 * /admin/v1/tournaments, /admin/v1/prize-drops and /admin/v1/promo-wins
 * (admin-promotions.routes.ts). Write controls render only with campaigns.write (the API
 * enforces it anyway). Every API value goes through esc(). Spliced into /console/app.js.
 */

const statusDefs = /* html */ `
<details class="defs"><summary>How promotions work</summary><dl>
  <dt>Counting</dt><dd>Only rounds in the promotion's games and currency, between its start and end, staked at least the minimum bet. Free rounds and voided rounds never count. Games and their payouts are not changed.</dd>
  <dt>Tournament</dt><dd>Ranked on the best single round (win ÷ stake), total wins or turnover. Ties go to whoever got there first. It closes 15 seconds after its end and pays one prize per rank.</dd>
  <dt>Prize drop</dt><dd>Each counted round wins with a chance of 1 in N while prizes are left. Which prize it wins is drawn at random from those still left.</dd>
  <dt>Payment</dt><dd>Each prize is one credit to the player's wallet (PROMO_WIN). If a credit fails, the prize stays owed and is retried with the same key, so it is never paid twice.</dd>
</dl></details>`;

function listSection(id: string, title: string, intro: string, newLabel: string): string {
  return /* html */ `
<section id="${id}View" hidden>
  <div class="panel">
    <p class="kicker">Promotions</p>
    <h2>${title}</h2>
    <p class="muted">${intro}</p>
    <div class="toolbar">
      <input class="search" id="${id}Op" placeholder="operator id (provider only; blank = all)" data-provider/>
      <button class="ghost" data-promo-load="${id}">Refresh</button>
      <button id="${id}New" data-promo-write hidden>${newLabel}</button>
      <span id="${id}Status" class="muted"></span>
    </div>
    <div id="${id}Table">–</div>
    <div id="${id}Drawer" class="drawer" hidden></div>
    ${statusDefs}
  </div>
</section>`;
}

export const SECTION_PROMOTIONS = [
  listSection("tournaments", "Tournaments", "Players climb a leaderboard built from the rounds they play. When it ends, each prize place is paid to the player's wallet.", "+ New tournament"),
  listSection("prizeDrops", "Prize Drops", "Cash prizes land on random qualifying rounds while the drop runs, until the prizes are gone.", "+ New prize drop"),
  /* html */ `
<section id="promoWinsView" hidden>
  <div class="panel">
    <p class="kicker">Promotions</p>
    <h2>Promo Win Search</h2>
    <p class="muted">Every prize a promotion paid or owes, by player, type, status and date.</p>
    <div class="filters">
      <label data-provider>Operator id <input id="pwOp" placeholder="all operators"/></label>
      <label>Player id <input id="pwPlayer" placeholder="all players"/></label>
      <label>Type <select id="pwType"><option value="">all</option><option value="tournament">tournaments</option><option value="prize_drop">prize drops</option></select></label>
      <label>Status <select id="pwStatus"><option value="">all</option><option value="paid">paid</option><option value="failed">failed</option><option value="pending">pending</option></select></label>
      <label>From <input type="date" id="pwFrom"/></label>
      <label>To <input type="date" id="pwTo"/></label>
      <div class="go"><button id="pwRun">Search</button><button class="ghost" id="pwCsv">Export CSV</button></div>
    </div>
    <p id="pwStatusLine" class="muted"></p>
    <div id="pwTable">–</div>
  </div>
</section>

<dialog id="promoDlg" class="modal" aria-labelledby="promoDlgTitle">
  <form id="promoForm" method="dialog" novalidate>
    <h3 id="promoDlgTitle">New promotion</h3>
    <label data-provider>Operator id<input id="pfOp" placeholder="operator id"/></label>
    <label>Name<input id="pfName" maxlength="120" required/></label>
    <div class="form-2">
      <label>Games (codes, comma-separated)<input id="pfGames" placeholder="bananax"/></label>
      <label>Currency<input id="pfCurrency" maxlength="3" placeholder="GEL"/></label>
    </div>
    <div class="form-2">
      <label data-kind="tournament">Ranked on<select id="pfMetric"><option value="max_multiplier">best single round (win ÷ stake)</option><option value="total_win">total wins</option><option value="turnover">turnover</option></select></label>
      <label data-kind="drop">Chance per round: 1 in<input id="pfOdds" type="number" min="1" max="1000000" step="1" value="500"/></label>
      <label>Minimum bet<input id="pfMinBet" type="number" min="0" step="0.01" value="0"/></label>
    </div>
    <div class="form-2">
      <label>Starts<input id="pfFrom" type="datetime-local" required/></label>
      <label>Ends<input id="pfTo" type="datetime-local" required/></label>
    </div>
    <label data-kind="tournament">Prizes by place (1st, 2nd, …)<input id="pfPlaces" placeholder="500, 250, 100"/></label>
    <label data-kind="drop">Prizes (amount × how many)<input id="pfTiers" placeholder="50 x 10, 500 x 1"/></label>
    <p class="hint">Prizes are paid by your casino to the player's wallet. Times are in your browser's time zone.</p>
    <div id="pfMsg" class="status err" hidden></div>
    <div class="actions">
      <button type="button" class="ghost" data-close>Cancel</button>
      <button type="submit" id="pfSubmit">Create</button>
    </div>
  </form>
</dialog>

<dialog id="promoConfirmDlg" class="modal" aria-labelledby="promoConfirmTitle">
  <form method="dialog">
    <h3 id="promoConfirmTitle">Cancel promotion?</h3>
    <p id="promoConfirmText" class="muted"></p>
    <div class="actions">
      <button type="button" class="ghost" data-close>Keep it</button>
      <button type="button" class="danger" id="promoConfirmBtn">Cancel promotion</button>
    </div>
  </form>
</dialog>`
].join("\n");

export const PROMOTIONS_JS = /* js */ `
// ── Promotions: Tournaments / Prize Drops / Promo Win Search ────────────────
const PROMO = { tournaments: { api: '/admin/v1/tournaments', key: 'tournaments', one: 'tournament' }, prizeDrops: { api: '/admin/v1/prize-drops', key: 'prize_drops', one: 'prize_drop' } };
let promoKind = 'tournaments', promoLastWins = null, promoConfirmAct = null;
const METRIC = { max_multiplier: 'best round (× stake)', total_win: 'total wins', turnover: 'turnover' };
const promoWhen = (s) => s ? esc(new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })) : '—';
const promoShort = (s) => esc(new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
const promoLocal = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const promoBadge = (s) => '<span class="badge ' + (s === 'running' ? 'active' : s === 'ended' || s === 'closed' ? 'expired' : esc(s)) + '">' + esc(s) + '</span>';
function promoMsg(el, msg, ok) { el.hidden = false; el.className = 'status ' + (ok ? 'ok' : 'err'); el.textContent = msg; }
async function loadPromos(kind) {
  const k = PROMO[kind]; const st = $(kind + 'Status'); const el = $(kind + 'Table');
  document.querySelectorAll('[data-promo-write]').forEach((e) => { e.hidden = !hasPerm('campaigns.write'); });
  const op = $(kind + 'Op') ? $(kind + 'Op').value.trim() : '';
  st.textContent = 'loading…';
  try {
    const d = await api(k.api + (op ? '?operator_id=' + encodeURIComponent(op) : ''));
    const list = d[k.key];
    st.textContent = list.length + (list.length === 1 ? ' ' + k.one.replace('_', ' ') : ' ' + k.key.replace('_', ' '));
    if (!list.length) { el.innerHTML = '<p class="muted">None yet.' + (hasPerm('campaigns.write') ? ' Create one with the button above.' : '') + '</p>'; return; }
    el.innerHTML = '<div class="tbl-wrap tall"><table class="ip-table"><tr><th>Name</th><th>Games</th><th>' + (kind === 'tournaments' ? 'Ranked on' : 'Chance') + '</th><th>Runs</th><th class="num">Prize pool</th><th class="num">Prizes won</th><th>State</th></tr>' +
      list.map((p) => '<tr class="clickable" data-id="' + esc(p.id) + '"><td class="wrap">' + esc(p.name) + '</td><td class="wrap">' + esc(p.game_codes.join(', ')) + '</td>' +
        '<td class="wrap">' + (kind === 'tournaments' ? esc(METRIC[p.metric] || p.metric) : '1 in ' + esc(p.odds)) + '</td>' +
        '<td>' + promoShort(p.starts_at) + ' → ' + promoShort(p.ends_at) + '</td>' +
        '<td class="num">' + fmtMoney(p.prize_pool) + ' ' + esc(p.currency) + '</td>' +
        '<td class="num">' + p.winners + ' / ' + (kind === 'tournaments' ? p.places : p.prizes_total) + '</td><td>' + promoBadge(p.state) + '</td></tr>').join('') + '</table></div>';
    el.querySelectorAll('tr.clickable').forEach((tr) => tr.addEventListener('click', () => openPromo(kind, tr.dataset.id)));
  } catch (e) { st.textContent = e.message; el.innerHTML = ''; }
}
async function openPromo(kind, id) {
  const k = PROMO[kind]; const dr = $(kind + 'Drawer');
  dr.hidden = false; dr.innerHTML = '<p class="muted">loading…</p>';
  try {
    const d = await api(k.api + '/' + encodeURIComponent(id));
    const p = d[k.one];
    const head = '<h2>' + esc(p.name) + ' ' + promoBadge(p.state) + '</h2><p class="muted">' + promoWhen(p.starts_at) + ' → ' + promoWhen(p.ends_at) + ' · ' + esc(p.game_codes.join(', ')) + ' · min bet ' + fmtMoney(p.min_bet) + ' ' + esc(p.currency) + '</p>';
    const cancel = hasPerm('campaigns.write') && p.status === 'open' ? '<button class="danger" data-promo-cancel>Cancel</button> ' : '';
    let body = '';
    if (kind === 'tournaments') {
      body += '<h3>' + (p.status === 'closed' ? 'Final places' : 'Live leaderboard') + '</h3>';
      body += d.board.length ? '<div class="tbl-wrap"><table class="ip-table"><tr><th>Place</th><th>Player</th><th class="num">' + esc(METRIC[p.metric]) + '</th><th class="num">Rounds</th><th class="num">Prize</th></tr>' +
        d.board.map((r) => '<tr><td>' + r.rank + '</td><td><code>' + esc(r.operator_player_id) + '</code></td><td class="num">' + (p.metric === 'max_multiplier' ? Number(r.score).toFixed(2) + '×' : fmtMoney(r.score)) + '</td>' +
          '<td class="num">' + (r.rounds == null ? '—' : r.rounds) + '</td><td class="num">' + (p.prizes[r.rank - 1] ? fmtMoney(p.prizes[r.rank - 1]) : '—') + '</td></tr>').join('') + '</table></div>' : '<p class="muted">No counted rounds yet.</p>';
    }
    body += '<h3>Prizes</h3>' + (kind === 'prizeDrops' ? '<p class="muted">' + p.prizes.map((t) => esc(t.count) + ' × ' + fmtMoney(t.amount)).join(', ') + ' · ' + esc(p.prizes_left) + ' left</p>' : '');
    body += d.wins.length ? winsTable(d.wins) : '<p class="muted">None won yet.</p>';
    dr.innerHTML = head + '<div class="toolbar">' + cancel + '<button class="ghost" data-promo-close>Close</button></div>' + body;
    dr.querySelector("[data-promo-close]").addEventListener('click', () => { dr.hidden = true; });
    const cancelBtn = dr.querySelector("[data-promo-cancel]"); if (cancelBtn) cancelBtn.addEventListener('click', () => {
      $('promoConfirmText').textContent = '"' + p.name + '" stops counting rounds now. Prizes already won are still paid.';
      promoConfirmAct = async () => {
        try { await api(k.api + '/' + encodeURIComponent(id) + '/cancel', { method: 'POST' }); await loadPromos(kind); await openPromo(kind, id); } catch (e) { $(kind + 'Status').textContent = e.message; }
      };
      $('promoConfirmDlg').showModal();
    });
    bindRetry(dr, () => openPromo(kind, id));
  } catch (e) { dr.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
}
function winsTable(wins) {
  const w = hasPerm('campaigns.write');
  return '<div class="tbl-wrap"><table class="ip-table"><tr><th>When</th><th>Player</th><th>Promotion</th><th>Won by</th><th class="num">Amount</th><th>Status</th>' + (w ? '<th></th>' : '') + '</tr>' +
    wins.map((x) => '<tr><td>' + promoWhen(x.created_at) + '</td><td><code>' + esc(x.operator_player_id) + '</code></td><td>' + esc(x.promo_name) + '</td>' +
      '<td>' + (x.rank ? 'place ' + esc(x.rank) : '<code>' + esc(x.round_ref) + '</code>') + '</td><td class="num">' + fmtMoney(x.amount) + ' ' + esc(x.currency) + '</td>' +
      '<td><span class="badge ' + (x.status === 'paid' ? 'active' : x.status === 'failed' ? 'cancelled' : 'scheduled') + '">' + esc(x.status) + '</span>' + (x.error_code ? ' <span class="muted">' + esc(x.error_code) + '</span>' : '') + '</td>' +
      (w ? '<td class="actions">' + (x.status !== 'paid' ? '<button class="ghost" data-retry="' + esc(x.id) + '">Pay now</button>' : '') + '</td>' : '') + '</tr>').join('') + '</table></div>';
}
function bindRetry(root, after) {
  root.querySelectorAll('[data-retry]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await api('/admin/v1/promo-wins/' + encodeURIComponent(b.dataset.retry) + '/retry', { method: 'POST' }); } catch {}
    after();
  }));
}
function openPromoDialog(kind) {
  promoKind = kind;
  $('promoForm').reset(); $('pfMsg').hidden = true;
  $('promoDlgTitle').textContent = kind === 'tournaments' ? 'New tournament' : 'New prize drop';
  document.querySelectorAll('#promoForm [data-kind]').forEach((e) => { e.style.display = e.dataset.kind === (kind === 'tournaments' ? 'tournament' : 'drop') ? '' : 'none'; });
  const now = new Date(); now.setSeconds(0, 0);
  $('pfFrom').value = promoLocal(now); $('pfTo').value = promoLocal(new Date(now.getTime() + 7 * 864e5));
  if (state.scope === 'provider' && $(kind + 'Op')) $('pfOp').value = $(kind + 'Op').value.trim();
  $('promoDlg').showModal(); $('pfName').focus();
}
$('promoForm').addEventListener('input', () => { $('pfMsg').hidden = true; });
$('promoForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('pfMsg'); const kind = promoKind;
  const from = new Date($('pfFrom').value), to = new Date($('pfTo').value);
  if (isNaN(from) || isNaN(to) || to <= from) return promoMsg(msg, 'The end must be after the start.', false);
  const body = { name: $('pfName').value.trim(), game_codes: $('pfGames').value.split(',').map((s) => s.trim()).filter(Boolean),
    currency: $('pfCurrency').value.trim().toUpperCase(), min_bet: Number($('pfMinBet').value || 0), starts_at: from.toISOString(), ends_at: to.toISOString() };
  if (kind === 'tournaments') {
    body.metric = $('pfMetric').value;
    body.prizes = $('pfPlaces').value.split(',').map((s) => Number(s.trim())).filter((n) => !isNaN(n));
  } else {
    body.odds = Number($('pfOdds').value);
    body.prizes = $('pfTiers').value.split(',').map((s) => s.trim()).filter(Boolean).map((t) => { const m = /^([0-9.]+)\\s*[x×]\\s*([0-9]+)$/i.exec(t); return m ? { amount: Number(m[1]), count: Number(m[2]) } : { amount: NaN, count: 0 }; });
    if (body.prizes.some((p) => isNaN(p.amount))) return promoMsg(msg, 'Write prizes as "amount x how many", e.g. 50 x 10, 500 x 1.', false);
  }
  if (state.scope === 'provider') body.operator_id = $('pfOp').value.trim();
  const btn = $('pfSubmit'); btn.disabled = true;
  try {
    const d = await api(PROMO[kind].api, { method: 'POST', body });
    $('promoDlg').close();
    await loadPromos(kind);
    openPromo(kind, d[PROMO[kind].one].id);
  } catch (e) { promoMsg(msg, e.message, false); }
  finally { btn.disabled = false; }
});
$('tournamentsNew').addEventListener('click', () => openPromoDialog('tournaments'));
$('prizeDropsNew').addEventListener('click', () => openPromoDialog('prizeDrops'));
document.querySelectorAll('[data-promo-load]').forEach((b) => b.addEventListener('click', () => loadPromos(b.dataset.promoLoad)));
document.querySelectorAll('#promoDlg [data-close]').forEach((b) => b.addEventListener('click', () => $('promoDlg').close()));
document.querySelectorAll('#promoConfirmDlg [data-close]').forEach((b) => b.addEventListener('click', () => $('promoConfirmDlg').close()));
$('promoConfirmBtn').addEventListener('click', async () => { $('promoConfirmDlg').close(); const f = promoConfirmAct; promoConfirmAct = null; if (f) await f(); });
async function loadPromoWins() {
  const st = $('pwStatusLine'), el = $('pwTable');
  const p = new URLSearchParams({ limit: '5000' });
  const v = (id) => ($(id) ? $(id).value.trim() : '');
  if (v('pwOp')) p.set('operator_id', v('pwOp'));
  if (v('pwPlayer')) p.set('player', v('pwPlayer'));
  if (v('pwType')) p.set('type', v('pwType'));
  if (v('pwStatus')) p.set('status', v('pwStatus'));
  if (v('pwFrom')) p.set('from', new Date(v('pwFrom') + 'T00:00').toISOString());
  if (v('pwTo')) p.set('to', new Date(v('pwTo') + 'T23:59:59.999').toISOString());
  st.textContent = 'loading…';
  try {
    const d = await api('/admin/v1/promo-wins?' + p.toString());
    promoLastWins = d;
    st.textContent = d.total + (d.total === 1 ? ' prize' : ' prizes') + (d.totals.length ? ' · ' + d.totals.map((t) => fmtMoney(t.amount) + ' ' + esc(t.currency)).join(' · ') : '');
    el.innerHTML = d.wins.length ? winsTable(d.wins) : '<p class="muted">No prizes match.</p>';
    bindRetry(el, loadPromoWins);
  } catch (e) { st.textContent = e.message; el.innerHTML = ''; }
}
$('pwRun').addEventListener('click', loadPromoWins);
$('pwCsv').addEventListener('click', () => {
  const d = promoLastWins; if (!d || !d.wins.length) return;
  const cols = ['created_at', 'operator_id', 'operator_player_id', 'promo_type', 'promo_name', 'rank', 'round_ref', 'amount', 'currency', 'status', 'paid_at', 'operator_tx_ref'];
  const lines = [cols.join(',')].concat(d.wins.map((r) => cols.map((c) => csvCell(r[c])).join(',')));
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([lines.join('\\r\\n') + '\\r\\n'], { type: 'text/csv;charset=utf-8' }));
  a.download = 'promo-wins.csv'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
`;
