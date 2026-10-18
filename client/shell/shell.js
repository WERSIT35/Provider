/*
 * Lumina Shell: the ONE player interface every Lumina game uses (docs/lumina-overhaul).
 *
 * The shell owns the page frame and every control; the game owns only its stage (logo +
 * board) and a theme (CSS custom properties, see shell.css). Positions, order, sizes,
 * behaviour and the meaning of every icon are identical in every game, so a player who
 * knows one Lumina game can play the others blind. Spec: reports/Slot provider UI and
 * motion.md, Part 3 (component list, layouts, sizes, states, market switches).
 *
 *   const shell = LuminaShell.mount({ game: "classic", stage: el, features, fmt, on: {...} });
 *
 * Contract
 *   - The game moves its stage element into the frame; the shell never touches what is
 *     inside it. No shell state change moves or resizes the stage (zero layout thrash):
 *     controls that a market or a state switches off are hidden IN PLACE (visibility).
 *   - Values the shell shows come from the game (setBalance, setBet, setWin): the shell
 *     never computes money. Celebration decisions use celebrates(roundWin, stake), which
 *     applies the market's celebrate_threshold (UK RTS 14F / AGCO 2.20: no win effects
 *     when the return is at or below the stake).
 *   - Every popup is a VxNotify modal (client/notify.js): one lifecycle, focus trap,
 *     Escape. The shell registers its sheets (menu, info, autoplay, bet, notice).
 *   - No idle motion: the shell runs no timers or animation frames while the game rests,
 *     except the ticker's tip rotation (a text swap every few seconds, no rAF).
 *
 * A browser IIFE on globalThis.LuminaShell. Load after notify.js and motion.js.
 */
(function (root) {
  "use strict";

  const SVG = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
    sound: '<path d="M4 10v4h4l5 4V6l-5 4H4z"/><path class="lsh-wave" d="M16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11"/>',
    minus: '<path d="M6 12h12"/>',
    plus: '<path d="M6 12h12M12 6v12"/>',
    auto: '<path d="M19 12a7 7 0 1 1-2.05-4.95"/><path d="M19 4v4h-4"/>',
    turbo: '<path d="M13 3 6 13h5l-1 8 7-10h-5l1-8z"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>'
  };
  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${SVG[name]}</svg>`;
  // The spin face: two chasing arrows (spin), a square (stop), a double chevron (skip).
  const SPIN_FACE =
    '<svg class="lsh-spin__go" viewBox="0 0 64 64" aria-hidden="true"><g><path d="M15.08 25.84 A18 18 0 0 1 48.92 25.84"/><path class="lsh-head" d="M50.29 29.6 L52.59 21.31 L43.19 24.73 Z"/></g><g transform="rotate(180 32 32)"><path d="M15.08 25.84 A18 18 0 0 1 48.92 25.84"/><path class="lsh-head" d="M50.29 29.6 L52.59 21.31 L43.19 24.73 Z"/></g></svg>' +
    '<svg class="lsh-spin__stop" viewBox="0 0 64 64" aria-hidden="true"><rect x="22" y="22" width="20" height="20" rx="3"/></svg>' +
    '<svg class="lsh-spin__skip" viewBox="0 0 64 64" aria-hidden="true"><path d="M20 20 L32 32 L20 44"/><path d="M33 20 L45 32 L33 44"/></svg>' +
    '<span class="lsh-spin__label" aria-hidden="true"></span>' +
    '<svg class="lsh-spin__ring" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="30"/></svg>';

  const PREF_KEY = "lumina.shell.prefs";
  const DEFAULT_PREFS = { leftHand: false, reducedMotion: null, batterySaver: false, intro: true, speed: "normal" };
  const store = {
    load() { try { return Object.assign({}, DEFAULT_PREFS, JSON.parse(localStorage.getItem(PREF_KEY) || "{}")); } catch { return Object.assign({}, DEFAULT_PREFS); } },
    save(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode: this page only */ } }
  };
  const osReduced = root.matchMedia ? root.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // Market switches (report Part 3). Values the RGS sends win; a missing field falls back
  // to the jurisdiction's preset here (clients older than the profile fields still behave).
  // VERIFIED / UNCONFIRMED per the research; not legal advice.
  const MARKET_FALLBACK = {
    UKGC: { celebrate_threshold: "gt_stake", session_hud: "net_time", no_input_queue: true },  // RTS 14F, 14D (VERIFIED)
    ON: { celebrate_threshold: "gt_stake", session_hud: "net_time", no_input_queue: true },    // AGCO 2.20-2.22 (VERIFIED)
    DE: { celebrate_threshold: "gt_stake", session_hud: "panic", no_input_queue: true, rtp_display: "stake_area" }, // GlüStV §22a(3), §6i (VERIFIED)
    SE: { celebrate_threshold: "gt_stake", session_hud: "balance", no_input_queue: true },     // SIFS 2022:3 (VERIFIED: no queued presses)
    ES: { celebrate_threshold: "gt_stake", session_hud: "session", no_input_queue: true },     // UNCONFIRMED (law-firm summary)
    NL: { celebrate_threshold: "gt_stake", no_input_queue: true },                              // UNCONFIRMED
    NJ: { session_hud: "clock_elapsed", no_input_queue: true }                                  // N.J.A.C. 13:69O (VERIFIED)
  };

  function mount(opts) {
    const o = Object.assign({ features: {}, on: {}, fmt: (v) => Number(v || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), currency: "" }, opts);
    const on = o.on;
    const features = Object.assign({ buy: false, ante: false, autoplay: true, turbo: true, stop: true }, o.features);
    const prefs = store.load();
    const doc = root.document;

    // ── frame ───────────────────────────────────────────────────────────────
    const frame = doc.createElement("div");
    frame.className = "lsh";
    frame.dataset.game = o.game || "";
    frame.innerHTML = `
      <div class="lsh-strip" data-area="strip" aria-hidden="true">
        <span class="lsh-strip__item" data-k="net"></span><span class="lsh-strip__item" data-k="time"></span><span class="lsh-strip__item" data-k="clock"></span>
        <span class="lsh-host" data-host aria-hidden="true"></span>
      </div>
      <button type="button" class="lsh-panic" data-area="strip" data-ctl="panic" hidden><span>Pause play 24 h</span></button>
      <p class="lsh-rtp" data-rtp hidden></p>
      <div class="lsh-stage" data-area="stage"></div>
      <div class="lsh-rail" data-area="rail"${features.buy || features.ante ? "" : " hidden"}>
        <button type="button" id="buyFreeBtn" class="lsh-chip lsh-chip--buy" data-ctl="buy"${features.buy ? "" : " hidden"}><span class="lsh-chip__k">Buy</span><span class="lsh-chip__v">Feature</span></button>
        <button type="button" id="anteToggle" class="lsh-chip lsh-chip--ante" data-ctl="ante" role="switch" aria-checked="false"${features.ante ? "" : " hidden"}><span class="lsh-chip__k">Ante</span><span class="lsh-chip__v" data-ante-sub></span></button>
      </div>
      <div class="lsh-ticker" id="psTicker" data-area="tick" role="status" aria-live="polite"><span class="lsh-ticker__text" id="psTickerText"></span></div>
      <button type="button" id="psMenuBtn" class="lsh-btn" data-area="menu" data-ctl="menu" aria-label="Menu" aria-haspopup="dialog">${icon("menu")}</button>
      <button type="button" id="psInfoBtn" class="lsh-btn" data-area="info" data-ctl="info" aria-label="Game info" aria-haspopup="dialog">${icon("info")}</button>
      <div class="lsh-read" data-area="bal"><span class="lsh-read__k">Balance</span><strong class="lsh-read__v" id="footerBalance" data-v="balance">—</strong></div>
      <button type="button" id="betSheetBtn" class="lsh-read lsh-read--bet" data-area="bet" data-ctl="betSheet" aria-haspopup="dialog"><span class="lsh-read__k" data-k="bet">Bet</span><strong class="lsh-read__v" id="footerBet" data-v="bet">—</strong></button>
      <div class="lsh-read lsh-read--win" data-area="win"><span class="lsh-read__k" data-k="win">Win</span><strong class="lsh-read__v" id="footerWin" data-v="win">0.00</strong></div>
      <button type="button" id="autoplayBtn" class="lsh-btn" data-area="autop" data-ctl="auto" aria-label="Autoplay" aria-haspopup="dialog" aria-pressed="false">${icon("auto")}<span class="lsh-btn__count" data-auto-count></span></button>
      <button type="button" id="betDownBtn" class="lsh-btn lsh-btn--step" data-area="minus" data-ctl="minus" aria-label="Lower bet">${icon("minus")}</button>
      <button type="button" id="spinBtn" class="lsh-spin" data-area="spin" data-ctl="spin" data-mode="spin" aria-label="Spin">${SPIN_FACE}</button>
      <button type="button" id="betUpBtn" class="lsh-btn lsh-btn--step" data-area="plus" data-ctl="plus" aria-label="Raise bet">${icon("plus")}</button>
      <button type="button" id="turboBtn" class="lsh-btn" data-area="turbo" data-ctl="turbo" aria-label="Turbo" aria-pressed="false">${icon("turbo")}</button>`;
    const q = (sel) => frame.querySelector(sel);
    const ctl = (name) => q(`[data-ctl="${name}"]`);
    const el = {
      strip: q(".lsh-strip"), panic: q("[data-ctl=panic]"), rtp: q("[data-rtp]"), host: q("[data-host]"), stage: q(".lsh-stage"), rail: q(".lsh-rail"),
      ticker: q(".lsh-ticker"), tickerText: q(".lsh-ticker__text"),
      balance: q('[data-v="balance"]'), bet: q('[data-v="bet"]'), win: q('[data-v="win"]'), betK: q('[data-k="bet"]'), winK: q('[data-k="win"]'),
      menu: ctl("menu"), info: ctl("info"), auto: ctl("auto"), autoCount: q("[data-auto-count]"), minus: ctl("minus"), plus: ctl("plus"),
      spin: ctl("spin"), spinLabel: q(".lsh-spin__label"), turbo: ctl("turbo"), buy: ctl("buy"), ante: ctl("ante"), anteSub: q("[data-ante-sub]"), betSheet: ctl("betSheet")
    };
    (o.host || doc.body).appendChild(frame);
    if (o.stage) el.stage.appendChild(o.stage);

    // ── preferences (left-hand, reduced motion, battery saver, intro, speed) ──
    function reducedMotion() { return prefs.reducedMotion === null ? Boolean(osReduced?.matches) : prefs.reducedMotion; }
    function applyPrefs() {
      frame.dataset.hand = prefs.leftHand ? "left" : "right";
      doc.documentElement.classList.toggle("lsh-reduced", reducedMotion());
      doc.documentElement.classList.toggle("lsh-battery", Boolean(prefs.batterySaver));
    }
    function setPref(k, v) {
      prefs[k] = v; store.save(prefs); applyPrefs(); syncSpeed();
      on.pref?.(k, v, api);
    }
    osReduced?.addEventListener?.("change", () => { applyPrefs(); on.pref?.("reducedMotion", reducedMotion(), api); });

    // ── market ──────────────────────────────────────────────────────────────
    let market = {};
    function rule(name, fallback) { const v = market[name]; return v === undefined || v === null ? fallback : v; }
    function hideInPlace(node, off) { if (!node) return; node.classList.toggle("is-off", Boolean(off)); node.toggleAttribute("aria-hidden", Boolean(off)); node.tabIndex = off ? -1 : 0; }
    function applyMarket(rules) {
      const r = Object.assign({}, rules || {});
      const fb = MARKET_FALLBACK[String(r.jurisdiction || "").toUpperCase()] || {};
      for (const [k, v] of Object.entries(fb)) if (r[k] === undefined || r[k] === null) r[k] = v;
      market = r;
      hideInPlace(el.auto, !features.autoplay || !rule("autoplay_enabled", true));
      hideInPlace(el.turbo, !features.turbo || !rule("turbo_enabled", true));
      if (!rule("turbo_enabled", true) && prefs.speed !== "normal") { prefs.speed = "normal"; syncSpeed(); }
      hideInPlace(el.buy, !features.buy || !rule("buy_feature_enabled", true));
      frame.dataset.session = rule("session_hud", "") || "";
      // DE (GlüStV §6i): the panic button. It asks the casino to lock play for 24 hours
      // (the casino applies it through its OASIS link); the game stops at once.
      el.panic.hidden = rule("session_hud", "") !== "panic";
      labels();
      syncSpeed();
      sessionStrip();
      return market;
    }
    // Session strip (market session_hud; UK RTS 14 / AGCO: net position and time played).
    // The shell keeps it itself: net = the balance now minus the first balance it was shown;
    // time from the mount; a text swap once a minute (no animation frames).
    const session = { start: null, last: null, t0: Date.now(), timer: 0 };
    function sessionStrip() {
      clearTimeout(session.timer);
      const mode = rule("session_hud", "none");
      const show = { net_time: ["net", "time"], session: ["net", "time"], clock_elapsed: ["time", "clock"], balance: [] }[mode] || [];
      for (const k of ["net", "time", "clock"]) {
        const n = el.strip.querySelector(`[data-k="${k}"]`);
        if (!show.includes(k)) { setText(n, ""); continue; }
        if (k === "net" && session.start !== null) { const net = session.last - session.start; setText(n, `Net ${net >= 0 ? "+" : "−"}${money(Math.abs(net))}${currency ? ` ${currency}` : ""}`); }
        if (k === "time") { const m = Math.floor((Date.now() - session.t0) / 60000); setText(n, `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} played`); }
        if (k === "clock") setText(n, new Date().toTimeString().slice(0, 5));
      }
      if (show.length) session.timer = setTimeout(sessionStrip, 60000 - ((Date.now() - session.t0) % 60000));
    }
    function trackBalance(v) {
      if (v === null || v === undefined || v === "") return;
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      if (session.start === null) session.start = n;
      session.last = n;
      if (rule("session_hud", "none") !== "none") sessionStrip();
    }

    /** Win effects allowed for this round? `roundWin` after every tumble/multiplier; `stake` = the cycle stake (bet + ante, or the buy price). */
    function celebrates(roundWin, stake) {
      const w = Number(roundWin) || 0;
      if (!(w > 0)) return false;
      return rule("celebrate_threshold", "any") === "gt_stake" ? w > (Number(stake) || 0) + 1e-9 : true;
    }
    const slamAllowed = () => features.stop && rule("slam_stop_enabled", rule("turbo_enabled", true));
    // Anticipation (one more and the feature starts) is never cut short where the market
    // says so (LuminaMotion.GRAMMAR.anticipation.notSkippableIn: UKGC, ON).
    const anticipationSkippable = () => slamAllowed() && !(root.LuminaMotion?.GRAMMAR.anticipation.notSkippableIn || []).includes(String(rule("jurisdiction", "")).toUpperCase());
    const turboAllowed = () => features.turbo && rule("turbo_enabled", true);
    const autoplayCap = () => (rule("autoplay_enabled", true) ? rule("max_autoplay_spins", null) : 0);

    // ── speed (normal / quick / turbo) ─────────────────────────────────────
    function speed() { return turboAllowed() ? prefs.speed || "normal" : "normal"; }
    function syncSpeed() {
      const s = speed();
      el.turbo.setAttribute("aria-pressed", String(s !== "normal"));
      el.turbo.dataset.speed = s;
      el.turbo.setAttribute("aria-label", s === "normal" ? "Speed: normal" : s === "quick" ? "Speed: quick" : "Speed: turbo");
    }

    // ── readouts ────────────────────────────────────────────────────────────
    const money = (v) => (Number.isFinite(Number(v)) && v !== null ? o.fmt(Number(v)) : "—");
    function setText(node, text) { if (node.textContent !== text) node.textContent = text; }
    let currency = o.currency || "";
    function labels() {
      const c = currency ? ` · ${currency}` : "";
      setText(q(".lsh-read__k"), `Balance${c}`);
      // DE (GlüStV §22a(3)): the return to player shown at the stake: beside the bet
      // buttons in portrait (in the autoplay slot, which that market leaves empty), on the
      // Bet readout in landscape. Elsewhere nothing.
      const show = rule("rtp_display", "") === "stake_area" && Number.isFinite(rtpPct);
      el.rtp.hidden = !show;
      if (show) el.rtp.innerHTML = `<span>RTP</span> ${esc(rtpPct.toFixed(2))}%`;
      frame.classList.toggle("has-rtp-slot", show && el.auto.classList.contains("is-off"));
    }
    let rtpPct = null;
    const betLabel = () => "Bet";

    // ── ticker (generalised from Vault 20K's #psTicker) ─────────────────────
    const TICK = { rotateMs: 4500, flashMinMs: 900 };
    const ticker = (() => {
      let mode = "idle", line = "", tips = [], idx = 0, rotate = 0, flashT = 0, flashing = false;
      const paint = (text, kind) => { setText(el.tickerText, text); if (el.ticker.dataset.state !== kind) el.ticker.dataset.state = kind; };
      const show = () => { if (!flashing) paint(line, mode); };
      const stopRotate = () => { clearInterval(rotate); rotate = 0; };
      return {
        idle(list) {
          if (list) tips = list.filter(Boolean);
          mode = "idle"; idx = 0; line = tips[0] || ""; show(); stopRotate();
          if (tips.length > 1) rotate = setInterval(() => { if (doc.hidden || mode !== "idle") return; idx = (idx + 1) % tips.length; line = tips[idx]; show(); }, TICK.rotateMs);
        },
        spin(text) { stopRotate(); mode = "spin"; line = text; show(); },
        /** A win line. `celebrate` false (market no-celebrate, return ≤ stake) paints it neutral. */
        win(text, celebrate = true) { stopRotate(); mode = celebrate ? "win" : "neutral"; line = text; show(); },
        neutral(text) { stopRotate(); mode = "neutral"; line = text; show(); },
        say(text) { stopRotate(); mode = "say"; line = text; show(); },
        flash(text, tone = "info", ms = TICK.flashMinMs) {
          // A game that drives the message line itself (o.tickerFlash) takes the shell's notices.
          if (o.tickerFlash) { o.tickerFlash(text, tone, ms); return; }
          clearTimeout(flashT); flashing = true; paint(text, `flash-${tone}`); flashT = setTimeout(() => { flashing = false; show(); }, Math.max(TICK.flashMinMs, ms)); },
        get mode() { return mode; },
        get text() { return el.tickerText.textContent; }
      };
    })();

    // ── controls state ──────────────────────────────────────────────────────
    const S = { phase: "ready", spinMode: "spin", autoLeft: 0, betIndex: 0, bets: [], betLocked: false, featureHud: null, waiting: 0, waitTimers: [] };
    function setPhase(phase) {
      // ready | flight | result | tumble | feature | autoplay | wait | broke | blocked
      S.phase = phase;
      frame.dataset.phase = phase;
      const busy = phase !== "ready" && phase !== "broke";
      el.minus.disabled = busy || S.betLocked || S.betIndex <= 0;
      el.plus.disabled = busy || S.betLocked || S.betIndex >= S.bets.length - 1;
      el.betSheet.disabled = busy || S.betLocked;
      el.buy.disabled = busy;
      el.ante.disabled = busy || S.betLocked;
      el.menu.disabled = phase === "flight" || phase === "tumble" || phase === "wait";
      el.info.disabled = el.menu.disabled;
      el.auto.disabled = busy && phase !== "autoplay";
      el.spin.classList.toggle("is-broke", phase === "broke");
    }
    /** spin | stop | skip | pick | wait (+ optional short label, e.g. "PICK") */
    function setSpinMode(mode, label = "") {
      S.spinMode = mode;
      el.spin.dataset.mode = mode;
      setText(el.spinLabel, label);
      const aria = { spin: "Spin", stop: "Stop autoplay", skip: "Skip", pick: label ? `${label}` : "Choose", wait: "Waiting for the server" }[mode] || "Spin";
      el.spin.setAttribute("aria-label", aria);
    }
    function setBets(list, index) {
      S.bets = list.slice();
      S.betIndex = Math.max(0, Math.min(S.bets.length - 1, index));
      setPhase(S.phase);
    }
    function setBetLocked(locked) { S.betLocked = Boolean(locked); setPhase(S.phase); }

    // Connection state: a ring on the button after 1 s, a ticker line after 3 s.
    function waiting(on1) {
      S.waitTimers.forEach(clearTimeout); S.waitTimers = [];
      el.spin.classList.remove("is-waiting");
      if (!on1) return;
      const M = root.LuminaMotion;
      const ring = M ? M.ms("waitRing") : 1000, msg = M ? M.ms("waitMessage") : 3000;
      S.waitTimers.push(setTimeout(() => el.spin.classList.add("is-waiting"), ring));
      S.waitTimers.push(setTimeout(() => ticker.flash("Waiting for the server…", "info", 60000), msg));
    }

    // ── free-spins HUD: replaces the bet stepper (bet frozen), never moves anything ──
    function featureHud(info) {
      S.featureHud = info || null;
      frame.classList.toggle("is-feature", Boolean(info));
      if (!info) { setText(el.betK, betLabel()); setText(el.winK, "Win"); setBetLocked(false); return; }
      setBetLocked(true);
      setText(el.betK, info.label || "Free spins");
      setText(el.bet, String(info.left ?? ""));
      setText(el.winK, info.winLabel || "Feature win");
      if (info.win !== undefined) setText(el.win, money(info.win));
    }

    // ── sheets (VxNotify modals) ────────────────────────────────────────────
    const N = root.VxNotify;
    function sheet(name, title, { closeLabel = "Close", blocking = false } = {}) {
      const s = doc.createElement("section");
      s.className = "lsh-sheet hidden";
      s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true"); s.setAttribute("aria-label", title);
      s.innerHTML = `<div class="lsh-sheet__panel"><header class="lsh-sheet__head"><h2 class="lsh-sheet__title" data-vx-slot="title">${esc(title)}</h2>${blocking ? "" : `<button type="button" class="lsh-btn lsh-sheet__x" data-vx-close="close" aria-label="${esc(closeLabel)}">${icon("close")}</button>`}</header><div class="lsh-sheet__body" data-vx-slot="body"></div></div>`;
      doc.body.appendChild(s);
      N?.register(name, s, { kind: "modal", visibility: "class", dismiss: blocking ? {} : { backdrop: "close", escape: "close" } });
      return { root: s, body: s.querySelector(".lsh-sheet__body"), title: s.querySelector(".lsh-sheet__title") };
    }
    const sheets = {
      menu: sheet("lsh-menu", "Menu"),
      info: sheet("lsh-info", "Game info"),
      auto: sheet("lsh-auto", "Autoplay"),
      bet: sheet("lsh-bet", "Bet"),
      notice: sheet("lsh-notice", "Notice"),
      ask: sheet("lsh-ask", "Notice", { blocking: true })
    };
    const openSheet = (name) => (N ? N.open(`lsh-${name}`) : Promise.resolve("close"));
    const closeSheet = (name, reason = "close") => N?.get?.(`lsh-${name}`)?.close?.(reason);

    function toggleRow(id, label, checked, hint = "") {
      return `<label class="lsh-row"><span class="lsh-row__t">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ""}</span><input type="checkbox" role="switch" data-pref="${id}"${checked ? " checked" : ""}></label>`;
    }
    function renderMenu() {
      const Sd = root.Sound;
      const rows = [];
      rows.push(toggleRow("sound", "Sound", !(Sd?.isMuted?.() ?? false)));
      if (Sd?.isGroupMuted) {
        rows.push(toggleRow("music", "Music", !Sd.isGroupMuted("music")));
        rows.push(toggleRow("effects", "Sound effects", !Sd.isGroupMuted("effects")));
      }
      if (turboAllowed()) {
        const s = speed();
        rows.push(`<div class="lsh-row"><span class="lsh-row__t">Speed</span><span class="lsh-seg" role="radiogroup" aria-label="Speed">${["normal", "quick", "turbo"].map((v) => `<button type="button" role="radio" data-speed="${v}" aria-checked="${s === v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</span></div>`);
      }
      rows.push(toggleRow("intro", "Intro screen", prefs.intro));
      rows.push(toggleRow("leftHand", "Left-hand mode", prefs.leftHand));
      rows.push(toggleRow("reducedMotion", "Reduced motion", reducedMotion(), "Fewer effects; every result is still shown step by step"));
      rows.push(toggleRow("batterySaver", "Battery saver", prefs.batterySaver, "Caps the animation at 30 frames per second"));
      if (o.haptics?.supported) rows.push(toggleRow("haptics", "Vibration", o.haptics.on));
      if (doc.fullscreenEnabled) rows.push(`<div class="lsh-row"><span class="lsh-row__t">Full screen</span><button type="button" class="lsh-pill" data-act="fullscreen">${doc.fullscreenElement ? "Exit" : "Enter"}</button></div>`);
      if (o.historyUrl) rows.push(`<div class="lsh-row"><span class="lsh-row__t">Game history</span><a class="lsh-pill" href="${esc(o.historyUrl)}" target="_blank" rel="noopener">Open</a></div>`);
      sheets.menu.body.innerHTML = rows.join("");
    }
    sheets.menu.body.addEventListener("change", (e) => {
      const t = e.target.closest("[data-pref]"); if (!t) return;
      const v = t.checked, k = t.dataset.pref, Sd = root.Sound;
      if (k === "sound") { Sd?.unlock?.(); Sd?.setMuted?.(!v); syncSound(); }
      else if (k === "music") Sd?.setGroupMuted?.("music", !v);
      else if (k === "effects") Sd?.setGroupMuted?.("effects", !v);
      else if (k === "haptics") o.haptics?.set?.(v);
      else setPref(k, v);
      Sd?.play?.("toggle", { on: v });
    });
    sheets.menu.body.addEventListener("click", (e) => {
      const sp = e.target.closest("[data-speed]");
      if (sp) { setPref("speed", sp.dataset.speed); renderMenu(); return; }
      if (e.target.closest('[data-act="fullscreen"]')) {
        (doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen({ navigationUI: "hide" })).catch(() => {}).finally(renderMenu);
      }
    });

    // Info: the game writes its rules (generated from rules.json); the shell adds the
    // market line and the build footer so every game shows them the same way.
    function renderInfo() {
      const parts = [];
      if (typeof on.info === "function") parts.push(on.info(api) || "");
      const off = [];
      if (features.autoplay && !rule("autoplay_enabled", true)) off.push("autoplay");
      if (features.turbo && !turboAllowed()) off.push("quick spin and turbo");
      if (features.stop && !slamAllowed()) off.push("stopping the reels early");
      if (features.buy && !rule("buy_feature_enabled", true)) off.push("buying the feature");
      if (off.length) parts.push(`<p class="lsh-market">Not available in this jurisdiction: ${esc(off.join(", "))}.</p>`);
      parts.push(`<p class="lsh-controls"><b>Controls.</b> Spin starts a round. ${slamAllowed() ? "Pressing it again during a round shows the result sooner." : "Once the result is shown, a press skips the rest of the presentation."} The ± buttons and the Bet readout change the bet between rounds. Speed, sound and display options are in the Menu. Speed only changes how fast a round is shown, never its result.</p>`);
      parts.push(`<p class="lsh-controls">If the connection drops during a round, the round is completed on the server and shown when you return. A malfunction voids all pays and plays.</p>`);
      const b = o.build || {};
      parts.push(`<footer class="lsh-build">${esc([b.title, b.version && `v${b.version}`, b.engine && `engine ${b.engine}`, b.rulesHash && `rules ${String(b.rulesHash).slice(0, 12)}`].filter(Boolean).join(" · "))}</footer>`);
      sheets.info.body.innerHTML = parts.join("");
    }

    function renderAuto() {
      const cap = autoplayCap();
      const presets = [10, 25, 50, 100, Infinity].filter((n) => cap === null || n <= cap);
      sheets.auto.body.innerHTML = `
        <div class="lsh-presets">${presets.map((n) => `<button type="button" class="lsh-pill" data-auto="${n === Infinity ? "inf" : n}">${n === Infinity ? "∞" : n}</button>`).join("")}</div>
        <label class="lsh-row"><span class="lsh-row__t">Stop if loss reaches</span><select data-limit="loss"><option value="0">No limit</option><option value="10">10× bet</option><option value="25">25× bet</option><option value="50">50× bet</option><option value="100">100× bet</option></select></label>
        <label class="lsh-row"><span class="lsh-row__t">Stop on a single win of</span><select data-limit="win"><option value="0">No limit</option><option value="10">10× bet</option><option value="50">50× bet</option><option value="100">100× bet</option><option value="500">500× bet</option></select></label>
        <label class="lsh-row"><span class="lsh-row__t">Stop when a feature is won</span><input type="checkbox" role="switch" data-limit="feature"></label>`;
    }
    sheets.auto.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-auto]"); if (!b) return;
      const n = b.dataset.auto === "inf" ? Infinity : Number(b.dataset.auto);
      const g = (k) => sheets.auto.body.querySelector(`[data-limit="${k}"]`);
      const limits = { lossX: Number(g("loss").value), winX: Number(g("win").value), feature: g("feature").checked };
      closeSheet("auto", "start");
      on.autoplay?.(n, limits);
    });

    function renderBetSheet() {
      const cap = Number(rule("max_stake", 0)) || 0;
      const mult = Number(o.stakeMultiplier?.() || 1); // ante raises the cycle stake
      sheets.bet.body.innerHTML = `<div class="lsh-ladder">${S.bets.map((b, i) => {
        const over = cap > 0 && b * mult > cap + 1e-9;
        return `<button type="button" class="lsh-pill" data-bet="${i}" aria-pressed="${i === S.betIndex}"${over ? " disabled" : ""}>${esc(money(b))}</button>`;
      }).join("")}</div>${cap > 0 ? `<p class="lsh-market">Maximum stake per spin in this jurisdiction: ${esc(money(cap))}.</p>` : ""}`;
    }
    sheets.bet.body.addEventListener("click", (e) => {
      const b = e.target.closest("[data-bet]"); if (!b || b.disabled) return;
      closeSheet("bet", "pick");
      on.betIndex?.(Number(b.dataset.bet));
    });

    // ── feature panels (A6): the intro (the rules in one line, the spins) and the outro
    // (what the feature paid). Over the stage, never in the layout; a tap, Enter or Space
    // continues; in autoplay it continues by itself. Every game's panel looks like the game
    // (--lsh-* tokens) and reads the same way.
    const panelEl = doc.createElement("section");
    panelEl.className = "lsh-panel hidden";
    panelEl.setAttribute("role", "dialog"); panelEl.setAttribute("aria-modal", "true");
    panelEl.innerHTML = '<div class="lsh-sheet__panel lsh-panel__card"><p class="lsh-panel__kicker"></p><h2 class="lsh-panel__title"></h2><p class="lsh-panel__line"></p><dl class="lsh-panel__stats"></dl><p class="lsh-panel__total" hidden><span class="lsh-panel__tk"></span><strong class="lsh-panel__tv"></strong></p><p class="lsh-panel__cta"></p></div>';
    el.stage.appendChild(panelEl);
    N?.register("lsh-panel", panelEl, { kind: "modal", visibility: "class", dismiss: { backdrop: "continue", escape: "continue", enter: "continue", space: true } });
    const pq = (c) => panelEl.querySelector(c);
    /** { kicker, title, line, stats: [[label, value]], total, totalLabel, countX, auto } →
     *  resolves with "continue" (tap) or "auto". `countX` (× bet) sizes the total's count-up. */
    function panel(o = {}) {
      setText(pq(".lsh-panel__kicker"), o.kicker || "");
      setText(pq(".lsh-panel__title"), o.title || "");
      setText(pq(".lsh-panel__line"), o.line || "");
      pq(".lsh-panel__stats").innerHTML = (o.stats || []).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("");
      const tot = pq(".lsh-panel__total"), tv = pq(".lsh-panel__tv");
      tot.hidden = o.total === undefined;
      setText(pq(".lsh-panel__tk"), o.totalLabel || "Total");
      setText(pq(".lsh-panel__cta"), o.auto ? "" : (o.cta || "Tap to continue"));
      const M = root.LuminaMotion, sp = api.motionSpeed();
      const counts = o.count !== false && M && sp !== "reduced";
      const done = N ? N.open("lsh-panel") : Promise.resolve("continue");
      let raf = 0, timer = 0;
      if (o.total !== undefined) {
        // The count-up never passes the paid amount and lands on it exactly.
        const end = Number(o.total) || 0, ms = counts ? M.countUpMs(o.countX || 0, sp) : 0, t0 = performance.now();
        const step = (t) => { const k = ms ? Math.min(1, (t - t0) / ms) : 1; setText(tv, money(end * (1 - (1 - k) ** 3))); if (k < 1) raf = requestAnimationFrame(step); else setText(tv, money(end)); };
        setText(tv, money(ms ? 0 : end));
        if (ms) raf = requestAnimationFrame(step);
      }
      if (o.auto) timer = setTimeout(() => N?.get?.("lsh-panel")?.close?.("auto"), Number(o.auto) || (M ? M.ms("featureAutoContinue") : 3000));
      return done.then((r) => { cancelAnimationFrame(raf); clearTimeout(timer); if (o.total !== undefined) setText(tv, money(o.total)); return r; });
    }
    /** "+N" (more free spins) flies from the board into the spins readout, which bumps. */
    function flyPlus(text) {
      const M = root.LuminaMotion, sp = api.motionSpeed();
      const target = el.bet.closest("[data-area]") || el.bet;
      const a = el.stage.getBoundingClientRect(), b = target.getBoundingClientRect();
      const n = doc.createElement("span");
      n.className = "lsh-plus"; n.textContent = text; n.setAttribute("aria-hidden", "true");
      n.style.left = `${a.left + a.width / 2}px`; n.style.top = `${a.top + a.height / 2}px`;
      const wcs = getComputedStyle(el.win); // the game's win colour and number face, outside the frame
      n.style.color = wcs.color; n.style.fontFamily = wcs.fontFamily;
      doc.body.appendChild(n); // fixed to the viewport (the frame may contain its fixed children)
      const dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + a.height / 2);
      const ms = M ? M.ms("retrigger", sp) : 900;
      const anim = sp === "reduced"
        ? n.animate([{ opacity: 0, transform: `translate(${dx}px, ${dy}px)` }, { opacity: 1, transform: `translate(${dx}px, ${dy}px)` }, { opacity: 0, transform: `translate(${dx}px, ${dy}px)` }], { duration: ms })
        : n.animate([{ transform: "translate(-50%, -50%) scale(1.5)", opacity: 0 }, { transform: "translate(-50%, -50%) scale(1.3)", opacity: 1, offset: 0.25 }, { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(0.7)`, opacity: 1 }], { duration: ms, easing: "cubic-bezier(0.45, 0, 0.25, 1)" });
      return anim.finished.catch(() => {}).then(() => { n.remove(); if (sp !== "reduced") target.animate([{ transform: "scale(1.14)" }, { transform: "none" }], { duration: 220 }); });
    }

    /** A short explanation over the top of the board (the first time something happens):
     *  no tap needed, read aloud, gone after `ms`. Never covers the controls. */
    const calloutEl = doc.createElement("p");
    calloutEl.className = "lsh-sheet__panel lsh-callout"; calloutEl.hidden = true; calloutEl.setAttribute("role", "status");
    el.stage.appendChild(calloutEl);
    let calloutT = 0;
    function callout(text, ms = 3200) {
      clearTimeout(calloutT);
      setText(calloutEl, text); calloutEl.hidden = false;
      calloutT = setTimeout(() => { calloutEl.hidden = true; }, ms);
    }

    /** A plain notice (insufficient balance, errors). Resolves when closed. */
    function notice(title, html) {
      setText(sheets.notice.title, title);
      sheets.notice.body.innerHTML = html;
      return openSheet("notice");
    }

    /** A blocking question (reality check): no close button, no backdrop or Escape.
     *  `choices`: [{ reason, label, primary }]. Resolves with the chosen reason. */
    function ask(title, html, choices) {
      setText(sheets.ask.title, title);
      sheets.ask.body.innerHTML = `${html}<div class="lsh-actions">${choices.map((c, i) => `<button type="button" class="lsh-pill${c.primary ? " lsh-pill--primary" : ""}" data-vx-close="${esc(c.reason)}"${c.primary || i === 0 ? " data-vx-autofocus" : ""}>${esc(c.label)}</button>`).join("")}</div>`;
      return openSheet("ask");
    }

    // ── input ──────────────────────────────────────────────────────────────
    // Release-then-press: a spin starts on pointerdown, and only once the previous press
    // was released (no held or queued presses, RTS 14D / SIFS). Keyboard: Space/Enter.
    let pressed = false;
    // While a feature panel is up, Spin is "continue" (never a round of its own).
    const spinPress = (source) => { if (!panelEl.classList.contains("hidden")) { N?.get?.("lsh-panel")?.close?.("continue"); return; } on.spin?.({ source }); };
    el.spin.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || pressed) return;
      pressed = true; e.preventDefault();
      spinPress("pointer");
    });
    const release = () => { pressed = false; };
    addEventListener("pointerup", release, true);
    addEventListener("pointercancel", release, true);
    addEventListener("blur", release);
    doc.addEventListener("visibilitychange", release);
    el.spin.addEventListener("keydown", (e) => { if ((e.key === " " || e.key === "Enter") && !e.repeat) { e.preventDefault(); spinPress("key"); } });
    doc.addEventListener("keydown", (e) => {
      if (e.code !== "Space" || e.repeat) return;
      if (e.target !== doc.body && !frame.contains(e.target)) return;
      if (e.target.closest?.("button, input, select, a") && e.target !== el.spin) return;
      e.preventDefault(); spinPress("space");
    });
    el.panic.addEventListener("click", async () => {
      const r = await ask("Pause play for 24 hours?", "<p>Your casino will lock play for 24 hours. The game stops now; a round already on screen finishes first.</p>", [{ label: "Pause 24 h", reason: "panic", primary: true }, { label: "Cancel", reason: "cancel" }]);
      if (r === "panic") on.panic?.();
    });
    el.minus.addEventListener("click", () => on.betStep?.(-1));
    el.plus.addEventListener("click", () => on.betStep?.(1));
    el.betSheet.addEventListener("click", () => { renderBetSheet(); openSheet("bet"); });
    el.turbo.addEventListener("click", () => {
      if (!turboAllowed()) return;
      const next = { normal: "quick", quick: "turbo", turbo: "normal" }[speed()];
      setPref("speed", next);
      root.Sound?.play?.("turbo_toggle", { on: next !== "normal" });
      ticker.flash(next === "normal" ? "Normal speed" : next === "quick" ? "Quick spin on" : "Turbo on", "info", 1200);
    });
    el.auto.addEventListener("click", () => {
      if (S.autoLeft) { on.autoplayStop?.(); return; }
      renderAuto(); openSheet("auto");
    });
    el.menu.addEventListener("click", () => { renderMenu(); openSheet("menu"); });
    el.info.addEventListener("click", () => { renderInfo(); openSheet("info"); });
    el.buy.addEventListener("click", () => on.buy?.());
    el.ante.addEventListener("click", () => { const v = el.ante.getAttribute("aria-checked") !== "true"; on.ante?.(v); });

    // Sound state mirrored in the menu (the master mute lives in the sound engine).
    function syncSound() { frame.classList.toggle("is-muted", Boolean(root.Sound?.isMuted?.())); }
    root.Sound?.onChange?.(syncSound);

    applyPrefs(); syncSpeed(); syncSound(); setPhase("ready"); labels();

    const api = {
      frame, el, ticker, prefs,
      get phase() { return S.phase; },
      setPhase, setSpinMode, setBets, setBetLocked, featureHud, waiting, notice, ask, panel, flyPlus, callout,
      applyMarket, celebrates, slamAllowed, anticipationSkippable, turboAllowed, autoplayCap, rule,
      speed, reducedMotion,
      /** The motion speed key for LuminaMotion: "reduced" wins, then the player's speed. */
      motionSpeed() { return reducedMotion() ? "reduced" : speed(); },
      setCurrency(c) { currency = c || ""; labels(); },
      /** The active profile's theoretical RTP in % (shown at the stake where the market says so). */
      setRtp(pct) { rtpPct = Number.isFinite(Number(pct)) ? Number(pct) : null; labels(); },
      /** The game changed the speed itself (Vault 20K: hold Spin for turbo autoplay). */
      setSpeed(s) { if (!turboAllowed() || prefs.speed === s) return; prefs.speed = s; store.save(prefs); syncSpeed(); },
      setBalance(v) { setText(el.balance, money(v)); trackBalance(v); },
      /** A game that writes the Balance readout itself reports the value here (session strip). */
      trackBalance,
      setBet(v) { if (!S.featureHud) setText(el.bet, money(v)); },
      setWin(v) { setText(el.win, money(v)); },
      setFeatureWin(v) { if (S.featureHud) setText(el.win, money(v)); },
      setAnte(onOff, sub) { el.ante.setAttribute("aria-checked", String(Boolean(onOff))); if (sub !== undefined) setText(el.anteSub, sub); },
      setAutoplay(left) {
        S.autoLeft = left || 0;
        el.auto.setAttribute("aria-pressed", String(Boolean(left)));
        setText(el.autoCount, left ? (left === Infinity ? "∞" : String(left)) : "");
        el.auto.setAttribute("aria-label", left ? "Stop autoplay" : "Autoplay");
      },
      setSession({ net, elapsedMs, clock } = {}) {
        const set = (k, t) => setText(el.strip.querySelector(`[data-k="${k}"]`), t || "");
        if (net !== undefined) set("net", `Net ${net >= 0 ? "+" : "−"}${money(Math.abs(net))}${currency ? ` ${currency}` : ""}`);
        if (elapsedMs !== undefined) { const m = Math.floor(elapsedMs / 60000); set("time", `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")} played`); }
        if (clock) set("clock", new Date().toTimeString().slice(0, 5));
      },
      openMenu() { renderMenu(); return openSheet("menu"); },
      openInfo() { renderInfo(); return openSheet("info"); },
      closeSheets() { for (const n of Object.keys(sheets)) closeSheet(n); }
    };
    return api;
  }

  root.LuminaShell = Object.freeze({ mount, MARKET_FALLBACK });
})(typeof window !== "undefined" ? window : globalThis);
