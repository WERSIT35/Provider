/**
 * Campaign Manager view logic (operator free rounds) for the shared console script.
 * Concatenated into /console/app.js by admin-assets.ts, in the same scope as the shell,
 * so it uses the shell's helpers ($, api, state, esc, fmtMoney, hasPerm).
 *
 * Wired to /admin/v1/campaigns*: list, detail (grants), create, grant players, cancel.
 * Lifecycle state (active / scheduled / expired / cancelled) comes from the server clock;
 * write controls only render for roles with campaigns.write (the API enforces it anyway).
 * Every API value is escaped before it reaches the DOM.
 */
export const CAMPAIGNS_JS = /* js */ `
const camp = { list: [], games: [], current: null, openId: null };
const campIsProvider = () => state.scope === 'provider';
const campLocal = (iso) => { const d = new Date(iso); return isNaN(d) ? esc(iso) : d.toLocaleString(undefined, { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); };
const campInputValue = (d) => { const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const campBadge = (s) => '<span class="badge ' + esc(s) + '">' + esc(s) + '</span>';
const campIds = (text) => Array.from(new Set(String(text || '').split(/[\\s,;]+/).map((s) => s.trim()).filter(Boolean)));
const campPlural = (n, word) => n + ' ' + word + (n === 1 ? '' : 's');
function campShowMsg(el, msg, ok) { if (!el) return; el.hidden = false; el.className = 'status ' + (ok ? 'ok' : 'err'); el.textContent = msg; }

async function loadCampaigns() {
  const st = $('campStatus'), el = $('campTable');
  document.querySelectorAll('[data-campaigns-write]').forEach((e) => { e.hidden = !hasPerm('campaigns.write'); });
  st.textContent = 'loading…';
  try {
    const op = campIsProvider() ? $('campOp').value.trim() : '';
    const d = await api('/admin/v1/campaigns' + (op ? '?operator_id=' + encodeURIComponent(op) : ''));
    camp.list = d.campaigns.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    renderCampaigns();
    if (camp.openId) openCampaignDrawer(camp.openId, true);
  } catch (e) { st.textContent = ''; el.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
}

function renderCampaigns() {
  const want = $('campState').value;
  const rows = want ? camp.list.filter((c) => c.state === want) : camp.list;
  const canWrite = hasPerm('campaigns.write');
  $('campStatus').textContent = campPlural(rows.length, (want ? want + ' ' : '') + 'campaign');
  const el = $('campTable');
  if (!rows.length) {
    el.innerHTML = '<p class="muted">' + (camp.list.length ? 'No campaigns with this status.' : 'No campaigns yet.' + (canWrite ? ' Create one with "+ New campaign".' : '')) + '</p>';
    return;
  }
  el.innerHTML = '<table><thead><tr><th>Campaign</th>' + (campIsProvider() ? '<th>Operator</th>' : '') +
    '<th>Game</th><th class="num">Bet</th><th class="num">Spins / player</th><th>Valid</th><th class="num">Players</th>' +
    '<th class="num">Spins left</th><th class="num">Won</th><th>Status</th><th></th></tr></thead><tbody>' +
    rows.map((c) => {
      const live = c.state === 'active' || c.state === 'scheduled';
      return '<tr data-row="' + esc(c.id) + '">' +
        '<td><b>' + esc(c.name) + '</b><br/><code class="muted">' + esc(c.id) + '</code></td>' +
        (campIsProvider() ? '<td><code>' + esc(String(c.operator_id).slice(0, 8)) + '…</code></td>' : '') +
        '<td class="nowrap"><code>' + esc(c.game_code || c.game_id) + '</code> · ' + esc(c.currency) + '</td>' +
        '<td class="num">' + fmtMoney(c.bet_amount) + '</td>' +
        '<td class="num">' + esc(c.total_spins) + '</td>' +
        '<td class="nowrap">' + campLocal(c.valid_from) + '<br/><span class="muted">→</span> ' + campLocal(c.valid_to) + '</td>' +
        '<td class="num">' + esc(c.players) + '</td>' +
        '<td class="num">' + esc(c.spins_remaining) + '</td>' +
        '<td class="num">' + fmtMoney(c.total_won) + '</td>' +
        '<td>' + campBadge(c.state) + '</td>' +
        '<td class="actions">' +
          '<button type="button" class="ghost" data-act="players" data-id="' + esc(c.id) + '">Players</button> ' +
          (canWrite && live ? '<button type="button" data-act="grant" data-id="' + esc(c.id) + '">Grant spins</button> ' +
                              '<button type="button" class="danger" data-act="cancel" data-id="' + esc(c.id) + '">Cancel</button>' : '') +
        '</td></tr>';
    }).join('') + '</tbody></table>';
}

$('campTable').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-act]');
  if (!b) return;
  const c = camp.list.find((x) => x.id === b.dataset.id);
  if (!c) return;
  if (b.dataset.act === 'players') openCampaignDrawer(c.id);
  if (b.dataset.act === 'grant') openGrantDialog(c);
  if (b.dataset.act === 'cancel') openCancelDialog(c);
});
$('campState').addEventListener('change', renderCampaigns);
$('campRefresh').addEventListener('click', loadCampaigns);
document.querySelectorAll('dialog.modal [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

// ── grants drawer ──
async function openCampaignDrawer(id, quiet) {
  const el = $('campDrawer');
  camp.openId = id;
  if (!quiet) { el.hidden = false; el.innerHTML = '<p class="muted">loading players…</p>'; }
  try {
    const d = await api('/admin/v1/campaigns/' + encodeURIComponent(id));
    const c = d.campaign;
    el.hidden = false;
    el.innerHTML = '<div class="toolbar"><b>Players in ' + esc(c.name) + '</b> ' + campBadge(c.state) +
      '<span class="muted">' + campPlural(c.players, 'player') + ' · ' + esc(c.spins_remaining) + ' spins left · won ' + fmtMoney(c.total_won) + ' ' + esc(c.currency) + '</span>' +
      '<button type="button" class="ghost" id="campDrawerClose">Close</button></div>' +
      (!d.grants.length ? '<p class="muted">No players granted yet.</p>' :
        '<table><thead><tr><th>Player</th><th class="num">Granted</th><th class="num">Remaining</th><th class="num">Won</th><th>Status</th><th>Updated</th></tr></thead><tbody>' +
        d.grants.map((g) => '<tr><td><code>' + esc(g.operator_player_id) + '</code></td><td class="num">' + esc(g.spins_granted) + '</td>' +
          '<td class="num">' + esc(g.spins_remaining) + '</td><td class="num">' + fmtMoney(g.total_won) + '</td>' +
          '<td>' + campBadge(g.status) + '</td><td>' + campLocal(g.updated_at) + '</td></tr>').join('') + '</tbody></table>');
    $('campDrawerClose').addEventListener('click', () => { camp.openId = null; el.hidden = true; el.innerHTML = ''; });
  } catch (e) { el.hidden = false; el.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; }
}

// ── create ──
async function loadCampaignGames() {
  const sel = $('ccGame');
  const op = campIsProvider() ? $('ccOp').value.trim() : '';
  if (campIsProvider() && !op) { camp.games = []; sel.innerHTML = '<option value="">enter an operator id first</option>'; fillCampaignBets(); return; }
  try {
    const d = await api('/admin/v1/operator-games' + (op ? '?operator_id=' + encodeURIComponent(op) : ''));
    camp.games = (d.operator_games || []).filter((g) => g.status === 'enabled' && g.game_code);
    sel.innerHTML = camp.games.length
      ? camp.games.map((g, i) => '<option value="' + i + '">' + esc(g.game_title || g.game_code) + ' (' + esc(g.game_code) + ') · ' + esc(g.currency) + '</option>').join('')
      : '<option value="">no enabled games</option>';
  } catch (e) { camp.games = []; sel.innerHTML = '<option value="">' + esc(e.message) + '</option>'; }
  fillCampaignBets();
}
// The bet list is exactly the chosen game's allowed bets: free rounds can't use a stake the casino doesn't sell.
function fillCampaignBets() {
  const g = camp.games[Number($('ccGame').value)];
  const bets = g ? g.allowed_bets.slice().sort((a, b) => a - b) : [];
  $('ccBet').innerHTML = bets.length ? bets.map((b) => '<option value="' + b + '">' + fmtMoney(b) + ' ' + esc(g.currency) + '</option>').join('') : '<option value="">—</option>';
}
$('ccGame').addEventListener('change', fillCampaignBets);
// A validation message goes stale the moment the user edits the form.
$('campCreateForm').addEventListener('input', () => { $('ccMsg').hidden = true; });
$('campGrantForm').addEventListener('input', () => { $('cgMsg').hidden = true; });
$('ccOp').addEventListener('change', loadCampaignGames);
$('campNewBtn').addEventListener('click', async () => {
  const now = new Date(); now.setSeconds(0, 0);
  $('campCreateForm').reset();
  $('ccMsg').hidden = true;
  $('ccFrom').value = campInputValue(now);
  $('ccTo').value = campInputValue(new Date(now.getTime() + 7 * 864e5));
  if (campIsProvider()) $('ccOp').value = $('campOp').value.trim();
  $('campCreateDlg').showModal();
  await loadCampaignGames();
  $('ccName').focus();
});
$('campCreateForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('ccMsg');
  const g = camp.games[Number($('ccGame').value)];
  const name = $('ccName').value.trim();
  const spins = Number($('ccSpins').value);
  const from = new Date($('ccFrom').value), to = new Date($('ccTo').value);
  if (!name) return campShowMsg(msg, 'Give the campaign a name.', false);
  if (!g) return campShowMsg(msg, 'Choose a game.', false);
  if (!Number.isInteger(spins) || spins < 1 || spins > 1000) return campShowMsg(msg, 'Spins per player must be a whole number from 1 to 1000.', false);
  if (isNaN(from) || isNaN(to) || to <= from) return campShowMsg(msg, 'The end of the window must be after its start.', false);
  if (to <= new Date()) return campShowMsg(msg, 'The window must end in the future.', false);
  const players = campIds($('ccPlayers').value);
  const btn = $('ccSubmit'); btn.disabled = true;
  try {
    const body = { name, game_code: g.game_code, currency: g.currency, bet_amount: Number($('ccBet').value), total_spins: spins,
      valid_from: from.toISOString(), valid_to: to.toISOString() };
    if (campIsProvider()) body.operator_id = $('ccOp').value.trim();
    const d = await api('/admin/v1/campaigns', { method: 'POST', body });
    let note = 'Created "' + name + '".';
    if (players.length) {
      const r = await api('/admin/v1/campaigns/' + encodeURIComponent(d.campaign.id) + '/players', { method: 'POST', body: { player_ids: players } });
      note += ' Granted ' + campPlural(r.granted, 'player') + (r.skipped.length ? ' (skipped ' + r.skipped.length + ')' : '') + '.';
    }
    $('campCreateDlg').close();
    camp.openId = d.campaign.id;
    await loadCampaigns();
    $('campStatus').textContent = note;
  } catch (e) { campShowMsg(msg, e.message, false); }
  finally { btn.disabled = false; }
});

// ── grant ──
function openGrantDialog(c) {
  camp.current = c;
  $('campGrantForm').reset();
  $('cgMsg').hidden = true;
  $('cgInfo').textContent = c.name + ': ' + c.total_spins + ' spins at ' + fmtMoney(c.bet_amount) + ' ' + c.currency + ' each, valid until ' + new Date(c.valid_to).toLocaleString() + '.';
  $('campGrantDlg').showModal();
  $('cgPlayers').focus();
}
$('campGrantForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const msg = $('cgMsg'), c = camp.current;
  const ids = campIds($('cgPlayers').value);
  if (!ids.length) return campShowMsg(msg, 'Enter at least one player id.', false);
  const btn = $('cgSubmit'); btn.disabled = true;
  try {
    const r = await api('/admin/v1/campaigns/' + encodeURIComponent(c.id) + '/players', { method: 'POST', body: { player_ids: ids } });
    campShowMsg(msg, 'Granted ' + campPlural(r.granted, 'player') + '.' + (r.skipped.length ? ' Already in this campaign: ' + r.skipped.join(', ') + '.' : ''), true);
    $('cgPlayers').value = '';
    camp.openId = c.id;
    loadCampaigns();
  } catch (e) { campShowMsg(msg, e.message, false); }
  finally { btn.disabled = false; }
});

// ── cancel ──
function openCancelDialog(c) {
  camp.current = c;
  $('cfText').textContent = '"' + c.name + '" stops now. ' + campPlural(c.spins_remaining, 'unplayed spin') + ' across ' + campPlural(c.players, 'player') +
    ' will be withdrawn. Rounds already played stand. This cannot be undone.';
  $('campConfirmDlg').showModal();
}
$('cfConfirm').addEventListener('click', async () => {
  const c = camp.current, btn = $('cfConfirm');
  btn.disabled = true;
  try {
    const r = await api('/admin/v1/campaigns/' + encodeURIComponent(c.id) + '/cancel', { method: 'POST', body: {} });
    $('campConfirmDlg').close();
    await loadCampaigns();
    $('campStatus').textContent = 'Cancelled "' + c.name + '": ' + campPlural(r.grants_cancelled, 'grant') + ' withdrawn.';
  } catch (e) { $('cfText').textContent = e.message; }
  finally { btn.disabled = false; }
});
`;
