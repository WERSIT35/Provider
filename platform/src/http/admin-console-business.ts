/**
 * Intelligence views of both consoles: Business Summary, Games Profit Summary and
 * Member Business Summary. One filter bar and one renderer over
 * GET /admin/v1/reports/business (admin-reports.routes.ts); the three views differ
 * only in how rows are grouped. Spliced into /console/app.js (admin-assets.ts).
 */

interface BizView { id: string; title: string; intro: string; player?: boolean; game?: boolean }

const VIEWS: BizView[] = [
  { id: "bizSummary", title: "Business Summary", intro: "Totals for every period: new players, stakes, wins, margin, play sessions and operator free rounds." },
  { id: "gamesProfit", title: "Games Profit Summary", intro: "Stakes, wins and margin per game, cash play and free rounds side by side.", game: true },
  { id: "memberBiz", title: "Member Business Summary", intro: "The same totals per player, for the whole range or one row per player per day.", player: true }
];

const COMMENTS = /* html */ `
<details class="defs"><summary>How these numbers are counted</summary><dl>
  <dt>Period</dt><dd>The first day of the day, week (Monday), month or year, cut in the chosen time zone.</dd>
  <dt>New players</dt><dd>Players whose first round ever falls in the row.</dd>
  <dt>Stakes</dt><dd>What players were charged. A feature's own free spins charge nothing; voided rounds are left out.</dd>
  <dt>Wins</dt><dd>What cash rounds and their features paid.</dd>
  <dt>Free rounds</dt><dd>Operator-granted free rounds (Campaigns): how many were played, their stake value (the grant's bet, never charged) and what they paid.</dd>
  <dt>Margin</dt><dd>Stakes − (wins + free-round wins): what the casino kept.</dd>
  <dt>Play sessions</dt><dd>Game sessions with a round in the row.</dd>
  <dt>Currency</dt><dd>Each currency has its own rows; amounts are never converted.</dd>
</dl></details>`;

function section(v: BizView): string {
  const p = v.id;
  return /* html */ `
<section id="${p}View" hidden>
  <div class="panel">
    <p class="kicker">Intelligence</p>
    <h2>${v.title}</h2>
    <p class="muted">${v.intro}</p>
    <div class="filters" data-biz="${p}">
      <label>From <input type="date" data-f="from"/></label>
      <label>To <input type="date" data-f="to"/></label>
      <div class="quick" role="group" aria-label="Quick ranges">
        <button class="ghost" data-range="today">Today</button>
        <button class="ghost" data-range="yesterday">Previous day</button>
        <button class="ghost" data-range="month">This month</button>
        <button class="ghost" data-range="prevmonth">Previous month</button>
      </div>
      <label>${v.player ? "Rows" : "Total by"} <select data-f="period">
        ${v.player ? '<option value="total">one per player</option><option value="day">per player per day</option>'
          : `<option value="day">day</option><option value="week">week</option><option value="month">month</option><option value="year">year</option>${v.game ? '<option value="total" selected>whole range</option>' : ""}`}
      </select></label>
      <label>Time zone <select data-f="tz"></select></label>
      ${v.player ? '<label>Player id <input data-f="player" placeholder="all players"/></label>' : ""}
      <label>Game <input data-f="game" placeholder="all games"/></label>
      <label data-provider>Operator id <input data-f="op" placeholder="all operators"/></label>
      <div class="go"><button data-act="run">Show</button><button class="ghost" data-act="csv">Export CSV</button></div>
    </div>
    <p class="muted" data-f="status"></p>
    <div data-f="table"></div>
    ${COMMENTS}
  </div>
</section>`;
}

export const SECTION_BUSINESS = VIEWS.map(section).join("\n");
export const BUSINESS_VIEW_IDS = VIEWS.map((v) => v.id);

export const BUSINESS_JS = /* js */ `
// ── Intelligence: Business Summary / Games Profit / Member Business ─────────
const BIZ = {
  bizSummary: { by: '', cols: ['period','currency','new_players','bets_real','wins_real','margin','play_sessions','free_rounds','free_round_bet','free_round_win'] },
  gamesProfit: { by: 'game', cols: ['period','game_code','currency','rounds','bets_real','free_round_bet','wins_real','free_round_win','margin'] },
  memberBiz: { by: 'player', cols: ['period','operator_player_id','currency','rounds','play_sessions','bets_real','wins_real','free_rounds','free_round_win','margin'] }
};
const BIZ_HEAD = { period: 'Period', currency: 'Currency', new_players: 'New players', bets_real: 'Stakes', wins_real: 'Wins', margin: 'Margin',
  play_sessions: 'Play sessions', free_rounds: 'Free rounds', free_round_bet: 'Free-round stake', free_round_win: 'Free-round wins',
  game_code: 'Game', rounds: 'Rounds', operator_player_id: 'Player' };
const BIZ_MONEY = new Set(['bets_real','wins_real','margin','free_round_bet','free_round_win']);
const bizLast = {};
const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
function bizRoot(id) { return document.querySelector('[data-biz="' + id + '"]'); }
function bizField(id, f) { return document.querySelector('#' + id + 'View [data-f="' + f + '"]'); }
function bizInit(id) {
  const root = bizRoot(id); if (!root || root.dataset.ready) return; root.dataset.ready = '1';
  const tz = bizField(id, 'tz'); const mine = -new Date().getTimezoneOffset();
  const offs = []; for (let m = -720; m <= 840; m += 30) offs.push(m);
  if (!offs.includes(mine)) offs.push(mine);
  tz.innerHTML = offs.sort((a, b) => a - b).map(m => '<option value="' + m + '"' + (m === mine ? ' selected' : '') + '>UTC' + (m < 0 ? '−' : '+') + pad2(Math.floor(Math.abs(m) / 60)) + ':' + pad2(Math.abs(m) % 60) + '</option>').join('');
  bizRange(id, 'today');
  root.querySelectorAll('[data-range]').forEach(b => b.addEventListener('click', () => { bizRange(id, b.dataset.range); loadBiz(id); }));
  root.querySelector('[data-act="run"]').addEventListener('click', () => loadBiz(id));
  root.querySelector('[data-act="csv"]').addEventListener('click', () => exportBizCsv(id));
  root.querySelectorAll('input').forEach(i => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') loadBiz(id); }));
}
function bizRange(id, which) {
  const now = new Date(); let a = new Date(now), b = new Date(now);
  if (which === 'yesterday') { a.setDate(a.getDate() - 1); b = new Date(a); }
  if (which === 'month') a = new Date(now.getFullYear(), now.getMonth(), 1);
  if (which === 'prevmonth') { a = new Date(now.getFullYear(), now.getMonth() - 1, 1); b = new Date(now.getFullYear(), now.getMonth(), 0); }
  bizField(id, 'from').value = ymd(a); bizField(id, 'to').value = ymd(b);
}
// A calendar day in the chosen offset, as UTC instants.
function bizInstant(date, tzMin, endOfDay) {
  const [y, m, d] = date.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0) - tzMin * 60000;
  return new Date(t).toISOString();
}
function bizQs(id) {
  const tz = Number(bizField(id, 'tz').value || 0);
  const p = new URLSearchParams({ period: bizField(id, 'period').value, tz: String(tz), limit: '5000' });
  if (BIZ[id].by) p.set('by', BIZ[id].by);
  const from = bizField(id, 'from').value, to = bizField(id, 'to').value;
  if (from) p.set('from', bizInstant(from, tz, false));
  if (to) p.set('to', bizInstant(to, tz, true));
  const pl = bizField(id, 'player'); if (pl && pl.value.trim()) p.set('player', pl.value.trim());
  const g = bizField(id, 'game'); if (g && g.value.trim()) p.set('game', g.value.trim());
  const op = bizField(id, 'op'); if (op && op.value.trim()) p.set('operator_id', op.value.trim());
  return '?' + p.toString();
}
function bizCell(r, c) {
  const v = r[c];
  if (c === 'period') return v ? esc(v) : '<span class="muted">' + (r.__total ? 'Total' : 'whole range') + '</span>';
  if (c === 'operator_player_id') return v ? '<code>' + esc(v) + '</code>' : '';
  if (BIZ_MONEY.has(c)) return '<span' + (c === 'margin' && v < 0 ? ' class="err"' : '') + '>' + fmtMoney(v) + '</span>';
  return esc(v == null ? '' : v);
}
async function loadBiz(id) {
  bizInit(id);
  const st = bizField(id, 'status'), el = bizField(id, 'table');
  st.className = 'muted'; st.textContent = 'loading…';
  try {
    const d = await api('/admin/v1/reports/business' + bizQs(id));
    bizLast[id] = d;
    const cols = BIZ[id].cols.filter(c => c !== 'period' || d.period !== 'total');
    st.textContent = d.total_rows + (d.total_rows === 1 ? ' row' : ' rows') + (d.count < d.total_rows ? ' (first ' + d.count + ' shown)' : '') + ' · generated ' + d.generated_at.replace('T', ' ').slice(0, 16) + ' UTC';
    if (!d.rows.length) { el.innerHTML = '<p class="muted">No rounds in this range.</p>'; return; }
    const head = '<tr>' + cols.map(c => '<th' + (BIZ_MONEY.has(c) || /rounds|players|sessions/.test(c) ? ' class="num"' : '') + '>' + BIZ_HEAD[c] + '</th>').join('') + '</tr>';
    const row = (r, cls) => '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cols.map((c, i) => '<td' + (BIZ_MONEY.has(c) || /rounds|players|sessions/.test(c) ? ' class="num"' : '') + '>' + (i === 0 && r.__total && c !== 'period' ? 'Total' : bizCell(r, c)) + '</td>').join('') + '</tr>';
    el.innerHTML = '<div class="tbl-wrap tall"><table class="ip-table biz">' + head + d.rows.map(r => row(r, id === 'memberBiz' ? 'clickable' : '')).join('') +
      d.totals.map(t => row(Object.assign({ __total: true }, t), 'total')).join('') + '</table></div>';
    if (id === 'memberBiz') el.querySelectorAll('tr.clickable').forEach((tr, i) => tr.addEventListener('click', () => {
      const r = d.rows[i]; if (!r || !r.operator_player_id) return;
      if ($('plOp')) $('plOp').value = r.operator_id || ''; $('plPlayer').value = r.operator_player_id; show('players'); loadPlayer();
    }));
  } catch (e) { flash(st, e.message, false); el.innerHTML = ''; }
}
async function exportBizCsv(id) {
  await loadBiz(id);
  const d = bizLast[id]; if (!d || !d.rows.length) return;
  const cols = (state.scope === 'provider' && id === 'memberBiz' ? ['operator_id'] : []).concat(BIZ[id].cols);
  const lines = [cols.map(c => csvCell(BIZ_HEAD[c] || c)).join(',')].concat(d.rows.map(r => cols.map(c => csvCell(r[c])).join(',')));
  const blob = new Blob([lines.join('\\r\\n') + '\\r\\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = id + '-' + ymd(new Date()) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
`;
