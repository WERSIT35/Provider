/*
 * Relic Forge player client (phase 8): a DOM renderer for the RGS round payload.
 *
 * - Server-authoritative: every outcome comes from the RGS (/game/v1/*). The client never
 *   resolves, alters or re-orders anything; it plays the payload's steps back as they are.
 *   Math.random() is not used at all.
 * - The relic pick is sent as the next spin's `choice`; the server checks it against the
 *   offer it stored.
 * - Celebration gating (docs/relic-forge/01-GDD.md §6, §8): a round whose total is below the
 *   bet gets no win tier, no Mult colour climax and a flat cascade pitch. The whole round is
 *   known before it is shown, so the gate is decided up front.
 * - No turbo and no slam-stop (the manifest ships both off).
 * - Shake is element-level only (the board or the cascade counter), and off under
 *   prefers-reduced-motion or with Settings → Screen effects off.
 * - Sound: hooks only (`relicforge:sound` events, GDD §8 names); no audio files yet.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    board: $("board"), boardWrap: $("boardWrap"), stage: $("stage"), banner: $("banner"),
    hud: $("hud"), combo: $("combo"), calc: $("calc"), mult: $("mult"),
    meter: $("meter"), meterText: $("meterText"), meterFill: $("meterFill"),
    forgeSpins: $("forgeSpins"), forgeBonus: $("forgeBonus"), forgeTotal: $("forgeTotal"), meltdownPill: $("meltdownPill"), relics: $("relics"),
    msg: $("msg"), balance: $("balance"), betText: $("betText"), winText: $("winText"),
    betDown: $("betDown"), betUp: $("betUp"), spinBtn: $("spinBtn"), infoBtn: $("infoBtn"), settingsBtn: $("settingsBtn"),
    modal: $("modal"), sheet: $("sheet")
  };

  const RELIC_NAMES = { IGNITE: "Ignite", CHAIN: "Chain", EXPAND: "Expand", MAGNET: "Magnet", HOARD: "Hoard", SURGE: "Surge" };
  const EVO_NAMES = { INFERNO: "Inferno", CATHEDRAL: "Cathedral", SINGULARITY: "Singularity" };
  const SYMBOL_NAMES = { COPPER: "Copper", IRON: "Iron", BRONZE: "Bronze", SILVER: "Silver", RUBY: "Ruby", SAPPHIRE: "Sapphire", EMERALD: "Emerald", GOLD: "Gold", WILD: "Wild", EMBER: "Ember", SCATTER: "Anvil scatter", PRISM: "Prism" };
  const PAY_BANDS = ["5", "6", "7-8", "9-11", "12-14", "15+"];

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode: this page only */ } }
  };

  const S = {
    token: null, rules: null, profile: null, currency: "", bets: [], betIndex: 0, balance: 0,
    playerStates: {}, forge: null, forgeBet: null, busy: false, rows: 5, cols: 6, cell: 56,
    board: null, specials: [], lastAnswerAt: 0, minRoundMs: 0, fx: store.get("rf.fx") !== "0"
  };

  // ── helpers ─────────────────────────────────────────────────────────────
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const pace = (ms) => sleep(reduced.matches ? Math.min(ms, 120) : ms);
  const money = (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const betKey = (b) => Number(b).toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join(""));
  function say(text, win) { el.msg.textContent = text; el.msg.classList.toggle("win", Boolean(win)); }
  function hook(name, detail) { dispatchEvent(new CustomEvent("relicforge:sound", { detail: Object.assign({ name }, detail || {}) })); }
  function fxOn() { return S.fx && !reduced.matches; }
  function syncFx() { document.body.classList.toggle("fx", fxOn()); }
  function shake(node) {
    if (!fxOn()) return;
    node.classList.remove("shake");
    void node.offsetWidth; // restart the animation
    node.classList.add("shake");
  }

  async function api(method, url, body, key) {
    let lastErr;
    // A network failure is retried with the SAME idempotency key: the server answers a
    // repeat with the round it already made, never a second one.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let res;
      try {
        res = await fetch(url, { method, headers: { authorization: `Bearer ${S.token}`, ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, body: body ? JSON.stringify(body) : undefined });
      } catch (err) {
        lastErr = err;
        await sleep(400 * (attempt + 1));
        continue;
      }
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const e = new Error(json?.error?.message || `HTTP_${res.status}`);
        e.code = json?.error?.code || `HTTP_${res.status}`;
        e.status = res.status;
        e.details = json?.error?.details;
        throw e;
      }
      return json;
    }
    const e = new Error("NETWORK");
    e.code = "NETWORK";
    e.cause = lastErr;
    throw e;
  }

  // ── symbols (inline SVG, no image files) ─────────────────────────────────
  const METAL = { COPPER: ["#e08a5a", "#8a3f1d", "ᚠ"], IRON: ["#a9b0b6", "#4a5258", "ᚢ"], BRONZE: ["#d7a55a", "#7a5420", "ᚦ"], SILVER: ["#eef1f4", "#8c96a0", "ᚨ"] };
  const GEM = { RUBY: ["#ff5a6e", "#8a0f22"], SAPPHIRE: ["#5aa8ff", "#0f2f8a"], EMERALD: ["#4fe08f", "#0d6b3a"], GOLD: ["#ffe08a", "#b07a12"] };
  function svgFor(sym) {
    const id = "g" + sym;
    if (METAL[sym]) {
      const [hi, lo, glyph] = METAL[sym];
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></linearGradient></defs>` +
        `<rect x="10" y="10" width="80" height="80" rx="18" fill="url(#${id})" stroke="rgba(0,0,0,.45)" stroke-width="3"/>` +
        `<rect x="18" y="18" width="64" height="64" rx="12" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>` +
        `<text x="50" y="66" text-anchor="middle" font-size="46" font-weight="700" fill="rgba(20,10,4,.75)" font-family="serif">${glyph}</text></svg>`;
    }
    if (GEM[sym]) {
      const [hi, lo] = GEM[sym];
      const shapes = {
        RUBY: "50,8 88,36 74,90 26,90 12,36",
        SAPPHIRE: "50,6 92,50 50,94 8,50",
        EMERALD: "30,8 70,8 92,30 92,70 70,92 30,92 8,70 8,30",
        GOLD: "50,6 62,36 94,38 68,58 78,92 50,72 22,92 32,58 6,38 38,36"
      };
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".25" stop-color="${hi}"/><stop offset="1" stop-color="${lo}"/></radialGradient></defs>` +
        `<polygon points="${shapes[sym]}" fill="url(#${id})" stroke="rgba(0,0,0,.5)" stroke-width="3" stroke-linejoin="round"/>` +
        `<polygon points="${shapes[sym]}" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2" transform="translate(50 50) scale(.62) translate(-50 -50)"/></svg>`;
    }
    if (sym === "WILD") {
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff3c4"/><stop offset=".5" stop-color="#ff9a3d"/><stop offset="1" stop-color="#b3260c"/></linearGradient></defs>` +
        `<circle cx="50" cy="50" r="42" fill="url(#${id})" stroke="#4fd8c0" stroke-width="4"/><text x="50" y="62" text-anchor="middle" font-size="30" font-weight="900" fill="#2a0c02" font-family="system-ui,sans-serif">WILD</text></svg>`;
    }
    if (sym === "EMBER") {
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}" cx=".5" cy=".62" r=".6"><stop offset="0" stop-color="#fff2b0"/><stop offset=".4" stop-color="#ff8a3d"/><stop offset="1" stop-color="#7a1d08"/></radialGradient></defs>` +
        `<path d="M50 8 C62 30 82 38 80 62 C78 82 64 92 50 92 C36 92 22 82 20 62 C19 46 32 40 34 26 C42 34 44 40 46 44 C48 30 46 20 50 8Z" fill="url(#${id})" stroke="rgba(0,0,0,.45)" stroke-width="3"/></svg>`;
    }
    if (sym === "SCATTER") {
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd27a"/><stop offset="1" stop-color="#9a5a12"/></linearGradient></defs>` +
        `<circle cx="50" cy="50" r="44" fill="#2a1408" stroke="url(#${id})" stroke-width="5"/>` +
        `<path d="M18 40 H70 C78 40 84 34 86 30 V46 C80 50 74 52 66 52 L62 62 H70 V70 H30 V62 H38 L34 52 C26 52 20 48 18 40Z" fill="url(#${id})"/></svg>`;
    }
    if (sym === "PRISM") {
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b6b"/><stop offset=".25" stop-color="#ffd36b"/><stop offset=".5" stop-color="#6bffb0"/><stop offset=".75" stop-color="#6bb8ff"/><stop offset="1" stop-color="#c36bff"/></linearGradient></defs>` +
        `<polygon points="50,6 94,86 6,86" fill="url(#${id})" stroke="#fff" stroke-width="4" stroke-linejoin="round"/></svg>`;
    }
    return `<svg viewBox="0 0 100 100" aria-hidden="true"></svg>`;
  }

  // ── board ────────────────────────────────────────────────────────────────
  function layout() {
    const r = el.stage.getBoundingClientRect();
    const cell = Math.floor(Math.max(30, Math.min(120, Math.min(r.width / S.cols, (r.height - 34) / S.rows))));
    S.cell = cell;
    document.documentElement.style.setProperty("--cell", cell + "px");
    document.documentElement.style.setProperty("--rows", String(S.rows));
    for (const c of el.board.children) if (c.dataset.row !== undefined) place(c, Number(c.dataset.row), Number(c.dataset.col));
  }
  function place(node, row, col) { node.style.left = col * S.cell + "px"; node.style.top = row * S.cell + "px"; }

  function cellNode(sym, row, col, special) {
    const d = document.createElement("div");
    d.className = "cell";
    d.dataset.row = row;
    d.dataset.col = col;
    d.innerHTML = svgFor(sym) + (special && special !== "PRISM" ? `<span class="sp ${special}">${special === "RUNE" ? "✚" : "✸"}</span>` : "");
    d.title = (SYMBOL_NAMES[sym] || sym) + (special && special !== "PRISM" ? ` (${special === "RUNE" ? "Rune" : "Bomb"})` : "");
    place(d, row, col);
    return d;
  }
  function cellAt(row, col) { return el.board.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`); }

  /**
   * Draw a board. `fall`: { mode: "enter" } drops every column in from above; { moves,
   * drops } moves the cells that fell and drops the refill in.
   */
  async function render(board, specials, fall) {
    const rows = board.length;
    if (rows !== S.rows) { S.rows = rows; layout(); }
    S.board = board;
    S.specials = specials || [];
    const spAt = new Map(S.specials.map((s) => [s.row * 64 + s.col, s.kind]));
    const frag = document.createDocumentFragment();
    const nodes = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < board[r].length; c += 1) {
        const n = cellNode(board[r][c], r, c, spAt.get(r * 64 + c));
        frag.appendChild(n);
        nodes.push(n);
      }
    }
    el.board.replaceChildren(frag);
    if (!fall || reduced.matches) {
      if (fall && reduced.matches) await fade(nodes);
      return;
    }
    const offsets = new Map();
    if (fall.mode === "enter") {
      for (const n of nodes) offsets.set(n, { rows: rows + 1, delay: Number(n.dataset.col) * 55 });
    } else {
      for (const m of fall.moves || []) { const n = cellAt(m.to.row, m.to.col); if (n) offsets.set(n, { rows: m.to.row - m.from.row, delay: 0 }); }
      const perCol = {};
      for (const d of fall.drops || []) perCol[d.col] = (perCol[d.col] || 0) + 1;
      for (const d of fall.drops || []) { const n = cellAt(d.row, d.col); if (n) offsets.set(n, { rows: perCol[d.col], delay: 40 }); }
    }
    const runs = [];
    for (const [n, o] of offsets) {
      if (o.rows <= 0) continue;
      const ms = 170 + 55 * Math.sqrt(o.rows) * 2;
      runs.push(n.animate([{ transform: `translateY(${-o.rows * S.cell}px)` }, { transform: "translateY(0)" }], { duration: ms, delay: o.delay, easing: "cubic-bezier(.5,0,.85,.55)", fill: "backwards" }).finished);
    }
    await Promise.all(runs);
  }
  function fade(nodes) {
    return Promise.all(nodes.map((n) => n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120 }).finished));
  }
  async function exitBoard() {
    const nodes = Array.from(el.board.children);
    if (!nodes.length || reduced.matches) return;
    await Promise.all(nodes.map((n) => n.animate([{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${S.rows * S.cell * 0.6}px)`, opacity: 0 }], { duration: 220, delay: Number(n.dataset.col) * 30, easing: "cubic-bezier(.5,0,1,.6)", fill: "forwards" }).finished));
  }
  function mark(cells, cls) { for (const p of cells) cellAt(p.row, p.col)?.classList.add(cls); }
  async function pop(cells) {
    const runs = [];
    for (const p of cells) {
      const n = cellAt(p.row, p.col);
      if (n) runs.push(n.animate([{ transform: "scale(1)", opacity: 1 }, { transform: "scale(.2)", opacity: 0 }], { duration: reduced.matches ? 80 : 200, easing: "ease-in", fill: "forwards" }).finished);
    }
    await Promise.all(runs);
  }
  function burstRows(rows) {
    for (const r of rows) {
      const b = document.createElement("div");
      b.className = "burst-row";
      b.style.top = r * S.cell + "px";
      el.board.appendChild(b);
    }
  }

  // ── HUD ──────────────────────────────────────────────────────────────────
  const currentBet = () => (S.forge ? S.forgeBet : S.bets[S.betIndex]);
  function setBalance(v) { S.balance = v; el.balance.textContent = money(v); }
  function showBet() { el.betText.textContent = money(currentBet()); showMeter(); }
  function showMeter() {
    const full = S.rules?.forge_meter?.embers_to_fill || 40;
    const n = Math.min(full, Number(S.playerStates[betKey(S.bets[S.betIndex])]?.embers || 0));
    el.meterText.textContent = `${n} / ${full}`;
    el.meterFill.style.width = (100 * n) / full + "%";
  }
  function multTier(m, celebrate) {
    if (!celebrate) return 0;
    return m >= 25 ? 3 : m >= 10 ? 2 : m >= 5 ? 1 : 0;
  }
  function showForge() {
    document.body.classList.toggle("in-forge", Boolean(S.forge));
    const f = S.forge;
    if (!f) { el.relics.replaceChildren(); el.meltdownPill.hidden = true; return; }
    const spinNo = f.spins_total - f.spins_left + 1;
    el.forgeSpins.innerHTML = `Forge spin <b>${Math.min(spinNo, f.spins_total)}</b> / ${f.spins_total}`;
    el.forgeBonus.innerHTML = `Relic bonus <b>×${Number(f.relic_bonus || 1).toFixed(2)}</b>`;
    el.forgeTotal.innerHTML = `Forge win <b>${money(Number(f.round_x || 0) * S.forgeBet)}</b>`;
    el.meltdownPill.hidden = f.spins_left !== 1;
    relicTray(f.relics, f.evolutions, false);
  }
  function relicTray(levels, evolutions, meltdown) {
    const chips = [];
    const consumed = new Set();
    for (const e of evolutions || []) for (const r of S.rules.evolutions[e].from) consumed.add(r);
    for (const e of evolutions || []) chips.push(`<span class="relic-chip evo" data-evo="${e}"><i>★</i>${EVO_NAMES[e] || e}</span>`);
    for (const r of Object.keys(RELIC_NAMES)) {
      const lv = levels?.[r] || 0;
      if (consumed.has(r) && !meltdown) continue;
      if (!lv && !meltdown) continue;
      const shown = meltdown ? Math.max(1, lv) : lv;
      chips.push(`<span class="relic-chip${lv ? "" : " ghost"}" data-relic="${r}"><i>${RELIC_NAMES[r][0]}</i>${RELIC_NAMES[r]} <span class="pips">${"●".repeat(shown)}${"○".repeat(3 - shown)}</span></span>`);
    }
    el.relics.innerHTML = chips.join("");
  }
  function setControls() {
    const idle = !S.busy && el.modal.hidden;
    el.spinBtn.disabled = !idle;
    el.spinBtn.textContent = S.forge ? (S.forge.pending_offer ? "PICK" : "SPIN") : "SPIN";
    el.betDown.disabled = !idle || Boolean(S.forge) || S.betIndex <= 0;
    el.betUp.disabled = !idle || Boolean(S.forge) || S.betIndex >= S.bets.length - 1;
    el.infoBtn.disabled = S.busy;
    el.settingsBtn.disabled = S.busy;
  }

  // ── rules text (from rules.json and the session's profile) ───────────────
  function relicLevelText(relic, lv) {
    const R = S.rules.relics[relic];
    const i = lv - 1;
    const pct = (f) => (f === 0 ? "removed" : `thinned to ${Math.round(f * 100)}%`);
    switch (relic) {
      case "IGNITE": return `${R.wilds[i]} Wild${R.wilds[i] > 1 ? "s" : ""} placed on random cells each spin.`;
      case "CHAIN": return `The Mult grows by +${R.inc[i]} per cascade (instead of +${S.rules.mult.inc}).`;
      case "EXPAND": return `The board has ${R.rows[i]} rows.`;
      case "MAGNET": return `Specials made in a spin come back for the next ${R.stick_spins[i]} spins.` + (R.rune_min[i] < S.rules.specials.RUNE.min ? ` Clusters of ${R.rune_min[i]} make Runes.` : "");
      case "HOARD": return Object.entries(R.factors[i]).map(([s, f]) => `${SYMBOL_NAMES[s]} ${pct(f)}`).join(", ") + " in the draw.";
      case "SURGE": return "The Mult carries into the next spin." + (R.carry_bonus[i] ? ` +${R.carry_bonus[i]} at each spin start.` : "") + (R.burst[i] !== S.rules.mult.line_burst ? ` Line Burst ×${R.burst[i]}.` : "");
      default: return "";
    }
  }
  function evoText(name) {
    const e = S.rules.evolutions[name];
    if (name === "INFERNO") return `Each Wild in a cluster multiplies its pay ×${e.wild_mult}.`;
    if (name === "CATHEDRAL") return `${e.rows}-row board; ` + Object.entries(e.factors || {}).map(([s, f]) => `${SYMBOL_NAMES[s]} ${f === 0 ? "removed" : `thinned to ${Math.round(f * 100)}%`}`).join(", ") + ".";
    if (name === "SINGULARITY") return "Specials and the Mult persist for every remaining spin.";
    return "";
  }

  // ── modal ────────────────────────────────────────────────────────────────
  let modalDone = null;
  function openModal(html, onClose) {
    el.sheet.innerHTML = html;
    el.modal.hidden = false;
    modalDone = onClose || null;
    setControls();
    el.sheet.querySelector("[data-focus]")?.focus() || el.sheet.querySelector("button")?.focus();
  }
  function closeModal(reason) {
    if (el.modal.hidden) return;
    el.modal.hidden = true;
    el.sheet.innerHTML = "";
    const done = modalDone;
    modalDone = null;
    setControls();
    if (done) done(reason);
  }
  el.modal.addEventListener("click", (e) => {
    const b = e.target.closest("[data-close]");
    if (b) closeModal(b.dataset.close);
    else if (e.target === el.modal && !el.sheet.querySelector(".cards")) closeModal("backdrop");
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !el.modal.hidden && !el.sheet.querySelector(".cards")) closeModal("escape");
    if ((e.key === " " || e.key === "Enter") && el.modal.hidden && document.activeElement === document.body && !el.spinBtn.disabled) { e.preventDefault(); onSpin(); }
  });

  function openInfo() {
    const p = S.profile;
    const sizes = PAY_BANDS.map((b) => `<th>${b}</th>`).join("");
    const rowsFor = (scaler) => [...S.rules.symbols.premium.slice().reverse(), ...S.rules.symbols.low.slice().reverse()]
      .map((s) => `<tr><td>${svgFor(s)}${SYMBOL_NAMES[s]}</td>${PAY_BANDS.map((b) => `<td>${(S.rules.paytable[s][b] * scaler).toFixed(2)}</td>`).join("")}</tr>`).join("");
    const relicRows = Object.keys(RELIC_NAMES).map((r) => `<tr><td>${RELIC_NAMES[r]}</td>${[1, 2, 3].map((l) => `<td style="text-align:left">${esc(relicLevelText(r, l))}</td>`).join("")}</tr>`).join("");
    const evoRows = Object.keys(S.rules.evolutions).map((e) => `<li><b>${EVO_NAMES[e]}</b> (${S.rules.evolutions[e].from.map((r) => RELIC_NAMES[r]).join(" + ")} at Lv3): ${esc(evoText(e))}</li>`).join("");
    const sp = S.rules.specials;
    openModal(`
      <button class="icon close" data-close="x" aria-label="Close">✕</button>
      <h2>Relic Forge rules</h2>
      <p>6×5 cluster pays: ${S.rules.layout.min_cluster} or more of a symbol touching up, down, left or right pay. Winning clusters leave, symbols fall, new ones drop in, and the cascade goes on while new clusters form. Each cascade adds to the Mult (×${S.rules.mult.start}, then +${S.rules.mult.inc} per cascade); a cascade that clears a whole row is a Line Burst and pays ×${S.rules.mult.line_burst} for that cascade.</p>
      <p>Specials: a cluster of ${sp.RUNE.min}–${sp.RUNE.max} leaves a Rune (clears its row and column), ${sp.BOMB.min}–${sp.BOMB.max} a Bomb (clears the 3×3 around it), ${sp.PRISM.min}+ a Prism (clears every cell of the most common symbol). Touching specials combine. Cleared cells pay as clusters of their symbol.</p>
      <h3>Pays (× bet, by cluster size)</h3>
      <table><thead><tr><th>Symbol</th>${sizes}</tr></thead><tbody>${rowsFor(p.payout_scaler)}</tbody></table>
      <h3>Forge meter</h3>
      <p>Embers next to a winning cluster, or cleared by a special, fill the Forge meter (${S.rules.forge_meter.embers_to_fill} Embers). Your meter is saved for you, separately for each bet size, and stays between visits. When it is full the Forge starts and the meter empties. ${S.rules.forge.scatters_to_trigger} or more Anvil scatters on the board after the cascades also start the Forge, and leave the meter as it is. If the game's rules are updated, saved meters are reset.</p>
      <h3>The Forge</h3>
      <p>${S.rules.forge.free_spins} free spins at the bet that started it. Before each spin, choose 1 of ${S.rules.forge.offer_size} relics; choosing one you hold levels it up (max Lv3). All three choices are worth the same on average; they differ in how much the result can swing (shown as Volatility). The Relic bonus shown on screen is how this is balanced: each choice sets a factor, and every Forge spin pays cascades × Mult × Relic bonus.</p>
      <p>In the Forge, cluster pays are the table above × ${(p.free_spin_payout_scaler / p.payout_scaler).toFixed(4)}, before the Mult and the Relic bonus:</p>
      <table><thead><tr><th>Symbol</th>${sizes}</tr></thead><tbody>${rowsFor(p.free_spin_payout_scaler)}</tbody></table>
      <table><thead><tr><th>Relic</th><th style="text-align:left">Lv1</th><th style="text-align:left">Lv2</th><th style="text-align:left">Lv3</th></tr></thead><tbody>${relicRows}</tbody></table>
      <p>Evolutions: when both relics of a pair reach Lv3 they fuse.</p><ul>${evoRows}</ul>
      <p><b>Meltdown:</b> on the last Forge spin every relic fires, the ones you do not hold at Lv1.</p>
      <p>If you leave during the Forge, it continues when you return. If the game has to finish it for you, the first relic of each choice is taken.</p>
      <h3>Max win and return</h3>
      <p>Wins are capped at ${Number(S.rules.max_win_cap_multiplier).toLocaleString("en-US")}× the bet per round, including the whole Forge. When the cap is reached, the round ends.</p>
      <p>Theoretical return to player: ${Number(p.theoretical_percent).toFixed(2)}%. Over a short session results vary widely. Every outcome is decided by the server; malfunction voids all pays and plays.</p>
      <div class="actions"><button class="primary" data-close="ok" data-focus>Close</button></div>`);
  }
  function openSettings() {
    const pressed = S.fx ? "true" : "false";
    openModal(`
      <button class="icon close" data-close="x" aria-label="Close">✕</button>
      <h2>Settings</h2>
      <div class="toggle"><span>Screen effects (board shake)${reduced.matches ? " — off: your device asks for reduced motion" : ""}</span><button id="fxToggle" aria-pressed="${pressed}" ${reduced.matches ? "disabled" : ""}>${S.fx ? "On" : "Off"}</button></div>
      <div class="actions"><button class="primary" data-close="ok" data-focus>Done</button></div>`);
    $("fxToggle")?.addEventListener("click", (e) => {
      S.fx = !S.fx;
      store.set("rf.fx", S.fx ? "1" : "0");
      e.currentTarget.setAttribute("aria-pressed", String(S.fx));
      e.currentTarget.textContent = S.fx ? "On" : "Off";
      syncFx();
    });
  }

  /** The offer as cards. `info` is the server's offer_next; on a resume it is rebuilt from the stored offer. */
  function openDraft(info) {
    const f = S.forge;
    const offer = info || f.pending_offer.map((relic) => ({ relic, level_next: (f.relics[relic] || 0) + 1, volatility: null }));
    const spinNo = f.spins_total - f.spins_left + 1;
    hook("draft_open", { spin: spinNo });
    const cards = offer.map((o, i) => {
      const lv = o.level_next;
      let evoHint = "";
      if (lv === 3) {
        for (const [name, evo] of Object.entries(S.rules.evolutions)) {
          if ((f.evolutions || []).includes(name) || !evo.from.includes(o.relic)) continue;
          const other = evo.from.find((r) => r !== o.relic);
          if ((f.relics[other] || 0) >= 3) evoHint = `<span class="evo-hint">★ Completes ${EVO_NAMES[name]}: ${esc(evoText(name))}</span>`;
        }
      }
      return `<button class="card" data-pick="${i}" ${i === 0 ? "data-focus" : ""}>
        <h4>${RELIC_NAMES[o.relic]} <small>LV ${lv}</small></h4>
        <p>${esc(relicLevelText(o.relic, lv))}</p>${evoHint}
        ${o.volatility ? `<span class="vol" data-v="${o.volatility}">Volatility · ${o.volatility}</span>` : ""}
      </button>`;
    }).join("");
    openModal(`
      <h2>Choose a relic · Forge spin ${spinNo} / ${f.spins_total}</h2>
      <p>All three choices are worth the same on average; they differ in how much the result can swing.${f.spins_left === 1 ? " <b>Next is Meltdown:</b> every relic fires." : ""}</p>
      <div class="cards">${cards}</div>`);
    el.sheet.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      const choice = Number(b.dataset.pick);
      closeModal("pick");
      spin(choice);
    }));
  }

  // ── banners ──────────────────────────────────────────────────────────────
  function banner(html, ms) {
    return new Promise((res) => {
      el.banner.innerHTML = html;
      el.banner.hidden = false;
      let t = 0;
      const done = () => { clearTimeout(t); el.banner.hidden = true; el.banner.removeEventListener("click", done); res(); };
      el.banner.addEventListener("click", done);
      t = setTimeout(done, reduced.matches ? Math.min(ms, 1400) : ms);
    });
  }
  function winTier(totalX) { return totalX >= 200 ? "Epic win" : totalX >= 50 ? "Mega win" : totalX >= 10 ? "Big win" : null; }

  /** Evolution: 1.5 s full-screen moment, skippable after the player's first view of it. */
  function evolutionMoment(name) {
    hook("evolution", { kind: name });
    const key = "rf.seen." + name;
    const seen = store.get(key) === "1";
    store.set(key, "1");
    return new Promise((res) => {
      openModal(`<div class="evo-moment"><b>${EVO_NAMES[name]}</b><p>${esc(evoText(name))}</p>${seen ? '<div class="actions" style="justify-content:center"><button data-close="skip" data-focus>Skip</button></div>' : ""}</div>`, () => res());
      setTimeout(() => closeModal("timer"), reduced.matches ? 900 : 1500);
    });
  }

  // ── a round, played back ─────────────────────────────────────────────────
  async function playRound(r, bet) {
    const free = Boolean(r.is_free_spin);
    const scaler = free ? S.profile.free_spin_payout_scaler : S.profile.payout_scaler;
    const bonus = free ? Number(r.relic_bonus || 1) : 1;
    // Celebration gate: a base round below the bet, or a Forge spin below the bet, gets none.
    const celebrate = Number(r.total_win) >= bet;

    if (free) {
      if (r.pick) {
        hook("relic_pick", { relic: r.pick.relic, level: r.pick.level });
        say(`${RELIC_NAMES[r.pick.relic]} Lv${r.pick.level} · Relic bonus ×${bonus.toFixed(2)}`);
      }
      for (const e of r.evolved || []) await evolutionMoment(e);
      S.forge = Object.assign({}, S.forge, { relics: r.relics, evolutions: r.evolutions, relic_bonus: bonus, pending_offer: null });
      showForge();
      if (r.meltdown) {
        hook("meltdown_start");
        el.meltdownPill.hidden = false;
        relicTray(r.relics, r.evolutions, true);
        shake(el.boardWrap);
        for (const chip of el.relics.children) {
          chip.classList.add("fire");
          hook("meltdown_fire", { relic: chip.dataset.relic || chip.dataset.evo });
          await pace(160);
          chip.classList.remove("fire");
        }
      }
    }

    await exitBoard();
    await render(r.initial_board, r.stuck_placed || [], { mode: "enter" });
    if ((r.wilds_placed || []).length || (r.stuck_placed || []).length) {
      mark(r.wilds_placed || [], "mark");
      mark(r.stuck_placed || [], "mark");
      await pace(380);
    }

    let running = 0;
    el.winText.textContent = money(0);
    for (let i = 0; i < r.steps.length; i += 1) {
      const st = r.steps[i];
      el.hud.classList.add("on");
      el.combo.textContent = `Cascade ${i + 1}`;
      if (i >= 2) shake(el.combo);
      el.mult.textContent = `×${st.mult}`;
      el.mult.dataset.tier = String(multTier(st.mult, celebrate));
      if (multTier(st.mult, celebrate)) hook("mult_tier", { tier: multTier(st.mult, celebrate) });
      const baseWin = st.base_x * scaler * bet;
      el.calc.textContent = free ? `${money(baseWin)} × ${st.mult} × ${bonus.toFixed(2)}` : `${money(baseWin)} × ${st.mult}`;
      hook("cascade_step", { n: Math.min(i + 1, 8), flat: !celebrate });

      for (const c of st.clusters) mark(c.cells, "win");
      for (const d of st.detonations) {
        mark(d.cells, "blast");
        hook(d.kind.includes("_") ? "combo" : "special_detonate", { kind: d.kind });
        if (d.kind.includes("_") || d.kind === "PRISM") shake(el.boardWrap);
      }
      if (st.line_burst.length) { burstRows(st.line_burst); hook("line_burst"); }
      if (st.embers_collected.length) { mark(st.embers_collected, "blast"); hook("ember_collect", { n: st.embers_collected.length }); }
      await pace(st.detonations.length ? 620 : 480);

      running += st.step_x * scaler * bonus * bet;
      el.winText.textContent = money(running);
      for (const s of st.specials_created) hook("special_create", { kind: s.kind });
      await pop(st.removed);
      await render(st.board, st.specials, { moves: st.moves, drops: st.drops });
      await pace(120);
    }
    el.hud.classList.remove("on");
    // The server's total is the paid one (capped, rounded); the running figure was the story.
    el.winText.textContent = money(r.total_win);

    if (r.cap_reached) {
      hook("max_win");
      await banner(`<b>Max win</b><span>${money(r.total_win)}</span><small>${Number(S.rules.max_win_cap_multiplier).toLocaleString("en-US")}× the bet: the round ends here</small>`, 3200);
    } else if (celebrate && winTier(r.total_win / bet)) {
      hook("win_tier", { tier: winTier(r.total_win / bet) });
      await banner(`<b>${winTier(r.total_win / bet)}</b><span>${money(r.total_win)}</span>`, 2600);
    }
    if (r.total_win > 0) say(`Win ${money(r.total_win)}`, celebrate);
    else say(free ? "No win this spin" : `Clusters of ${S.rules.layout.min_cluster}+ pay`);
  }

  // ── spin ─────────────────────────────────────────────────────────────────
  async function onSpin() {
    if (S.busy || !el.modal.hidden) return;
    if (S.forge && S.forge.pending_offer) { openDraft(S.lastOffer || null); return; }
    await spin(undefined);
  }

  async function spin(choice) {
    if (S.busy) return;
    S.busy = true;
    setControls();
    const bet = currentBet();
    const wasForge = Boolean(S.forge);
    try {
      // Pace from the RGS answer, never from the send (the RGS enforces it anyway).
      const wait = S.minRoundMs - (Date.now() - S.lastAnswerAt);
      if (!wasForge && wait > 0) await sleep(wait);
      if (!wasForge) { setBalance(S.balance - bet); say("Good luck!"); }
      let r;
      try {
        r = await api("POST", "/game/v1/spin", Object.assign({ bet_amount: bet }, choice === undefined ? {} : { choice }), uuid());
      } catch (err) {
        if (!wasForge) setBalance(S.balance + bet);
        if (err.code === "REALITY_CHECK_REQUIRED") { realityCheck(err.details); return; }
        say(err.code === "INSUFFICIENT_FUNDS" ? "Not enough credit for this bet" : `Round not played (${err.code || err.message})`);
        return;
      } finally {
        S.lastAnswerAt = Date.now();
      }
      await playRound(r, bet);
      setBalance(Number(r.balance?.amount ?? r.balance));

      if (!r.is_free_spin && r.player_state) {
        S.playerStates[betKey(bet)] = r.player_state;
        showMeter();
        if (r.meter && r.meter.collected) {
          el.meter.classList.add("pulse");
          setTimeout(() => el.meter.classList.remove("pulse"), 600);
        }
        if (r.meter && r.meter.triggered) hook("meter_full");
      }

      const next = r.feature_state && r.feature_state.forge;
      if (!r.is_free_spin && r.forge_trigger) {
        S.forge = next;
        S.forgeBet = bet;
        S.lastOffer = r.offer_next;
        const why = r.forge_trigger === "scatter" ? "Anvil scatters" : r.forge_trigger === "meter" ? "The Forge meter is full" : "Meter full and Anvil scatters";
        await banner(`<b>The Forge</b><span>${S.forge.spins_total} free spins</span><small>${why} · choose a relic before each spin</small>`, 2600);
        showForge();
        showBet();
        openDraft(r.offer_next);
        return;
      }
      if (r.is_free_spin) {
        if (next) {
          S.forge = next;
          S.lastOffer = r.offer_next;
          showForge();
          openDraft(r.offer_next);
          return;
        }
        // The Forge is over (all spins played, or the max win).
        const totalX = Number(r.forge_round_x || 0);
        const total = totalX * S.forgeBet;
        S.forge = null;
        S.lastOffer = null;
        showForge();
        showBet();
        const big = totalX >= 1 ? winTier(totalX) : null;
        if (totalX >= 1) await banner(`<b>${big || "Forge complete"}</b><span>${money(total)}</span><small>Forge total, including the spin that started it</small>`, 3000);
        else await banner(`<span>Forge complete</span><small>Forge total ${money(total)}</small>`, 2200);
        say(`Forge total ${money(total)}`, totalX >= 1);
      }
    } finally {
      S.busy = false;
      setControls();
    }
  }

  function realityCheck(details) {
    const mins = details && details.session_minutes != null ? ` You have played for ${Math.round(details.session_minutes)} minutes.` : "";
    openModal(`<h2>Reality check</h2><p>Time for a break?${mins}</p><div class="actions"><button data-close="leave">Leave the game</button><button class="primary" data-close="continue" data-focus>Keep playing</button></div>`, async (reason) => {
      if (reason === "leave") { say("You can close the game now"); return; }
      await api("POST", "/game/v1/reality-check/ack", {}, uuid()).catch(() => {});
      say("Ready");
    });
  }

  // ── controls ─────────────────────────────────────────────────────────────
  el.spinBtn.addEventListener("click", onSpin);
  el.betDown.addEventListener("click", () => { if (S.betIndex > 0) { S.betIndex -= 1; showBet(); setControls(); } });
  el.betUp.addEventListener("click", () => { if (S.betIndex < S.bets.length - 1) { S.betIndex += 1; showBet(); setControls(); } });
  el.infoBtn.addEventListener("click", openInfo);
  el.settingsBtn.addEventListener("click", openSettings);
  reduced.addEventListener?.("change", syncFx);

  // ── boot ─────────────────────────────────────────────────────────────────
  async function boot() {
    syncFx();
    const KEY = "relicforge.session";
    const lt = new URLSearchParams(location.search).get("lt");
    const rulesP = fetch("rules.json", { credentials: "same-origin", mode: "cors" }).then((r) => r.json());
    let session;
    if (lt) {
      S.token = lt;
      try {
        session = await api("POST", "/game/v1/session/init", null);
        S.token = session.session_token;
        try { sessionStorage.setItem(KEY, S.token); } catch { /* a reload will need a new launch */ }
      } catch (err) {
        const stored = (() => { try { return sessionStorage.getItem(KEY); } catch { return null; } })();
        if (!stored) throw err;
        S.token = stored;
        session = await api("GET", "/game/v1/session");
      }
    } else {
      S.token = (() => { try { return sessionStorage.getItem(KEY); } catch { return null; } })();
      if (!S.token) { say("Open the game from the casino"); document.body.classList.add("app-ready"); return; }
      session = await api("GET", "/game/v1/session");
    }
    S.rules = await rulesP;
    S.profile = S.rules.rtp_profiles.find((p) => p.game_id === session.game?.code) || S.rules.rtp_profiles[0];
    S.currency = session.currency;
    S.bets = session.allowed_bets.slice().sort((a, b) => a - b);
    S.minRoundMs = Number(session.regulatory?.min_round_ms || 0);
    S.playerStates = Object.assign({}, session.resume?.player_states || {});
    const feature = session.resume?.feature;
    const forge = feature?.feature_state?.forge;
    const resumeBet = forge ? feature.locked_bet : session.resume?.bet_amount;
    const fallback = S.bets.indexOf(1) >= 0 ? S.bets.indexOf(1) : 0;
    S.betIndex = resumeBet != null && S.bets.indexOf(resumeBet) >= 0 ? S.bets.indexOf(resumeBet) : fallback;
    if (forge && forge.spins_left > 0) { S.forge = forge; S.forgeBet = Number(feature.locked_bet); }
    setBalance(Number(session.balance?.amount ?? session.balance));
    S.cols = S.rules.layout.cols;
    S.rows = S.rules.layout.rows;
    layout();
    new ResizeObserver(() => layout()).observe(el.stage);
    // A resting board before the first spin: one row per symbol set, no outcome implied.
    const sample = [...S.rules.symbols.low, ...S.rules.symbols.premium];
    const idle = [];
    for (let r = 0; r < S.rows; r += 1) idle.push(Array.from({ length: S.cols }, (_, c) => sample[(r * 3 + c * 5) % sample.length]));
    await render(idle, [], null);
    showBet();
    showForge();
    document.body.classList.add("app-ready");
    performance.mark("app-ready");
    setControls();
    if (S.forge) { say("Your Forge continues"); openDraft(null); }
    else say(`Clusters of ${S.rules.layout.min_cluster}+ pay · good luck!`);
  }
  boot().catch((err) => { say(`Could not start the game (${err.code || err.message})`); document.body.classList.add("app-ready"); });
})();
