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
let inspectorRound = null; let inspectorVerdict = null; let stepIdx = 0; let playTimer = null;
const SYMBOL_LABELS = {
  TOP_CROWN:'crown', HOURGLASS:'hourglass', RING:'ring', CHALICE:'chalice', RED_GEM:'gem',
  PURPLE_TRIANGLE:'purple', YELLOW_HEX:'yellow', GREEN_TRIANGLE:'green', BLUE_DIAMOND:'diamond', SCATTER:'scatter'
};
// Engine symbol code → the art file the game client draws (client/main.js
// symbolAssets). The old URL was '<CODE>.png' (e.g. TOP_CROWN.png), a file that
// never existed, so every inspector symbol image 404'd. The PNG originals have
// since moved out of client/ entirely (art-src/); only the WebP exports ship.
const SYMBOL_FILES = {
  TOP_CROWN:'Crown', HOURGLASS:'HourGlass', RING:'Ring', CHALICE:'Chaile', RED_GEM:'RedGem',
  PURPLE_TRIANGLE:'PurpleGem', YELLOW_HEX:'YellowGem', GREEN_TRIANGLE:'GreenGem', BLUE_DIAMOND:'BlueGem',
  SCATTER:'Scatter'
};
// Multiplier tokens are one plate per rarity tier, same values as the client.
function multiplierFile(value) {
  if (value >= 1000) return 'Mythic';
  if (value >= 100) return 'Legendary';
  if (value >= 50) return 'Epic';
  if (value >= 10) return 'Rare';
  return 'Common';
}
function symbolImageUrl(code) {
  if (!code) return null;
  const c = String(code).toUpperCase();
  let file = SYMBOL_FILES[c];
  if (!file && c.startsWith('MULTI')) file = multiplierFile(multiValueFromCode(c) || 0);
  return file ? '/assets/symbols/' + file + '.webp' : null;
}
function multiValueFromCode(code) { const m = /MULTI(\\d+)/i.exec(String(code || '')); return m ? Number(m[1]) : null; }
// ── Inspector state machine ─────────────────────────────────────────────────
// State: inspectorRound (the spin on screen, full payload), inspectorFeature (its
// bonus family timeline, or null), stepIdx (the board on screen within that spin),
// playing (autoplay). Every move between spins — a fresh lookup, a timeline click,
// prev/next spin, autoplay crossing into the next free spin, a click in the player
// search — goes through openSpin(). roundCache keeps every spin already fetched, so
// walking the timeline back and forth never re-fetches; a fresh lookup clears it.
let inspectorFeature = null; const roundCache = new Map(); let inspectorSeq = 0; let playing = false;

async function lookupRound() {
  const ref = $('roundRefInput').value.trim();
  clearFlash($('inspectorStatus'));
  if (!ref) { flash($('inspectorStatus'), 'paste a Round ID first', false); return; }
  await openSpin(ref, { fresh: true });
}
async function openSpin(ref, opts = {}) {
  const seq = ++inspectorSeq; // the newest request wins; a slower earlier one is dropped
  if (!opts.keepPlaying) stopPlay();
  if (opts.fresh) roundCache.clear();
  let data = roundCache.get(ref);
  if (!data) {
    const st = $('inspectorStatus'); st.className = 'muted'; st.textContent = 'looking up…'; st.hidden = false;
    try { data = await api('/admin/v1/rounds/' + encodeURIComponent(ref)); }
    catch (e) {
      if (seq !== inspectorSeq) return;
      stopPlay(); inspectorRound = null; inspectorFeature = null; inspectorVerdict = null;
      $('inspectorContent').innerHTML = '';
      if (e.status === 404) renderInspectorEmpty(ref); else flash($('inspectorStatus'), e.message, false);
      return;
    }
    roundCache.set(ref, data);
  }
  if (seq !== inspectorSeq) return;
  inspectorRound = data; inspectorFeature = data.feature || null; stepIdx = 0;
  inspectorVerdict = data.__verdict || { pending: true };
  $('roundRefInput').value = ref;
  $('inspectorStatus').textContent = ''; $('inspectorStatus').className = 'ok';
  // Shareable link: /admin#inspector?round=<ref>
  history.replaceState(null, '', '#inspector?round=' + encodeURIComponent(ref));
  renderInspector();
  if (!data.__verdict) loadVerdict(ref);
}
function spinPosition() {
  if (!inspectorFeature || !inspectorRound) return -1;
  return inspectorFeature.spins.findIndex(s => s.round_ref === inspectorRound.round_ref);
}
function selectSpin(i) {
  const f = inspectorFeature; if (!f || i < 0 || i >= f.spins.length) return;
  openSpin(f.spins[i].round_ref);
}
function renderInspectorEmpty(ref) {
  $('inspectorContent').innerHTML = '<div class="panel"><h2>Not found</h2>' +
    '<p>No round matches <code>'+esc(ref)+'</code> — check that you copied the full ID (it looks like <code>r_…</code>) ' +
    'and that you have permission to view this round.</p></div>';
  $('inspectorStatus').textContent = '';
}

// The boards of a spin, in play order: tumble_steps[0] is the spin's board, each
// later step the board after a tumble; the last step is the final (no-win) board.
// (outcome.matrix is that final board, not the initial one.)
function boardsOf(r) {
  const steps = Array.isArray(r?.outcome?.tumble_steps) ? r.outcome.tumble_steps : [];
  return steps.length ? steps : [{ matrix: r?.outcome?.matrix, multipliers: r?.outcome?.multipliers || [], ways_wins: [], win_total: 0, winning_positions: [] }];
}
const num = (v) => String(Number(Number(v || 0).toFixed(2)));
const r2 = (v) => Number(Number(v || 0).toFixed(2));

// Forensics, from stored data only. landed[i] = multipliers first seen on board i
// (by id), i.e. what actually dropped in on that board.
function forensicsOf(r) {
  const o = r.outcome || {}; const boards = boardsOf(r); const seen = new Set();
  const landed = boards.map(b => (b.multipliers || []).filter(m => {
    const id = m.id || (m.row + '-' + m.col + '-' + m.value);
    if (seen.has(id)) return false; seen.add(id); return true;
  }));
  const raw = boards.reduce((s, b) => s + Number(b.win_total || 0), 0);
  const won = raw > 0;
  const mSum = landed.flat().reduce((s, m) => s + Number(m.value || 0), 0);
  const scaler = r.pays ? r.pays.scaler : null;
  const scatter = Number(o.scatter_win || 0);
  // The engine's arithmetic: round(raw × scaler) + scatter = pre-multiplier win; × applied = paid (before the cap).
  const pre = scaler === null ? null : r2(r2(raw * scaler) + scatter);
  const applied = Number(o.multiplier_applied || 1);
  const expected = pre === null ? null : r2(pre * applied);
  const capped = (Array.isArray(o.events) ? o.events : []).some(e => /MAX_WIN_CAP/.test(String(e && e.type)));
  return { boards, landed, raw, won, mSum, scaler, scatter, pre, applied, expected, capped,
    bankBefore: Number(r.pre_state?.free_spin_multiplier_carry ?? 0), bankAfter: Number(o.free_spin_multiplier_current ?? 0),
    gain: Number(o.multiplier_gain_applied || 0) };
}
// How the multipliers of this spin resolved — the engine rule, stated per case.
function resolutionOf(r, f) {
  if (r.is_free_spin) {
    if (f.won && f.gain > 0) return { cls: 'good', text: 'Winning sequence with new multipliers (+' + num(f.gain) + '): ADDED to the bank (×' + num(f.bankBefore) + ' → ×' + num(f.bankAfter) + ') and the whole bank ×' + num(f.applied) + ' APPLIED to this spin\\'s win.' };
    if (f.won) return { cls: 'held', text: 'Winning sequence with no new multiplier: paid at 1×. The bank (×' + num(f.bankBefore) + ') is held, NOT applied.' };
    if (f.mSum > 0) return { cls: 'void', text: 'No win: the multipliers that landed (+' + num(f.mSum) + ') were DISCARDED, not banked. Bank unchanged at ×' + num(f.bankBefore) + '.' };
    return { cls: 'held', text: 'No win and no multiplier. Bank unchanged at ×' + num(f.bankBefore) + '.' };
  }
  if (f.won && f.applied > 1) return { cls: 'good', text: 'Base game: the multipliers of this sequence summed to ×' + num(f.applied) + ' and APPLIED to its win (the bank exists only in free spins).' };
  if (f.won) return { cls: 'held', text: 'Base game: win paid at 1× (no multiplier on the sequence).' };
  if (f.mSum > 0) return { cls: 'void', text: 'Base game: no win, so the multipliers that landed (+' + num(f.mSum) + ') were DISCARDED.' };
  return null;
}

function renderInspector() {
  if (!inspectorRound) return;
  const r = inspectorRound; const outcome = r.outcome || {};
  const boards = boardsOf(r); const totalStages = boards.length;
  if (stepIdx >= totalStages) stepIdx = totalStages - 1; if (stepIdx < 0) stepIdx = 0;
  const wins = Array.isArray(outcome.ways_wins) ? outcome.ways_wins : [];
  const totalSymbolsCaught = wins.reduce((s, w) => s + (Number(w.count) || 0), 0);
  const biggest = wins.slice().sort((a,b) => (Number(b.amount)||0) - (Number(a.amount)||0))[0];
  const f = forensicsOf(r);
  const pos = spinPosition();
  const text = '' +
  '<div class="panel"><h2>Round details</h2><div class="kv">' +
      kv('Round ID', '<code>'+esc(r.round_ref)+'</code>') +
      kv('Operator', r.operator ? (esc(r.operator.name) + ' <span class="muted">('+esc(r.operator.slug)+')</span>') : esc(r.operator_id)) +
      kv('Game', r.game ? (esc(r.game.title) + ' <span class="muted">'+esc(r.game.code)+'</span>') : esc(r.game_id)) +
      kv('Math config', r.math_config ? (esc(r.math_config.version) + ' · RTP ' + r.math_config.theoretical_rtp + '% · ' + esc(r.math_config.status)) : esc(r.math_config_id)) +
      kv('Engine', r.engine_version ? '<code>'+esc(r.engine_version)+'</code>' : '<span class="muted">unversioned</span>') +
      kv('Rules hash', r.rules_hash ? '<code title="'+esc(r.rules_hash)+'">'+esc(r.rules_hash.slice(0, 16))+'…</code>' : '<span class="muted">not recorded</span>') +
      kv('Signature', sigBadge(r.signature)) +
      kv('Trace ID', r.trace_id ? '<code title="W3C trace: search the request logs and the casino ledger for it">'+esc(r.trace_id)+'</code>' : '<span class="muted">not recorded</span>') +
      kv('Currency', esc(r.currency || '—')) +
      kv('Bet', fmtMoney(r.bet_amount) + (r.ante_enabled ? ' (ante)' : '')) +
      kv('Bet charged', fmtMoney(r.bet_charged)) +
      kv('Total win', '<b'+(r.total_win > 0 ? ' class="ok"' : '')+'>'+fmtMoney(r.total_win)+'</b>') +
      kv('Multiplier applied', num(r.multiplier_applied) + '×') +
      kv('Pay scaler', f.scaler === null ? '<span class="muted">not shown (round played under other rules)</span>' : ('×' + f.scaler + ' <span class="muted">(' + (r.pays.basis === 'free_spin' ? 'free spin' : 'paid spin') + ')</span>')) +
      kv('Spin type', r.is_free_spin ? ('free spin' + (pos > 0 ? ' ' + pos + ' / ' + (inspectorFeature.spins.length - 1) : '')) : (inspectorFeature ? 'bonus trigger' : 'paid spin')) +
      kv('Free spins awarded', outcome.free_spins_awarded ?? 0) +
      kv('Scatters', outcome.scatter_count ?? 0) +
      kv('Status', esc(r.status)) + kv('Created at', esc(r.created_at)) +
      kv('Outcome hash', '<code>'+esc(r.outcome_hash)+'</code>') +
      kv('RNG', esc(r.rng_algo) + ' (seed ref)') + kv('Seq', r.chain?.seq) +
    '</div></div>' +
  '<div class="panel"><h2>What the player caught</h2><div class="cards">' +
      cardHtml('symbols caught', totalSymbolsCaught) + cardHtml('clusters', wins.length) +
      cardHtml('biggest cluster', biggest ? (esc(biggest.symbol)+' ×'+biggest.count+' = '+fmtMoney(biggest.amount)) : '—') +
      cardHtml('multipliers landed', f.landed.flat().length) + cardHtml('tumbles', Math.max(0, boards.length - 1)) +
    '</div>' +
    (outcome.free_spins_awarded ? '<div class="banner fs">🎁 Free spins ' + (r.is_free_spin ? 'retriggered: +' : 'triggered: ') + outcome.free_spins_awarded + '</div>' : '') +
    (r.is_free_spin ? '<div class="banner bonus">⭐ This spin was a FREE SPIN</div>' : '') +
    '<h2 style="margin-top:14px;">Per-board breakdown</h2><div class="breakdown">' + buildBreakdown(r, f) + '</div></div>';
  const visual = '<div class="panel"><h2>Visual playback</h2>' + hudHtml(r, f) + renderStageHtml(r, f, stepIdx) + renderStepControls(totalStages) + '</div>';
  $('inspectorContent').innerHTML = verdictBannerHtml() + timelineHtml() + '<div class="inspector">'+text+visual+'</div>';
  bindStepControls(totalStages);
  bindTimeline();
}
// Verification verdict leads the inspector: recomputed from the stored seed + hash chain.
async function loadVerdict(ref) {
  let v;
  try { v = await api('/admin/v1/rounds/' + encodeURIComponent(ref) + '/verify'); }
  catch (e) { v = { error: e.status === 403 ? 'your role cannot verify rounds' : e.message }; }
  const cached = roundCache.get(ref); if (cached) cached.__verdict = v;
  if (inspectorRound && inspectorRound.round_ref === ref) { inspectorVerdict = v; renderInspector(); }
}
function verdictBannerHtml() {
  const v = inspectorVerdict; if (!v) return '';
  if (v.pending) return '<div class="verdict pending">Verifying round…</div>';
  if (v.error) return '<div class="verdict pending">Verification unavailable: ' + esc(v.error) + '</div>';
  const cls = v.verdict === 'tampered' ? 'bad' : (v.verdict === 'legitimate' ? 'good' : 'pending');
  return '<div class="verdict ' + cls + '"><b>' + esc(String(v.verdict).toUpperCase()) + '</b>' +
    '<span>outcome ' + (v.outcome_ok === null ? 'n/a' : (v.outcome_ok ? '✓' : '✗')) + ' · chain ' + (v.chain_ok ? '✓' : '✗') + (v.signature ? ' · signature ' + (v.signature.status === 'valid' ? '✓' : v.signature.status === 'unsigned' ? 'n/a' : '✗') : '') + '</span>' +
    (v.notes && v.notes.length ? '<span class="muted">' + esc(v.notes.join(' · ')) + '</span>' : '') + '</div>';
}
function kv(k, v) { return '<span>'+k+'</span><div>'+(v ?? '')+'</div>'; }
// The round row's Ed25519 signature (migration 0012), as checked by the server.
function sigBadge(sig) {
  if (!sig || sig.status === 'unsigned') return '<span class="muted">unsigned (recorded before per-row signatures)</span>';
  const key = sig.key_id ? ' <code>' + esc(sig.key_id) + '</code>' : '';
  if (sig.status === 'valid') return '<b class="ok">✓ valid</b>' + key;
  if (sig.status === 'unknown_key') return '<span class="err">✗ signed by a key this platform never had</span>' + key;
  return '<span class="err">✗ INVALID</span>' + key;
}

// Dimension 1 — the spins of the bonus: Trigger ➔ Free spin 1 ➔ … ➔ Free spin N.
function timelineHtml() {
  const fam = inspectorFeature; if (!fam) return '';
  const pos = spinPosition();
  const chips = fam.spins.map((s, i) => {
    const bank = i > 0 && s.bank_after > 0 ? ' · bank ×' + num(s.bank_after) : '';
    const tags = (s.free_spins_awarded && i > 0 ? ' · +' + s.free_spins_awarded + ' FS' : '') + (s.capped ? ' · CAP' : '');
    return '<button type="button" class="tl-chip' + (i === pos ? ' cur' : '') + (s.total_win > 0 ? ' won' : '') + (s.capped ? ' capped' : '') +
      '" data-spin="' + i + '" title="' + esc(s.round_ref) + '"><b>' + (i === 0 ? 'Trigger' : 'Free spin ' + i) + '</b>' +
      '<span>' + (s.total_win > 0 ? '+' + fmtMoney(s.total_win) : '0.00') + bank + tags + '</span></button>';
  }).join('<span class="tl-arrow" aria-hidden="true">➔</span>');
  return '<div class="panel bonus-tl"><div class="tl-head"><h2>Bonus round</h2>' +
    '<span class="muted">trigger <code>' + esc(fam.feature_ref) + '</code> · ' + fam.free_spins + ' free spins · total win <b class="ok">' + fmtMoney(fam.total_win) + '</b>' +
    ' · final bank ×' + num(fam.final_bank) + (fam.capped ? ' · <b class="err">max-win cap reached</b>' : '') + '</span>' +
    '<span class="tl-nav"><button class="ghost" id="prevSpin"' + (pos <= 0 ? ' disabled' : '') + '>◀ Prev spin</button>' +
    '<span class="muted">spin <b>' + (pos + 1) + '</b> / ' + fam.spins.length + '</span>' +
    '<button class="ghost" id="nextSpin"' + (pos >= fam.spins.length - 1 ? ' disabled' : '') + '>Next spin ▶</button></span></div>' +
    '<div class="tl-strip" id="tlStrip">' + chips + '</div></div>';
}
function bindTimeline() {
  const strip = $('tlStrip'); if (!strip) return;
  strip.onclick = (e) => { const b = e.target.closest('[data-spin]'); if (b) selectSpin(Number(b.dataset.spin)); };
  $('prevSpin').onclick = () => selectSpin(spinPosition() - 1);
  $('nextSpin').onclick = () => selectSpin(spinPosition() + 1);
  const cur = strip.querySelector('.tl-chip.cur');
  if (cur) strip.scrollLeft = cur.offsetLeft - strip.clientWidth / 2 + cur.offsetWidth / 2;
}

// Persistent forensic HUD: the bonus bank and running bonus win (whole family), then
// this spin's pay arithmetic and how its multipliers resolved.
function hudHtml(r, f) {
  const fam = inspectorFeature; const pos = spinPosition(); const parts = [];
  if (fam && pos >= 0) {
    const s = fam.spins[pos];
    if (r.is_free_spin) parts.push('<div class="t">Global Multiplier Bank: <b>×' + num(f.bankBefore) + '</b> → <b>×' + num(f.bankAfter) + '</b></div>');
    parts.push('<div class="t">Bonus running win: <b class="ok">' + fmtMoney(s.bonus_running_win) + '</b> <span class="muted">of ' + fmtMoney(fam.total_win) + '</span></div>');
  }
  const pays = f.pre === null ? '' :
    '<div class="t">Pays: round(' + fmtMoney(f.raw) + ' × ' + f.scaler + ')' + (f.scatter ? ' + scatter ' + fmtMoney(f.scatter) : '') + ' = <b>' + fmtMoney(f.pre) + '</b>' +
    (f.applied !== 1 ? ' × ' + num(f.applied) + ' = <b>' + fmtMoney(f.expected) + '</b>' : '') +
    ' · paid <b class="ok">' + fmtMoney(r.total_win) + '</b>' + (f.capped ? ' <span class="err">(max-win cap)</span>' : (f.expected !== null && r2(f.expected) !== r2(r.total_win) ? ' <span class="err">(≠ — check)</span>' : ' ✓')) + '</div>';
  const res = resolutionOf(r, f);
  return '<div class="totals hud">' + parts.join('') + pays + '</div>' + (res ? '<div class="mlog ' + res.cls + '">' + esc(res.text) + '</div>' : '');
}
function buildBreakdown(r, f) {
  return f.boards.map((s, i) => {
    const wins = (s.ways_wins || []).map(w => '<li>' + esc(w.symbol) + ' × ' + w.count + ' → ' + fmtMoney(w.payout) + '× = ' + fmtMoney(w.amount) + (f.scaler !== null ? ' <span class="muted">(pays ' + fmtMoney(r2(w.amount * f.scaler)) + ')</span>' : '') + '</li>').join('');
    const landed = f.landed[i].length ? '<li>multipliers landed: ' + f.landed[i].map(m => num(m.value) + '× @ [' + m.row + ',' + m.col + ']').join(', ') + '</li>' : '';
    const title = (i === 0 ? 'Spin board' : 'Tumble ' + i) + (i === f.boards.length - 1 && f.boards.length > 1 ? ' (final)' : '');
    return '<details ' + (i === 0 ? 'open' : '') + '><summary>' + title + ' · win ' + fmtMoney(s.win_total) + ' · ' + (s.winning_positions || []).length + ' cells</summary><ul>' + (wins || '<li class="muted">no win</li>') + landed + '</ul></details>';
  }).join('');
}
// Dimension 2 — the tumbles of the spin on screen.
function renderStageHtml(r, f, idx) {
  const b = f.boards[idx] || {}; const matrix = b.matrix;
  const last = f.boards.length - 1;
  const label = (idx === 0 ? 'Spin board' : 'Tumble ' + idx) + (idx === last && last > 0 ? ' (final)' : '');
  const winSet = new Set((b.winning_positions || []).map(p => p.row + ',' + p.col));
  const multiMap = new Map(); const newIds = new Set(f.landed[idx].map(m => m.row + ',' + m.col));
  for (const m of (b.multipliers || [])) { if (m && typeof m.row === 'number' && typeof m.col === 'number') multiMap.set(m.row + ',' + m.col, m.value ?? multiValueFromCode(m.code) ?? '×'); }
  const seqSoFar = f.boards.slice(0, idx + 1).reduce((s, x) => s + Number(x.win_total || 0), 0);
  const scaled = (v) => f.scaler === null ? fmtMoney(v) + ' <span class="muted">raw</span>' : fmtMoney(r2(v * f.scaler));
  let html = '<div class="totals">' +
    '<div class="t">Board: <b>' + label + '</b></div>' +
    '<div class="t">Board win: <b class="ok">+' + scaled(b.win_total || 0) + '</b></div>' +
    '<div class="t">Sequence pays so far: <b>' + scaled(seqSoFar) + '</b></div>' +
    (f.landed[idx].length ? '<div class="t">Landed here: <b>' + f.landed[idx].map(m => num(m.value) + '×').join(' + ') + '</b></div>' : '') +
    '</div>';
  const rows = matrix?.length ?? 5, cols = matrix?.[0]?.length ?? 6;
  html += '<div class="matrix" style="grid-template-columns: repeat(' + cols + ',1fr); margin-top:10px;">';
  for (let rr = 0; rr < rows; rr++) { for (let c = 0; c < cols; c++) {
      const sym = matrix?.[rr]?.[c]; const key = rr + ',' + c; const isWin = winSet.has(key);
      const isScatter = String(sym || '').toUpperCase() === 'SCATTER';
      const multiBadge = multiMap.get(key) ?? (String(sym || '').toUpperCase().startsWith('MULTI') ? multiValueFromCode(sym) : null);
      const url = sym ? symbolImageUrl(sym) : null;
      html += '<div class="cell ' + (isWin ? 'win ' : '') + (isScatter ? 'scatter ' : '') + (newIds.has(key) ? 'mnew' : '') + '" data-rc="' + key + '">';
      if (url) html += '<img src="' + url + '" alt="' + esc(sym) + '" onerror="this.style.display=\\'none\\'; this.parentElement.querySelector(\\'.lbl\\').style.display=\\'block\\';"/>';
      html += '<span class="lbl" style="display:' + (url ? 'none' : 'block') + ';">' + esc(SYMBOL_LABELS[String(sym || '').toUpperCase()] || sym || '') + '</span>';
      if (multiBadge != null) html += '<span class="mbadge">' + multiBadge + '×</span>';
      html += '</div>';
  } }
  return html + '</div>';
}
function renderStepControls(totalStages) {
  const more = inspectorFeature && spinPosition() < inspectorFeature.spins.length - 1;
  return '<div class="step-ctrl"><button class="ghost" id="prevStep">⏮ Prev</button><button id="playStep">' + (playing ? '⏸ Pause' : (more ? '▶ Play bonus' : '▶ Play')) + '</button>' +
    '<button class="ghost" id="nextStep">Next ⏭</button><span class="muted">stage <b id="stepLabel">' + (stepIdx + 1) + '</b> / ' + totalStages + '</span>' +
    (inspectorFeature ? '<span class="muted">· Shift+←/→ moves between spins</span>' : '') + '</div>';
}
function bindStepControls(totalStages) {
  const goto = (i) => { stepIdx = Math.max(0, Math.min(totalStages - 1, i)); renderInspector(); };
  $('prevStep').onclick = () => { stopPlay(); goto(stepIdx - 1); };
  $('nextStep').onclick = () => { stopPlay(); goto(stepIdx + 1); };
  $('playStep').onclick = togglePlay;
  document.addEventListener('keydown', handleKeyNav); // same reference: added once
}
function handleKeyNav(e) {
  const iv = $('inspectorView'); if (!iv || iv.hidden) return;
  if (e.target && /(INPUT|TEXTAREA|SELECT)/.test(e.target.tagName)) return;
  if (e.shiftKey && e.key === 'ArrowLeft') { document.getElementById('prevSpin')?.click(); return; }
  if (e.shiftKey && e.key === 'ArrowRight') { document.getElementById('nextSpin')?.click(); return; }
  if (e.key === 'ArrowLeft') document.getElementById('prevStep')?.click();
  if (e.key === 'ArrowRight') document.getElementById('nextStep')?.click();
  if (e.key === ' ') { e.preventDefault(); document.getElementById('playStep')?.click(); }
}
// Autoplay walks the tumbles of the spin on screen, then (inside a bonus) carries on
// into the next free spin until the end of the bonus. A chain of timeouts, not an
// interval, so a spin being fetched can never be advanced twice.
function stopPlay() { playing = false; if (playTimer) { clearTimeout(playTimer); playTimer = null; } const b = $('playStep'); if (b && inspectorRound) b.textContent = '▶ Play'; }
function togglePlay() {
  if (playing) { stopPlay(); renderInspector(); return; }
  playing = true; renderInspector(); playTimer = setTimeout(playTick, 900);
}
async function playTick() {
  playTimer = null; if (!playing || !inspectorRound) return;
  if (stepIdx < boardsOf(inspectorRound).length - 1) { stepIdx += 1; renderInspector(); playTimer = setTimeout(playTick, 900); return; }
  const pos = spinPosition();
  if (!inspectorFeature || pos < 0 || pos >= inspectorFeature.spins.length - 1) { stopPlay(); renderInspector(); return; }
  await openSpin(inspectorFeature.spins[pos + 1].round_ref, { keepPlaying: true });
  if (playing) playTimer = setTimeout(playTick, 900);
}

// ── Player search (inspector tab) ───────────────────────────────────────────
function inspectorTab(tab) {
  document.querySelectorAll('#inspectorView [data-itab]').forEach(b => b.classList.toggle('active', b.dataset.itab === tab));
  document.querySelectorAll('#inspectorView [data-ipane]').forEach(p => { p.hidden = p.dataset.ipane !== tab; });
  const focus = tab === 'player' ? $('ipPlayer') : $('roundRefInput'); if (focus) focus.focus();
}
async function searchPlayerRounds() {
  const st = $('ipStatus'); const out = $('ipResults');
  const pid = $('ipPlayer').value.trim(); const opEl = $('ipOp'); const opId = opEl ? opEl.value.trim() : '';
  if (!pid) { flash(st, 'enter a player id', false); return; }
  st.hidden = false; st.className = 'muted'; st.textContent = 'searching…';
  try {
    const d = await api('/admin/v1/players/' + encodeURIComponent(pid) + '/rounds?limit=500' + (opId ? '&operator_id=' + encodeURIComponent(opId) : ''));
    st.textContent = d.total > d.count ? ('latest ' + d.count + ' of ' + d.total + ' rounds') : (d.count + ' rounds');
    if (!d.rounds.length) { out.innerHTML = '<p class="muted">no rounds for this player</p>'; return; }
    const multiOp = new Set(d.rounds.map(x => x.operator_id)).size > 1 || state.scope === 'provider';
    out.innerHTML = '<div class="tbl-wrap"><table class="ip-table"><tr><th>Timestamp</th>' + (multiOp ? '<th>Operator</th>' : '') + '<th>Game</th><th class="num">Bet</th><th class="num">Win</th><th>Bonus</th><th>Round</th></tr>' +
      d.rounds.map(x => {
        const f = x.feature;
        const tag = !f ? '' : (f.role === 'trigger' ? '<span class="tag trig">Trigger · ' + f.free_spins + ' FS</span>' : '<span class="tag fs">Free spin ' + f.index + '/' + f.free_spins + '</span>');
        const bet = x.bet_charged > 0 ? fmtMoney(x.bet_charged) : (x.is_free_spin ? '<span class="muted">free</span>' : fmtMoney(0));
        return '<tr class="clickable' + (f && f.role === 'free_spin' ? ' in-bonus' : '') + '" data-ref="' + esc(x.round_ref) + '">' +
          '<td>' + esc((x.created_at || '').replace('T', ' ').slice(0, 19)) + '</td>' + (multiOp ? '<td>' + esc(x.operator_slug || x.operator_id) + '</td>' : '') +
          '<td>' + esc(x.game_code || '—') + '</td><td class="num">' + bet + '</td>' +
          '<td class="num">' + (x.total_win > 0 ? '<span class="ok">+' + fmtMoney(x.total_win) + '</span>' : fmtMoney(0)) + '</td>' +
          '<td>' + tag + (x.effective_status !== x.status ? ' <span class="err">' + esc(x.effective_status) + '</span>' : '') + '</td>' +
          '<td><code>' + esc(x.round_ref) + '</code></td></tr>';
      }).join('') + '</table></div>';
    out.querySelectorAll('tr.clickable').forEach(tr => tr.addEventListener('click', () => {
      out.querySelectorAll('tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel');
      openSpin(tr.dataset.ref, { fresh: true });
    }));
  } catch (e) { flash(st, e.message, false); out.innerHTML = ''; }
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
  try { const pr = await api('/admin/v1/transactions/pending-reversals'+qs); setHTML('repReversals', tableHtml(pr.pending_reversals || [], ['round_ref','type','amount','currency','created_at'])); }
  catch (e) { setHTML('repReversals', '<span class="err">'+e.message+'</span>'); }
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
    el.innerHTML = '<table><tr><th>assignment</th><th>game_id</th><th>currency</th><th>bets</th><th>license</th><th>lobby name</th><th>sort</th><th>in lobby</th><th></th></tr>' +
      rows.map(g => '<tr><td><code>' + g.id.slice(0,8) + '…</code></td><td>' + g.game_id.slice(0,8) + '…</td><td>' + g.currency + '</td><td>' + g.allowed_bets.join(', ') + '</td>' +
        '<td>' + (g.status === 'enabled' ? '<span class="ok">enabled</span>' : '<span class="err">disabled</span>') + '</td>' +
        '<td>' + esc(g.display_name || '—') + '</td><td>' + g.sort_order + '</td>' +
        '<td>' + (g.lobby_enabled ? '<span class="ok">yes</span>' : '<span class="err">no</span>') + '</td>' +
        '<td><button class="ghost" data-id="' + g.id + '" data-to="' + (g.status === 'enabled' ? 'disabled' : 'enabled') + '">' + (g.status === 'enabled' ? 'Turn OFF' : 'Turn ON') + '</button> ' +
        '<span data-operator><button class="ghost" data-disp="' + g.id + '">Edit display</button></span></td></tr>').join('') + '</table>';
    el.querySelectorAll('button[data-id]').forEach(b => b.addEventListener('click', () => toggleGame(b.dataset.id, b.dataset.to)));
    el.querySelectorAll('button[data-disp]').forEach(b => b.addEventListener('click', () => editGameDisplay(b.dataset.disp, rows.find(r => r.id === b.dataset.disp))));
    applyScopeVisibility();
  } catch (e) { el.innerHTML = '<span class="err">' + e.message + '</span>'; }
}
async function toggleGame(id, to) { try { await api('/admin/v1/operator-games/' + id + '/status', { method: 'POST', body: { status: to } }); loadGames(); } catch (e) { alert(e.message); } }
async function editGameDisplay(id, current) {
  const display_name = prompt('Display name in your lobby (blank to clear):', (current && current.display_name) || '');
  if (display_name === null) return;
  const thumbnail_url = prompt('Thumbnail URL (blank to clear):', (current && current.thumbnail_url) || '');
  if (thumbnail_url === null) return;
  const sortRaw = prompt('Sort order (number):', String((current && current.sort_order) || 0));
  if (sortRaw === null) return;
  const lobby_enabled = confirm('Show this game in your lobby? OK = yes, Cancel = hide it.');
  try {
    await api('/admin/v1/operator-games/' + id, { method: 'PATCH', body: {
      display_name: display_name.trim() ? display_name.trim() : null,
      thumbnail_url: thumbnail_url.trim() ? thumbnail_url.trim() : null,
      sort_order: Number(sortRaw) || 0,
      lobby_enabled
    } });
    loadGames();
  } catch (e) { alert(e.message); }
}
async function loadWebhook() {
  const cur = $('webhookCurrent'); if (!cur || !state.operatorId) return;
  try { const d = await api('/admin/v1/operators/' + state.operatorId + '/webhook');
    cur.textContent = d.webhook ? ('Configured: ' + d.webhook.url + ' (secret ···' + d.webhook.secret_last4 + ', updated ' + (d.webhook.updated_at || '').replace('T',' ').slice(0,19) + ')') : 'Not configured yet.';
    const input = $('webhookUrl'); if (input && d.webhook) input.value = d.webhook.url;
  } catch (e) { cur.textContent = e.message; }
}
async function saveWebhook() {
  const url = ($('webhookUrl').value || '').trim(); const out = $('webhookResult');
  if (!url) { flash(out, 'enter a callback URL', false); return; }
  const rotate_secret = $('webhookRotate').checked;
  try {
    const d = await api('/admin/v1/operators/' + state.operatorId + '/webhook', { method: 'PUT', body: { url, rotate_secret } });
    flash(out, d.secret ? ('Saved. New secret (shown once): ' + d.secret) : 'Saved.', true);
    $('webhookRotate').checked = false;
    loadWebhook();
  } catch (e) { flash(out, e.message, false); }
}
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
  setHTML('playerSummary', '');
  api('/admin/v1/players/' + encodeURIComponent(pid) + '/summary' + qs).then(s => setHTML('playerSummary',
    '<div class="cards">' + cardHtml('rounds', s.rounds) + cardHtml('turnover', fmtMoney(s.total_bet)) + cardHtml('total win', fmtMoney(s.total_win)) +
    cardHtml('GGR', fmtMoney(s.ggr)) + cardHtml('RTP %', s.rtp_percent) + cardHtml('biggest win', fmtMoney(s.biggest_win)) +
    cardHtml('voided', s.voided_rounds) + cardHtml('last seen', (s.last_seen || '').replace('T', ' ').slice(0, 16)) + '</div>')).catch(() => {});
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

export const PLAYER_REPORTS_JS = /* js */ `
let lastPlayerReport = null;
const PR_COLS = ['operator_player_id','rounds','free_spin_rounds','total_bet','total_win','ggr','rtp_percent','biggest_win','first_seen','last_seen'];
function playerReportQs() {
  const p = new URLSearchParams();
  const op = $('prOp') ? $('prOp').value.trim() : ''; if (op) p.set('operator_id', op);
  // Dates are whole days: "to" includes the entire day (rounds store full ISO timestamps).
  if ($('prFrom').value) p.set('from', $('prFrom').value);
  if ($('prTo').value) p.set('to', $('prTo').value + 'T23:59:59.999Z');
  if ($('prGame').value.trim()) p.set('game', $('prGame').value.trim());
  p.set('sort', $('prSort').value); p.set('limit', '1000');
  return '?' + p.toString();
}
async function loadPlayerReport() {
  const st = $('prStatus'); const el = $('playerReportTable');
  st.hidden = false; st.className = 'muted'; st.textContent = 'loading…';
  try {
    const d = await api('/admin/v1/reports/players' + playerReportQs());
    lastPlayerReport = d;
    st.textContent = d.count + (d.total_players > d.count ? (' of ' + d.total_players) : '') + ' players';
    if (!d.players.length) { el.innerHTML = '<p class="muted">no player activity in this period</p>'; return; }
    el.innerHTML = '<table><tr><th>player</th>' + (state.scope === 'provider' ? '<th>operator</th>' : '') +
      '<th>rounds</th><th>turnover</th><th>win</th><th>GGR</th><th>RTP %</th><th>biggest win</th><th>last seen</th></tr>' +
      d.players.map(r => '<tr class="clickable" data-op="' + esc(r.operator_id) + '" data-player="' + esc(r.operator_player_id) + '">' +
        '<td><code>' + esc(r.operator_player_id) + '</code></td>' + (state.scope === 'provider' ? '<td>' + esc(r.operator_id.slice(0, 8)) + '…</td>' : '') +
        '<td>' + r.rounds + (r.free_spin_rounds ? ' <span class="muted">(' + r.free_spin_rounds + ' free)</span>' : '') + '</td>' +
        '<td>' + fmtMoney(r.total_bet) + '</td><td>' + fmtMoney(r.total_win) + '</td>' +
        '<td' + (r.ggr < 0 ? ' class="err"' : '') + '>' + fmtMoney(r.ggr) + '</td><td>' + r.rtp_percent + '</td>' +
        '<td>' + fmtMoney(r.biggest_win) + '</td><td>' + (r.last_seen || '').replace('T', ' ').slice(0, 16) + '</td></tr>').join('') + '</table>';
    el.querySelectorAll('tr.clickable').forEach(tr => tr.addEventListener('click', () => {
      if ($('plOp')) $('plOp').value = tr.dataset.op;
      $('plPlayer').value = tr.dataset.player; show('players'); loadPlayer();
    }));
  } catch (e) { flash(st, e.message, false); el.innerHTML = ''; }
}
// Quote every field; neutralise spreadsheet formula injection in text cells
// (player ids come from the operator and could start with = + - @).
function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\\-@]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
async function exportPlayerReportCsv() {
  await loadPlayerReport(); // export exactly what the current filters show
  const d = lastPlayerReport; if (!d || !d.players.length) return;
  const cols = (state.scope === 'provider' ? ['operator_id'] : []).concat(PR_COLS);
  const lines = [cols.join(',')].concat(d.players.map(r => cols.map(c => csvCell(r[c])).join(',')));
  const blob = new Blob([lines.join('\\r\\n') + '\\r\\n'], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'player-report-' + new Date().toISOString().slice(0, 10) + '.csv';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
