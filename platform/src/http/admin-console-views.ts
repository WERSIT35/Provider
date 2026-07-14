/**
 * View-logic blocks for the shared console script (admin-assets.ts). These are the
 * per-view functions (inspector, onboarding, reports, games, disputes, players,
 * operators, admin-accounts) concatenated into /console/app.js. They run in the
 * same scope as the shell, so they reference its helpers ($, api, show, state,
 * cardHtml, tableHtml, flash, esc, fmtMoney, fmt, setHTML) directly.
 *
 * Behaviour is unchanged from the original single-file console except the new
 * accounts block. Each loader only runs when its view is present in the page, so
 * the operator console (which omits onboarding/operators/accounts) is unaffected.
 */

export const INSPECTOR_JS = /* js */ `
let inspectorRound = null; let stepIdx = 0; let playTimer = null;
const SYMBOL_LABELS = {
  TOP_CROWN:'crown', HOURGLASS:'hourglass', RING:'ring', CHALICE:'chalice', RED_GEM:'gem',
  PURPLE_TRIANGLE:'purple', YELLOW_HEX:'yellow', GREEN_TRIANGLE:'green', BLUE_DIAMOND:'diamond', SCATTER:'scatter'
};
function symbolImageUrl(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  return '/assets/symbols/' + encodeURIComponent(c) + '.png';
}
function multiValueFromCode(code) { const m = /MULTI(\\d+)/i.exec(String(code || '')); return m ? Number(m[1]) : null; }
async function lookupRound() {
  const ref = $('roundRefInput').value.trim();
  $('inspectorContent').innerHTML = ''; clearFlash($('inspectorStatus'));
  if (!ref) { flash($('inspectorStatus'), 'paste a Round ID first', false); return; }
  $('inspectorStatus').className = 'muted'; $('inspectorStatus').textContent = 'looking up…'; $('inspectorStatus').hidden = false;
  try {
    const data = await api('/admin/v1/rounds/' + encodeURIComponent(ref));
    inspectorRound = data; stepIdx = 0; renderInspector();
    $('inspectorStatus').textContent = ''; $('inspectorStatus').className = 'ok';
  } catch (e) {
    inspectorRound = null;
    if (e.status === 404) renderInspectorEmpty(ref); else flash($('inspectorStatus'), e.message, false);
  }
}
function renderInspectorEmpty(ref) {
  $('inspectorContent').innerHTML = '<div class="panel"><h2>Not found</h2>' +
    '<p>No round matches <code>'+esc(ref)+'</code> — check that you copied the full ID (it looks like <code>r_…</code>) ' +
    'and that you have permission to view this round.</p></div>';
  $('inspectorStatus').textContent = '';
}
function renderInspector() {
  if (!inspectorRound) return;
  const r = inspectorRound; const outcome = r.outcome || {};
  const steps = Array.isArray(outcome.tumble_steps) ? outcome.tumble_steps : [];
  const initialMatrix = outcome.matrix;
  const totalStages = 1 + steps.length;
  if (stepIdx >= totalStages) stepIdx = totalStages - 1; if (stepIdx < 0) stepIdx = 0;
  const wins = Array.isArray(outcome.ways_wins) ? outcome.ways_wins : [];
  const totalSymbolsCaught = wins.reduce((s, w) => s + (Number(w.count) || 0), 0);
  const biggest = wins.slice().sort((a,b) => (Number(b.amount)||0) - (Number(a.amount)||0))[0];
  const multipliers = Array.isArray(outcome.multipliers) ? outcome.multipliers : [];
  const text = '' +
  '<div class="panel"><h2>Round details</h2><div class="kv">' +
      kv('Round ID', '<code>'+r.round_ref+'</code>') +
      kv('Operator', r.operator ? (esc(r.operator.name) + ' <span class="muted">('+esc(r.operator.slug)+')</span>') : r.operator_id) +
      kv('Game', r.game ? (esc(r.game.title) + ' <span class="muted">'+esc(r.game.code)+'</span>') : r.game_id) +
      kv('Math config', r.math_config ? (r.math_config.version + ' · RTP ' + r.math_config.theoretical_rtp + '% · ' + r.math_config.status) : r.math_config_id) +
      kv('Currency', r.currency || '—') +
      kv('Bet', fmtMoney(r.bet_amount) + (r.ante_enabled ? ' (ante)' : '')) +
      kv('Bet charged', fmtMoney(r.bet_charged)) +
      kv('Total win', '<b'+(r.total_win > 0 ? ' class="ok"' : '')+'>'+fmtMoney(r.total_win)+'</b>') +
      kv('Multiplier applied', r.multiplier_applied + '×') +
      kv('Free spin?', r.is_free_spin ? 'yes' : 'no') +
      kv('Free spins awarded', outcome.free_spins_awarded ?? 0) +
      kv('Scatters', outcome.scatter_count ?? 0) +
      kv('Status', r.status) + kv('Created at', r.created_at) +
      kv('Outcome hash', '<code>'+r.outcome_hash+'</code>') +
      kv('RNG', r.rng_algo + ' (seed ref)') + kv('Seq', r.chain?.seq) +
    '</div></div>' +
  '<div class="panel"><h2>What the player caught</h2><div class="cards">' +
      cardHtml('symbols caught', totalSymbolsCaught) + cardHtml('clusters', wins.length) +
      cardHtml('biggest cluster', biggest ? (biggest.symbol+' ×'+biggest.count+' = '+fmtMoney(biggest.amount)) : '—') +
      cardHtml('multipliers', multipliers.length) + cardHtml('tumble steps', steps.length) +
    '</div>' +
    (outcome.free_spins_awarded ? '<div class="banner fs">🎁 Free spins triggered: '+outcome.free_spins_awarded+'</div>' : '') +
    (r.is_free_spin ? '<div class="banner bonus">⭐ This spin was a FREE SPIN</div>' : '') +
    '<h2 style="margin-top:14px;">Per-step breakdown</h2><div class="breakdown">' + buildBreakdown(steps) + '</div></div>';
  const visual = '<div class="panel"><h2>Visual playback</h2>' + renderStageHtml(outcome, initialMatrix, steps, stepIdx) + renderStepControls(totalStages) + '</div>';
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
    return '<details '+(i===0?'open':'')+'><summary>Step '+(i+1)+' · win '+fmtMoney(s.win_total)+' · '+winPos+' cells highlighted</summary><ul>'+wins+mults+'</ul></details>';
  }).join('');
}
function renderStageHtml(outcome, initialMatrix, steps, idx) {
  let matrix, winningPositions = [], stepWin = 0, stepMultipliers = [], stepLabel = '';
  if (idx === 0) { matrix = initialMatrix; stepLabel = 'Initial board'; }
  else { const s = steps[idx - 1] || {}; matrix = s.matrix; winningPositions = s.winning_positions || []; stepWin = s.win_total || 0; stepMultipliers = s.multipliers || []; stepLabel = 'Tumble step ' + idx + ' / ' + steps.length; }
  const rows = matrix?.length ?? 5, cols = matrix?.[0]?.length ?? 6;
  const winSet = new Set(winningPositions.map(p => p.row+','+p.col));
  const multiMap = new Map();
  for (const m of stepMultipliers) { if (m && typeof m.row === 'number' && typeof m.col === 'number') { multiMap.set(m.row+','+m.col, (m.value ?? multiValueFromCode(m.code) ?? '×')); } }
  let html = '<div class="totals">' +
    '<div class="t">Stage: <b>'+stepLabel+'</b></div>' +
    (idx > 0 ? '<div class="t">Step win: <b class="ok">+'+fmtMoney(stepWin)+'</b></div>' : '') +
    '<div class="t">Running total: <b>'+fmtMoney(runningTotal(steps, idx))+'</b></div>' +
    '<div class="t">Final win: <b>'+fmtMoney(outcome.total_win || 0)+'</b></div>' +
    (outcome.multiplier_applied && outcome.multiplier_applied !== 1 ? '<div class="t">Multiplier applied: <b>'+outcome.multiplier_applied+'×</b></div>' : '') + '</div>';
  html += '<div class="matrix" style="grid-template-columns: repeat('+cols+',1fr); margin-top:10px;">';
  for (let r = 0; r < rows; r++) { for (let c = 0; c < cols; c++) {
      const sym = matrix?.[r]?.[c]; const isWin = winSet.has(r+','+c);
      const isScatter = String(sym||'').toUpperCase() === 'SCATTER';
      const multiBadge = multiMap.get(r+','+c) ?? (String(sym||'').toUpperCase().startsWith('MULTI') ? multiValueFromCode(sym) : null);
      const url = sym ? symbolImageUrl(sym) : null;
      html += '<div class="cell ' + (isWin?'win ':'') + (isScatter?'scatter':'') + '" data-rc="'+r+','+c+'">';
      if (url) html += '<img src="'+url+'" alt="'+sym+'" onerror="this.style.display=\\'none\\'; this.parentElement.querySelector(\\'.lbl\\').style.display=\\'block\\';"/>';
      html += '<span class="lbl" style="display:'+(url?'none':'block')+';">'+(SYMBOL_LABELS[String(sym||'').toUpperCase()] || sym || '')+'</span>';
      if (multiBadge != null) html += '<span class="mbadge">'+multiBadge+'×</span>';
      html += '</div>';
  } }
  html += '</div>'; return html;
}
function runningTotal(steps, idx) { if (idx === 0) return 0; let s = 0; for (let i = 0; i < idx; i++) s += Number(steps[i]?.win_total || 0); return s; }
function renderStepControls(totalStages) {
  return '<div class="step-ctrl"><button class="ghost" id="prevStep">⏮ Prev</button><button id="playStep">▶ Play</button>' +
    '<button class="ghost" id="nextStep">Next ⏭</button><span class="muted">stage <b id="stepLabel">'+(stepIdx+1)+'</b> / '+totalStages+'</span></div>';
}
function bindStepControls(totalStages) {
  const goto = (i) => { stepIdx = Math.max(0, Math.min(totalStages-1, i)); renderInspector(); };
  $('prevStep').onclick = () => { stopPlay(); goto(stepIdx - 1); };
  $('nextStep').onclick = () => { stopPlay(); goto(stepIdx + 1); };
  $('playStep').onclick = () => togglePlay(totalStages);
  document.addEventListener('keydown', handleKeyNav);
}
function handleKeyNav(e) {
  const iv = $('inspectorView'); if (!iv || iv.hidden) return;
  if (e.target && /(INPUT|TEXTAREA|SELECT)/.test(e.target.tagName)) return;
  if (e.key === 'ArrowLeft') document.getElementById('prevStep')?.click();
  if (e.key === 'ArrowRight') document.getElementById('nextStep')?.click();
  if (e.key === ' ') { e.preventDefault(); document.getElementById('playStep')?.click(); }
}
function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; const b = $('playStep'); if (b) b.textContent = '▶ Play'; } }
function togglePlay(totalStages) {
  if (playTimer) { stopPlay(); return; }
  const b = $('playStep'); if (b) b.textContent = '⏸ Pause';
  playTimer = setInterval(() => { if (stepIdx >= totalStages - 1) { stopPlay(); return; } stepIdx += 1; renderInspector(); }, 900);
}
`;

export const ONBOARDING_JS = /* js */ `
async function refreshOnboardingDropdowns() {
  try { if (state.scope === 'provider') { const ops = await api('/admin/v1/operators'); state.operators = ops.operators || []; } } catch {}
  try { const data = await api('/admin/v1/games'); state.games = data.games || []; state.mathConfigs = data.math_configs || []; } catch {}
  const fillOps = (selId) => { const sel = $(selId); if (!sel) return; sel.innerHTML = state.operators.map(o => '<option value="'+o.id+'">'+esc(o.slug)+' — '+esc(o.name)+'</option>').join(''); };
  ['domainOp','credOp','asnOp','launchOp','acctOp'].forEach(fillOps);
  const fillGames = (selId) => { const sel = $(selId); if (!sel) return; sel.innerHTML = state.games.map(g => '<option value="'+g.id+'">'+esc(g.code)+' — '+esc(g.title)+'</option>').join(''); };
  ['mcGame','asnGame'].forEach(fillGames);
  const sel = $('asnConfig'); if (sel) sel.innerHTML = state.mathConfigs.map(c => '<option value="'+c.id+'">'+c.version+' · '+c.status+' · RTP '+c.theoretical_rtp+'%</option>').join('');
}
async function createOperator() {
  clearFlash($('opResult'));
  const name = $('opName').value.trim(), slug = $('opSlug').value.trim(), default_currency = $('opCurrency').value.trim() || 'GEL';
  if (!name || !slug) return flash($('opResult'), 'name and slug are required', false);
  try { const data = await api('/admin/v1/operators', { method: 'POST', body: { name, slug, default_currency } }); flash($('opResult'), 'created operator '+data.operator.slug+' ('+data.operator.id+')', true); await refreshOnboardingDropdowns(); }
  catch (e) { flash($('opResult'), e.message, false); }
}
async function addDomain() {
  clearFlash($('domainResult'));
  const operatorId = $('domainOp').value, domain = $('domainHost').value.trim(), environment = $('domainEnv').value;
  if (!operatorId || !domain) return flash($('domainResult'), 'operator + domain required', false);
  try { const data = await api('/admin/v1/operators/'+operatorId+'/domains', { method: 'POST', body: { domain, environment } }); flash($('domainResult'), 'allowlisted '+data.domain.domain+' ('+data.domain.environment+')', true); }
  catch (e) { flash($('domainResult'), e.message, false); }
}
async function issueCredential() {
  clearFlash($('credResult'));
  const operatorId = $('credOp').value, environment = $('credEnv').value;
  if (!operatorId) return flash($('credResult'), 'operator required', false);
  try { const data = await api('/admin/v1/operators/'+operatorId+'/credentials', { method: 'POST', body: { environment } });
    $('credResult').hidden = false; $('credResult').className = 'status ok';
    $('credResult').innerHTML = 'issued credential (secret shown ONCE — copy now):<pre class="code">api_key_id: '+data.credential.api_key_id+'\\napi_secret: '+data.api_secret+'</pre>';
  } catch (e) { flash($('credResult'), e.message, false); }
}
async function registerGame() {
  clearFlash($('gameResult'));
  const code = $('gameCode').value.trim(), title = $('gameTitle').value.trim();
  if (!code || !title) return flash($('gameResult'), 'code + title required', false);
  try { const data = await api('/admin/v1/games', { method: 'POST', body: { code, title } }); flash($('gameResult'), 'registered game '+data.game.code+' ('+data.game.id+')', true); await refreshOnboardingDropdowns(); }
  catch (e) { flash($('gameResult'), e.message, false); }
}
async function createMathConfig() {
  clearFlash($('mcResult'));
  const body = { game_id: $('mcGame').value, version: $('mcVersion').value.trim(), rtp_profile_key: $('mcKey').value.trim(), theoretical_rtp: Number($('mcRtp').value), config_hash: $('mcHash').value.trim() };
  if (!body.game_id || !body.version || !body.rtp_profile_key || !body.config_hash) return flash($('mcResult'), 'all fields required', false);
  try { const created = await api('/admin/v1/math-configs', { method: 'POST', body });
    const approved = await api('/admin/v1/math-configs/'+created.math_config.id+'/approve', { method: 'POST', body: {} });
    flash($('mcResult'), 'approved math config '+approved.math_config.id+' ('+approved.math_config.status+')', true); await refreshOnboardingDropdowns();
  } catch (e) { flash($('mcResult'), e.message, false); }
}
async function assignGame() {
  clearFlash($('asnResult'));
  const operatorId = $('asnOp').value, game_id = $('asnGame').value, math_config_id = $('asnConfig').value;
  const currency = $('asnCurrency').value.trim() || 'GEL';
  const allowed_bets = $('asnBets').value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
  if (!operatorId || !game_id || !math_config_id || !allowed_bets.length) return flash($('asnResult'), 'operator, game, config + at least one bet required', false);
  try { const data = await api('/admin/v1/operators/'+operatorId+'/assignments', { method: 'POST', body: { game_id, math_config_id, currency, allowed_bets } }); flash($('asnResult'), 'assigned ('+data.operator_game.id+', allowed bets: '+data.operator_game.allowed_bets.join(', ')+')', true); }
  catch (e) { flash($('asnResult'), e.message, false); }
}
async function launchDemo() {
  clearFlash($('launchResult'));
  const operatorId = $('launchOp').value;
  const body = { game_code: $('launchGame').value.trim(), operator_player_id: $('launchPlayer').value.trim(), currency: $('launchCurrency').value.trim(), origin: $('launchOrigin').value.trim() };
  if (!operatorId || !body.game_code || !body.operator_player_id || !body.currency || !body.origin) return flash($('launchResult'), 'all fields required (origin must be an allowlisted domain)', false);
  try { const data = await api('/admin/v1/operators/'+operatorId+'/launch-demo', { method: 'POST', body });
    $('launchResult').hidden = false; $('launchResult').className = 'status ok';
    $('launchResult').innerHTML = 'launch ready — <a target="_blank" rel="noopener" href="'+data.launch_url+'">open player ↗</a>';
  } catch (e) { flash($('launchResult'), e.message, false); }
}
`;

export const REPORTS_JS = /* js */ `
async function loadReports() {
  const ro = $('repOp'); const opId = ro ? ro.value.trim() : '';
  const qs = opId ? ('?operator_id=' + encodeURIComponent(opId)) : '';
  try { const s = await api('/admin/v1/reports/summary'+qs);
    setHTML('repSummary', '<div class="cards">' + cardHtml('rounds', s.rounds) + cardHtml('total bet', fmtMoney(s.total_bet)) + cardHtml('total win', fmtMoney(s.total_win)) + cardHtml('GGR', fmtMoney(s.ggr)) + cardHtml('hold %', s.hold_percent) + '</div>');
  } catch (e) { setHTML('repSummary', '<span class="err">'+e.message+'</span>'); }
  try { const r = await api('/admin/v1/reports/rtp'+qs);
    setHTML('repRtp', '<div class="cards">' + cardHtml('rounds', r.rounds) + cardHtml('total bet', fmtMoney(r.total_bet)) + cardHtml('total win', fmtMoney(r.total_win)) + cardHtml('actual RTP %', r.actual_rtp_percent) + '</div>');
  } catch (e) { setHTML('repRtp', '<span class="err">'+e.message+'</span>'); }
  try { const g = await api('/admin/v1/reports/ggr'+qs); setHTML('repGgr', tableHtml(g.ggr_by_day || [], ['date','rounds','total_bet','total_win','ggr'])); }
  catch (e) { setHTML('repGgr', '<span class="err">'+e.message+'</span>'); }
  try { const re = await api('/admin/v1/reports/reconciliation'+qs);
    setHTML('repRecon', '<div class="cards">' + cardHtml('ok', re.ok ? 'yes' : 'no') + cardHtml('rounds bet', fmtMoney(re.rounds_total_bet)) + cardHtml('rounds win', fmtMoney(re.rounds_total_win)) + cardHtml('debits (tx)', fmtMoney(re.tx_debits)) + cardHtml('credits (tx)', fmtMoney(re.tx_credits)) + cardHtml('rollbacks (tx)', fmtMoney(re.tx_rollbacks)) + cardHtml('bet vs debit diff', fmtMoney(re.bet_vs_debit_diff)) + cardHtml('win vs credit diff', fmtMoney(re.win_vs_credit_diff)) + '</div>');
  } catch (e) { setHTML('repRecon', '<span class="err">'+e.message+'</span>'); }
  try { const f = await api('/admin/v1/transactions/failed'+qs); setHTML('repFailed', tableHtml(f.failed_settlements || [], ['round_ref','type','amount','currency','status','error_code'])); }
  catch (e) { setHTML('repFailed', '<span class="err">'+e.message+'</span>'); }
}
`;

export const ROUNDACTIONS_JS = /* js */ `
async function verifyRound() {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id above first', false); return; }
  out.hidden = false; out.className = 'status'; out.textContent = 'verifying…';
  try { const v = await api('/admin/v1/rounds/' + encodeURIComponent(ref) + '/verify');
    out.className = 'status ' + (v.verdict === 'tampered' ? 'err' : 'ok');
    out.innerHTML = '<b>Verdict: ' + v.verdict.toUpperCase() + '</b><div class="cards" style="margin-top:8px;">' +
      cardHtml('outcome ok', v.outcome_ok === null ? 'n/a' : (v.outcome_ok ? 'yes' : 'NO')) + cardHtml('chain ok', v.chain_ok ? 'yes' : 'NO') + '</div>' +
      '<pre class="code">stored:     ' + v.stored_hash + '\\nrecomputed: ' + (v.recomputed_hash || '(not replayed)') + '</pre>' +
      (v.notes && v.notes.length ? '<p class="muted">' + esc(v.notes.join(' · ')) + '</p>' : '');
  } catch (e) { flash(out, e.message, false); }
}
async function loadRoundTx() {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id above first', false); return; }
  try { const d = await api('/admin/v1/rounds/' + encodeURIComponent(ref) + '/transactions');
    out.hidden = false; out.className = 'status';
    out.innerHTML = '<p>effective status: <b>' + d.effective_status + '</b> (recorded: ' + d.recorded_status + ')</p>' + tableHtml(d.transactions, ['type','amount','currency','status','error_code','idempotency_key']);
  } catch (e) { flash(out, e.message, false); }
}
async function voidRoundAction() { await lifecycleAction('void'); }
async function settleRoundAction() { await lifecycleAction('settle'); }
async function lifecycleAction(kind) {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id first', false); return; }
  const reason = prompt('Reason for ' + kind + ' on ' + ref + ':'); if (reason === null || !reason.trim()) return;
  try { const r = await api('/admin/v1/rounds/' + encodeURIComponent(ref) + '/' + kind, { method: 'POST', body: { reason: reason.trim() } }); flash(out, kind + ' done — effective status: ' + r.effective_status + (r.already ? ' (no-op)' : '') + '. ' + (r.notes || []).join('; '), true); }
  catch (e) { flash(out, e.message, false); }
}
async function raiseDisputeAction(kind) {
  const ref = $('roundRefInput').value.trim(); const out = $('roundActionOut');
  if (!ref) { flash(out, 'paste a round id first', false); return; }
  const reason = prompt('Reason for requesting ' + kind + ' on ' + ref + ':'); if (reason === null || !reason.trim()) return;
  try { const r = await api('/admin/v1/disputes', { method: 'POST', body: { round_ref: ref, kind, reason: reason.trim() } }); flash(out, 'dispute raised (' + r.dispute.id + ', ' + r.dispute.status + ') — a provider admin will review it.', true); }
  catch (e) { flash(out, e.message, false); }
}
`;

export const GAMES_JS = /* js */ `
async function loadGames() {
  const el = $('gamesList'); if (!el) return;
  const go = $('gamesOp'); const opId = go ? go.value.trim() : '';
  const qs = opId ? ('?operator_id=' + encodeURIComponent(opId)) : '';
  try { const d = await api('/admin/v1/operator-games' + qs); const rows = d.operator_games || [];
    if (!rows.length) { el.innerHTML = '<p class="muted">no game assignments</p>'; return; }
    el.innerHTML = '<table><tr><th>assignment</th><th>game_id</th><th>currency</th><th>bets</th><th>status</th><th></th></tr>' +
      rows.map(g => '<tr><td><code>' + g.id.slice(0,8) + '…</code></td><td>' + g.game_id.slice(0,8) + '…</td><td>' + g.currency + '</td><td>' + g.allowed_bets.join(', ') + '</td>' +
        '<td>' + (g.status === 'enabled' ? '<span class="ok">enabled</span>' : '<span class="err">disabled</span>') + '</td>' +
        '<td><button class="ghost" data-id="' + g.id + '" data-to="' + (g.status === 'enabled' ? 'disabled' : 'enabled') + '">' + (g.status === 'enabled' ? 'Turn OFF' : 'Turn ON') + '</button></td></tr>').join('') + '</table>';
    el.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => toggleGame(b.dataset.id, b.dataset.to)));
  } catch (e) { el.innerHTML = '<span class="err">' + e.message + '</span>'; }
}
async function toggleGame(id, to) { try { await api('/admin/v1/operator-games/' + id + '/status', { method: 'POST', body: { status: to } }); loadGames(); } catch (e) { alert(e.message); } }
`;

export const DISPUTES_JS = /* js */ `
async function loadDisputes() {
  const el = $('disputesList'); if (!el) return;
  const dO = $('dspOp'); const opId = dO ? dO.value.trim() : ''; const stEl = $('dspStatus'); const st = stEl ? stEl.value : '';
  const params = []; if (opId) params.push('operator_id=' + encodeURIComponent(opId)); if (st) params.push('status=' + st);
  const qs = params.length ? ('?' + params.join('&')) : '';
  try { const d = await api('/admin/v1/disputes' + qs); const rows = d.disputes || [];
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
`;

export const PLAYERS_JS = /* js */ `
async function loadPlayer() {
  const el = $('playerRounds'); const st = $('plStatus');
  const plO = $('plOp'); const opId = plO ? plO.value.trim() : ''; const pid = $('plPlayer').value.trim();
  if (!pid) { flash(st, 'enter a player id', false); return; }
  const qs = opId ? ('?operator_id=' + encodeURIComponent(opId)) : '';
  st.hidden = false; st.className = 'muted'; st.textContent = 'loading…';
  try { const d = await api('/admin/v1/players/' + encodeURIComponent(pid) + '/rounds' + qs);
    st.textContent = d.count + ' rounds';
    if (!d.rounds.length) { el.innerHTML = '<p class="muted">no rounds for this player</p>'; return; }
    el.innerHTML = '<table><tr><th>round</th><th>bet</th><th>win</th><th>free?</th><th>status</th><th>created</th></tr>' +
      d.rounds.map(r => '<tr class="clickable" data-ref="' + r.round_ref + '"><td><code>' + r.round_ref + '</code></td><td>' + fmtMoney(r.bet_charged) + '</td>' +
        '<td>' + (r.total_win > 0 ? '<span class="ok">+' + fmtMoney(r.total_win) + '</span>' : fmtMoney(r.total_win)) + '</td><td>' + (r.is_free_spin ? 'yes' : '') + '</td>' +
        '<td>' + (r.effective_status !== r.status ? ('<span class="err">' + r.effective_status + '</span>') : r.status) + '</td><td>' + (r.created_at || '').replace('T',' ').slice(0,19) + '</td></tr>').join('') + '</table>';
    el.querySelectorAll('tr.clickable').forEach(tr => tr.addEventListener('click', () => { $('roundRefInput').value = tr.dataset.ref; show('inspector'); lookupRound(); }));
  } catch (e) { flash(st, e.message, false); el.innerHTML = ''; }
}
`;

export const OPERATORS_JS = /* js */ `
function renderOperators() {
  const el = $('operatorsList'); if (!el) return; const rows = state.operators;
  if (!rows.length) { el.innerHTML = '<p class="muted">no operators</p>'; return; }
  el.innerHTML = '<table><tr><th>slug</th><th>name</th><th>status</th><th>ccy</th><th>actions</th></tr>' +
    rows.map(o => '<tr><td>' + esc(o.slug) + '</td><td>' + esc(o.name) + '</td><td>' + o.status + '</td><td>' + o.default_currency + '</td>' +
      '<td>' + (o.status === 'suspended' ? '<button data-act="live" data-op="' + o.id + '">Reactivate</button>' : '<button class="danger" data-act="suspended" data-op="' + o.id + '">Suspend</button>') + ' ' +
        '<button class="ghost" data-creds="' + o.id + '">Credentials</button></td></tr>').join('') + '</table><div id="opManageOut"></div>';
  el.querySelectorAll('button[data-act]').forEach(b => b.addEventListener('click', () => setOperatorStatus(b.dataset.op, b.dataset.act)));
  el.querySelectorAll('button[data-creds]').forEach(b => b.addEventListener('click', () => loadCredentials(b.dataset.creds)));
}
async function setOperatorStatus(id, status) {
  if (status === 'suspended' && !confirm('Suspend this operator? New sessions & spins will be blocked immediately.')) return;
  try { await api('/admin/v1/operators/' + id + '/status', { method: 'POST', body: { status } }); refreshDashboard(); } catch (e) { alert(e.message); }
}
async function loadCredentials(id) {
  const out = $('opManageOut'); if (!out) return;
  try { const d = await api('/admin/v1/operators/' + id + '/credentials'); const rows = d.credentials || [];
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
`;

export const ACCOUNTS_JS = /* js */ `
const OPERATOR_ROLES = ['operator_admin','operator_finance','operator_viewer'];
const PROVIDER_ROLES = ['provider_super_admin','provider_finance','provider_read_only'];
function acctRoleOptions() {
  const scope = $('acctScope') ? $('acctScope').value : 'operator';
  const roles = scope === 'provider' ? PROVIDER_ROLES : OPERATOR_ROLES;
  const sel = $('acctRole'); if (sel) sel.innerHTML = roles.map(r => '<option value="'+r+'">'+r+'</option>').join('');
  const opWrap = $('acctOpWrap'); if (opWrap) opWrap.style.display = scope === 'operator' ? '' : 'none';
}
async function loadAccounts() {
  if ($('acctScope')) { $('acctScope').onchange = acctRoleOptions; acctRoleOptions(); }
  try { const ops = await api('/admin/v1/operators'); state.operators = ops.operators || [];
    const sel = $('acctOp'); if (sel) sel.innerHTML = state.operators.map(o => '<option value="'+o.id+'">'+esc(o.slug)+' — '+esc(o.name)+'</option>').join('');
  } catch {}
  const el = $('accountsList'); if (!el) return;
  try { const d = await api('/admin/v1/admin-accounts'); const rows = d.accounts || [];
    if (!rows.length) { el.innerHTML = '<p class="muted">no admin accounts yet</p>'; return; }
    el.innerHTML = '<table><tr><th>username</th><th>scope</th><th>role</th><th>operator</th><th>status</th><th>setup</th><th></th></tr>' +
      rows.map(a => '<tr><td>' + esc(a.username) + '</td><td>' + a.scope + '</td><td>' + a.role + '</td><td>' + (a.operator_id ? a.operator_id.slice(0,8)+'…' : '—') + '</td>' +
        '<td>' + (a.status === 'active' ? '<span class="ok">active</span>' : '<span class="err">disabled</span>') + '</td>' +
        '<td>' + (a.must_set_password ? 'needs pw · ' : '') + (a.totp_enrolled ? '2FA on' : 'needs 2FA') + '</td>' +
        '<td><button class="ghost" data-rpw="' + a.id + '">Reset pw</button> <button class="ghost" data-rtotp="' + a.id + '">Reset 2FA</button> ' +
        (a.status === 'active' ? '<button class="danger" data-dis="' + a.id + '">Disable</button>' : '') + '</td></tr>').join('') + '</table>';
    el.querySelectorAll('button[data-rpw]').forEach(b => b.addEventListener('click', () => resetAccountPassword(b.dataset.rpw)));
    el.querySelectorAll('button[data-rtotp]').forEach(b => b.addEventListener('click', () => resetAccountTotp(b.dataset.rtotp)));
    el.querySelectorAll('button[data-dis]').forEach(b => b.addEventListener('click', () => disableAccount(b.dataset.dis)));
  } catch (e) { el.innerHTML = '<span class="err">' + e.message + '</span>'; }
}
async function createAccount() {
  clearFlash($('acctResult'));
  const username = $('acctUser').value.trim(); const scope = $('acctScope').value; const role = $('acctRole').value;
  const operator_id = scope === 'operator' ? $('acctOp').value : undefined;
  if (!username) return flash($('acctResult'), 'username required', false);
  try { const d = await api('/admin/v1/admin-accounts', { method: 'POST', body: { username, scope, role, operator_id } });
    $('acctResult').hidden = false; $('acctResult').className = 'status ok';
    $('acctResult').innerHTML = 'created <b>' + esc(d.account.username) + '</b> — one-time password (share securely, they set a new one + enroll 2FA on first login):<pre class="code">' + esc(d.temp_password) + '</pre>';
    loadAccounts();
  } catch (e) { flash($('acctResult'), e.message, false); }
}
async function resetAccountPassword(id) {
  if (!confirm('Reset this admin\\'s password? They must set a new one on next login.')) return;
  try { const d = await api('/admin/v1/admin-accounts/' + id + '/reset-password', { method: 'POST', body: {} }); alert('New one-time password (shown once):\\n' + d.temp_password); loadAccounts(); } catch (e) { alert(e.message); }
}
async function resetAccountTotp(id) { if (!confirm('Reset 2FA? They must re-enroll an authenticator on next login.')) return; try { await api('/admin/v1/admin-accounts/' + id + '/reset-totp', { method: 'POST', body: {} }); loadAccounts(); } catch (e) { alert(e.message); } }
async function disableAccount(id) { if (!confirm('Disable this admin account? They will be unable to sign in.')) return; try { await api('/admin/v1/admin-accounts/' + id + '/disable', { method: 'POST', body: {} }); loadAccounts(); } catch (e) { alert(e.message); } }
`;
