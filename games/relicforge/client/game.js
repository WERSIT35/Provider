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
  // ── sound: Relic Forge's own set (audio/manifest.json), played by the shared engine ──
  // Every hook keeps firing its `relicforge:sound` event; each also voices `rf_<name>`.
  const Sound = window.Sound;
  (function defineSounds() {
    if (!Sound?.defineEvents) return;
    const { semis, colPan } = Sound.util;
    const WIN = { "Big win": "rf_win_big", "Mega win": "rf_win_mega", "Epic win": "rf_win_epic" };
    Sound.defineEvents({
      rf_click: { minGap: 30, voice: () => ({ key: "ui_click", bus: "ui" }) },
      rf_confirm: { minGap: 60, voice: () => ({ key: "ui_confirm", bus: "ui" }) },
      rf_spin: { minGap: 80, voice: () => ({ key: "rf_spin", db: -2 }) },
      // One thud per column as the board drops in, panned left to right.
      rf_land: { minGap: 25, voice: (o) => ({ key: "rf_land", pan: colPan(o.col, 6), rate: semis(-(Number(o.col) || 0) * 0.35), db: -4 }) },
      rf_pop: { minGap: 40, voice: (o) => ({ key: "rf_pop", rate: semis(Math.min(6, Number(o.step) || 0)), db: -3 }) },
      // The anvil rings higher with every cascade, unless the round is below the bet (flat).
      rf_cascade_step: { minGap: 60, voice: (o) => ({ key: "rf_anvil", rate: o.flat ? 1 : semis(Math.min(10, ((Number(o.n) || 1) - 1) * 1.5)), jitter: Boolean(o.flat) }) },
      rf_ember_collect: { minGap: 60, voice: (o) => ({ key: "rf_spark", rate: semis(Math.min(5, (Number(o.n) || 1) - 1)) }) },
      rf_special_create: { minGap: 60, voice: () => ({ key: "rf_glint" }) },
      rf_special_detonate: { minGap: 80, voice: () => ({ key: "rf_crunch", duck: true }) },
      rf_combo: { minGap: 80, voice: () => ({ key: "rf_crunch", rate: semis(-2), duck: true }) },
      rf_line_burst: { minGap: 120, voice: () => ({ key: "rf_burst", duck: true }) },
      rf_mult_tier: { minGap: 100, voice: (o) => ({ key: "rf_mult", rate: semis((Number(o.tier) || 1) * 2 - 2), jitter: false }) },
      rf_win: { minGap: 200, voice: () => ({ key: "rf_win" }) },
      rf_win_tier: { minGap: 300, voice: (o) => ({ key: WIN[o.tier] || "rf_win_big", duck: true }) },
      rf_max_win: { voice: () => ({ key: "rf_max_win", duck: true }) },
      rf_meter_full: { minGap: 300, voice: () => ({ key: "rf_gong", duck: true }) },
      rf_draft_open: { minGap: 300, voice: () => ({ key: "rf_gong_soft" }) },
      rf_relic_pick: { minGap: 200, voice: () => ({ key: "rf_pick", duck: true }) },
      rf_evolution: { voice: () => ({ key: "rf_evolve", duck: true }) },
      rf_meltdown_start: { voice: () => ({ key: "rf_meltdown", duck: true }) },
      rf_meltdown_fire: { minGap: 120, voice: () => ({ key: "rf_thunder", db: -4 }) }
    });
  })();
  const sfx = (name, detail) => { try { Sound?.play?.(name, detail || {}); } catch { /* sound is never load-bearing */ } };
  function hook(name, detail) {
    dispatchEvent(new CustomEvent("relicforge:sound", { detail: Object.assign({ name }, detail || {}) }));
    sfx("rf_" + name, detail);
  }
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

  // ── symbols: copperplate engravings on parchment (docs/brand/relicforge.md) ──
  // Ink lines and hatching; molten gold is the only saturated colour, so heat reads at once.
  // Metals: ingots stamped with their alchemical sign, hatching density shows the metal.
  // Gems: cut stones in facet hatching with one colour wash. Ids are the engine's.
  const INK = "#1c1611";
  const METAL = { COPPER: ["♀", 7, 0, "rgba(176,92,40,.28)"], IRON: ["♂", 3.2, 1, "rgba(60,60,64,.22)"], BRONZE: ["♃", 5, 0, "rgba(150,110,40,.26)"], SILVER: ["☽", 11, 0, "rgba(255,255,255,.35)"] };
  const GEM = {
    RUBY: ["rgba(200,30,50,.55)", [[50, 6], [90, 34], [76, 92], [24, 92], [10, 34]]],
    SAPPHIRE: ["rgba(30,80,200,.55)", [[50, 4], [94, 50], [50, 96], [6, 50]]],
    EMERALD: ["rgba(20,140,80,.55)", [[30, 8], [70, 8], [92, 30], [92, 70], [70, 92], [30, 92], [8, 70], [8, 30]]],
    GOLD: ["rgba(255,176,0,.75)", [[50, 4], [62, 36], [96, 38], [69, 59], [79, 94], [50, 74], [21, 94], [31, 59], [4, 38], [38, 36]]]
  };
  const pts = (a) => a.map((p) => p.join(",")).join(" ");
  // A hatch pattern: lines `gap` apart at `ang` degrees; `cross` adds the perpendicular set.
  const hatch = (id, gap, ang, cross, w = 0.9) => `<pattern id="${id}" width="${gap}" height="${gap}" patternUnits="userSpaceOnUse" patternTransform="rotate(${ang})"><path d="M0 0 V${gap}" stroke="${INK}" stroke-width="${w}"/>${cross ? `<path d="M0 0 H${gap}" stroke="${INK}" stroke-width="${w}"/>` : ""}</pattern>`;
  function facets(outer, cx, cy, k, id) {
    // A table (the outline shrunk toward a point) and one facet per edge; shaded facets get hatching.
    const inner = outer.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k]);
    let out = "";
    for (let i = 0; i < outer.length; i += 1) {
      const j = (i + 1) % outer.length;
      const shade = (outer[i][0] + outer[j][0]) / 2 > cx && (outer[i][1] + outer[j][1]) / 2 > cy - 10;
      out += `<polygon points="${pts([outer[i], outer[j], inner[j], inner[i]])}" fill="${shade ? `url(#${id}h)` : "none"}" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>`;
    }
    return out + `<polygon points="${pts(inner)}" fill="rgba(255,250,235,.35)" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }
  function svgFor(sym) {
    const id = "e" + sym;
    if (METAL[sym]) {
      const [sign, gap, cross, wash] = METAL[sym];
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${hatch(id + "f", gap, 45, cross)}${hatch(id + "t", gap * 1.6, -30, 0, 0.7)}</defs>` +
        `<path d="M24 22 H76 L90 40 H10 Z" fill="${wash}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M24 22 H76 L90 40 H10 Z" fill="url(#${id}t)"/>` +
        `<path d="M10 40 H90 L94 84 H6 Z" fill="${wash}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/><path d="M10 40 H90 L94 84 H6 Z" fill="url(#${id}f)" opacity=".85"/>` +
        `<ellipse cx="50" cy="62" rx="27" ry="19" fill="#efe3c6" stroke="${INK}" stroke-width="2.2"/>` +
        `<text x="50" y="74.5" text-anchor="middle" font-size="35" font-weight="700" fill="${INK}" font-family="Georgia, 'Segoe UI Symbol', serif">${sign}</text></svg>`;
    }
    if (GEM[sym]) {
      const [wash, outer] = GEM[sym];
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${hatch(id + "h", 3.4, 40, 0, 0.8)}</defs>` +
        `<polygon points="${pts(outer)}" fill="${wash}" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` + facets(outer, 50, 46, 0.48, id) +
        `<path d="M30 24 l5 -6 M27 30 l-6 -3" stroke="${INK}" stroke-width="1.4" stroke-linecap="round"/></svg>`;
    }
    if (sym === "WILD") { // crossed hammer and tongs in molten gold
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="${id}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffb000" stop-opacity=".55"/><stop offset="1" stop-color="#ffb000" stop-opacity="0"/></radialGradient>` +
        `<linearGradient id="${id}m" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".55" stop-color="#ffb000"/><stop offset="1" stop-color="#ff5e1a"/></linearGradient></defs>` +
        `<circle cx="50" cy="50" r="48" fill="url(#${id})"/>` +
        `<g transform="rotate(-40 50 50)" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"><rect x="46" y="30" width="8" height="58" rx="3" fill="url(#${id}m)"/><rect x="28" y="14" width="44" height="20" rx="3" fill="url(#${id}m)"/></g>` +
        `<g transform="rotate(40 50 50)" stroke="${INK}" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M46 90 L46 40 Q46 26 38 16" stroke="url(#${id}m)" stroke-width="6"/><path d="M54 90 L54 40 Q54 26 62 16" stroke="url(#${id}m)" stroke-width="6"/><path d="M46 90 L46 40 Q46 26 38 16 M54 90 L54 40 Q54 26 62 16" stroke-width="1.6"/></g>` +
        `<circle cx="50" cy="50" r="5" fill="#ffe08a" stroke="${INK}" stroke-width="2"/></svg>`;
    }
    if (sym === "EMBER") { // a gold flame in an ink ring
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".6" stop-color="#ffb000"/><stop offset="1" stop-color="#ff5e1a"/></linearGradient></defs>` +
        `<circle cx="50" cy="52" r="42" fill="none" stroke="${INK}" stroke-width="2.6"/><circle cx="50" cy="52" r="36" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="2 3"/>` +
        `<path d="M50 14 C58 30 74 38 72 58 C70 76 60 84 50 84 C40 84 29 76 28 60 C27 46 38 42 40 30 C45 36 47 40 48 44 C50 32 48 22 50 14Z" fill="url(#${id})" stroke="${INK}" stroke-width="2.4" stroke-linejoin="round"/>` +
        `<path d="M50 50 C55 58 61 63 59 72 C57 79 53 81 50 81 C46 81 42 78 41 72 C40 65 46 61 48 55 Z" fill="#fff4cc" stroke="${INK}" stroke-width="1.2"/></svg>`;
    }
    if (sym === "SCATTER") { // an engraved anvil on a seal
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${hatch(id + "h", 3, 30, 0, 0.9)}</defs>` +
        `<circle cx="50" cy="50" r="46" fill="#efe3c6" stroke="${INK}" stroke-width="2.6"/><circle cx="50" cy="50" r="40" fill="none" stroke="${INK}" stroke-width="1" stroke-dasharray="1 3"/>` +
        `<path d="M16 40 H70 C79 40 86 35 88 30 V46 C82 51 76 53 67 53 L63 63 H71 V72 H29 V63 H37 L33 53 C25 53 18 48 16 40Z" fill="url(#${id}h)" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
        `<path d="M16 40 H70 C79 40 86 35 88 30" fill="none" stroke="#ffb000" stroke-width="2.4" stroke-linecap="round"/>` +
        `<g stroke="#ffb000" stroke-width="2.2" stroke-linecap="round"><path d="M50 26 V18"/><path d="M38 29 L33 22"/><path d="M62 29 L67 22"/></g></svg>`;
    }
    if (sym === "PRISM") { // a prism splitting a gold ray
      return `<svg viewBox="0 0 100 100" aria-hidden="true"><defs>${hatch(id + "h", 3.4, 60, 0, 0.8)}</defs>` +
        `<path d="M2 58 L40 52" stroke="#ffb000" stroke-width="4" stroke-linecap="round"/>` +
        `<g stroke-width="3" stroke-linecap="round"><path d="M62 54 L98 40" stroke="#c83232"/><path d="M62 56 L98 52" stroke="#ffb000"/><path d="M62 58 L98 64" stroke="#2f8c5a"/><path d="M62 60 L98 76" stroke="#3050b8"/></g>` +
        `<polygon points="50,12 86,84 14,84" fill="rgba(255,250,235,.55)" stroke="${INK}" stroke-width="2.6" stroke-linejoin="round"/>` +
        `<polygon points="50,12 86,84 50,84" fill="url(#${id}h)"/><path d="M50 12 L50 84" stroke="${INK}" stroke-width="1.4"/></svg>`;
    }
    return `<svg viewBox="0 0 100 100" aria-hidden="true"></svg>`;
  }

  // ── board ────────────────────────────────────────────────────────────────
  function layout() {
    const r = el.stage.getBoundingClientRect();
    // The iron plate's padding sits around the board; the stage's top padding keeps room for the step readout.
    const cs = getComputedStyle(el.boardWrap);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight), padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const cell = Math.floor(Math.max(26, Math.min(120, Math.min((r.width - padX) / S.cols, (r.height - parseFloat(getComputedStyle(el.stage).paddingTop) - parseFloat(getComputedStyle(el.stage).paddingBottom) - padY - 4) / S.rows))));
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
      for (let c = 0; c < S.cols; c += 1) setTimeout(() => sfx("rf_land", { col: c }), c * 55 + 230);
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
  async function pop(cells, step) {
    if (cells.length) sfx("rf_pop", { step });
    const runs = [];
    for (const p of cells) {
      const n = cellAt(p.row, p.col);
      // The engraving ignites (its ink glows gold), then the cell burns away.
      if (n) runs.push(n.animate(reduced.matches ? [{ opacity: 1 }, { opacity: 0 }] : [
        { filter: "none", opacity: 1, transform: "scale(1)" },
        { filter: "sepia(1) saturate(6) brightness(1.5) drop-shadow(0 0 6px #ffb000)", opacity: 1, transform: "scale(1.04)", offset: 0.45 },
        { filter: "sepia(1) saturate(8) brightness(2.2) blur(1px)", opacity: 0, transform: "scale(.86)" }
      ], { duration: reduced.matches ? 80 : 260, easing: "ease-in", fill: "forwards" }).finished);
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
      <h2>Choose your relic</h2><p>Forge spin ${spinNo} of ${f.spins_total}</p>
      <p>All three choices are worth the same on average; they differ in how much the result can swing.${f.spins_left === 1 ? " <b>Next is Meltdown:</b> every relic fires." : ""}</p>
      <div class="cards">${cards}</div>`);
    el.sheet.querySelectorAll("[data-pick]").forEach((b) => b.addEventListener("click", () => {
      sfx("rf_confirm");
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
        say(`${RELIC_NAMES[r.pick.relic]} ${"I".repeat(r.pick.level)} — the bonus stands at ×${bonus.toFixed(2)}`);
      }
      for (const e of r.evolved || []) await evolutionMoment(e);
      S.forge = Object.assign({}, S.forge, { relics: r.relics, evolutions: r.evolutions, relic_bonus: bonus, pending_offer: null });
      showForge();
      if (r.meltdown) {
        hook("meltdown_start");
        document.body.classList.add("meltdown"); say("Meltdown.", true);
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
      await pop(st.removed, i);
      await render(st.board, st.specials, { moves: st.moves, drops: st.drops });
      await pace(120);
    }
    el.hud.classList.remove("on");
    document.body.classList.remove("meltdown");
    // The server's total is the paid one (capped, rounded); the running figure was the story.
    el.winText.textContent = money(r.total_win);

    if (r.cap_reached) {
      hook("max_win");
      await banner(`<b>Max win</b><span>${money(r.total_win)}</span><small>${Number(S.rules.max_win_cap_multiplier).toLocaleString("en-US")}× the bet: the round ends here</small>`, 3200);
    } else if (celebrate && winTier(r.total_win / bet)) {
      hook("win_tier", { tier: winTier(r.total_win / bet) });
      await banner(`<b>${winTier(r.total_win / bet)}</b><span>${money(r.total_win)}</span>`, 2600);
    }
    if (r.total_win > 0 && !(celebrate && winTier(r.total_win / bet)) && !r.cap_reached) sfx("rf_win");
    if (r.total_win > 0) say(`Forged: ${money(r.total_win)}`, celebrate);
    // The furnace drone starts once the first round has been shown (not during load).
    if (Sound && !S.musicOn) { S.musicOn = true; Sound.warmMusic?.(); Sound.startMusic?.(); }
    else say(free ? "The hammer rests." : "The forge is cold.");
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
      if (!wasForge) { setBalance(S.balance - bet); say("The hammer falls…"); }
      sfx("rf_spin");
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
          if (!(r.total_win > 0)) say("The crucible fills.");
          el.meter.classList.add("pulse");
          setTimeout(() => el.meter.classList.remove("pulse"), 600);
        }
        if (r.meter && r.meter.triggered) hook("meter_full");
      }

      const next = r.feature_state && r.feature_state.forge;
      if (!r.is_free_spin && r.forge_trigger) {
        S.forge = next;
        S.forgeBet = bet;
        Sound?.setMusic?.("freeSpins");
        S.lastOffer = r.offer_next;
        const why = r.forge_trigger === "scatter" ? "Anvil scatters" : r.forge_trigger === "meter" ? "The Forge meter is full" : "Meter full and Anvil scatters";
        await banner(`<b>The Forge</b><span>${S.forge.spins_total} free spins</span><small>${why}. Choose your relic.</small>`, 2600);
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
        Sound?.setMusic?.("base");
        showForge();
        showBet();
        const big = totalX >= 1 ? winTier(totalX) : null;
        if (totalX >= 1) await banner(`<b>${big || "Forge complete"}</b><span>${money(total)}</span><small>Forge total, including the spin that started it</small>`, 3000);
        else await banner(`<span>Forge complete</span><small>Forge total ${money(total)}</small>`, 2200);
        say(`Forged in all: ${money(total)}`, totalX >= 1);
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
      say("The forge is cold.");
    });
  }

  // ── controls ─────────────────────────────────────────────────────────────
  el.spinBtn.addEventListener("click", onSpin);
  el.betDown.addEventListener("click", () => { if (S.betIndex > 0) { S.betIndex -= 1; sfx("rf_click"); showBet(); setControls(); } });
  el.betUp.addEventListener("click", () => { if (S.betIndex < S.bets.length - 1) { S.betIndex += 1; sfx("rf_click"); showBet(); setControls(); } });
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
    // Sounds load on the first touch or key (VX_AUDIO_PRELOAD = "manual"), never during load.
    const startAudio = () => { removeEventListener("pointerdown", startAudio, true); removeEventListener("keydown", startAudio, true); Sound?.preload?.(); Sound?.unlock?.(); };
    addEventListener("pointerdown", startAudio, true);
    addEventListener("keydown", startAudio, true);
    if (S.forge) { say("The Forge still burns. Choose your relic."); openDraft(null); }
    else say("The forge is cold.");
  }
  boot().catch((err) => { say(`Could not start the game (${err.code || err.message})`); document.body.classList.add("app-ready"); });
})();
