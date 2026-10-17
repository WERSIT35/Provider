/*
 * Demo mode for the static demo site (tools/build-demo.mjs), never served by the RGS.
 *
 * One play-money balance for every game, kept in this browser (localStorage), that the
 * lobby can reset. Each game page loads this file first, with data-game="vault" or
 * data-game="classic":
 *
 *  - vault:   Vault 20K's local engine keeps its session in localStorage
 *             ("bananax.session.v1"). The shared balance is written into it before the
 *             game boots and read back when the page is left (pagehide), so the engine
 *             itself is untouched.
 *  - classic: Classic 5x3's client only talks to the RGS (/game/v1/*). Here those calls
 *             are answered in the page by the game's own engine (engine.js, the same file
 *             the RGS runs), with the shared balance as the wallet. Same request and
 *             response shapes, so game.js is unchanged.
 *
 * Play money only: nothing here moves real money, and the outcomes are made in the
 * browser, not by the server as on the real platform.
 */
(function () {
  "use strict";

  var START = 100000;
  var KEY = "lumina.demo.balance";
  var VAULT_KEY = "bananax.session.v1";
  var CLASSIC_KEY = "lumina.demo.classic";
  var script = document.currentScript;
  var game = script && script.dataset ? script.dataset.game : null;

  var cents = function (x) { return Math.round(x * 100) / 100; };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode: this page only */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* nothing stored */ } }
  };
  var memory = null; // fallback when storage is blocked
  function read() {
    var raw = store.get(KEY);
    var v = raw === null ? NaN : Number(raw);
    if (Number.isFinite(v)) return v;
    return memory === null ? START : memory;
  }
  function write(v) { memory = cents(v); store.set(KEY, String(memory)); }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }

  /** Put the shared balance into Vault 20K's stored session (made if there is none). */
  function vaultIn() {
    var s = null;
    try { s = JSON.parse(store.get(VAULT_KEY) || "null"); } catch (e) { s = null; }
    if (!s || !s.sessionId) {
      s = { sessionId: uuid(), playerId: "demo", currency: "GEL", locale: "en", freeSpinsLeft: 0, freeSpinPersistentMultiplier: 0, bonusRoundWin: 0, anteEnabled: false, crazyMode: false, createdAt: new Date().toISOString() };
    }
    s.balance = read();
    store.set(VAULT_KEY, JSON.stringify(s));
  }
  /** Vault 20K's balance after play back into the shared one. */
  function vaultOut() {
    try {
      var s = JSON.parse(store.get(VAULT_KEY) || "null");
      if (s && Number.isFinite(s.balance)) write(s.balance);
    } catch (e) { /* keep the shared value */ }
  }

  window.LuminaDemo = {
    START: START,
    balance: read,
    /** Back to the starting balance. A free-spins feature in progress keeps its spins. */
    reset: function () {
      write(START);
      var s = null;
      try { s = JSON.parse(store.get(VAULT_KEY) || "null"); } catch (e) { s = null; }
      if (s && s.sessionId) { s.balance = START; store.set(VAULT_KEY, JSON.stringify(s)); }
      return START;
    }
  };

  /** "Lobby" link, fixed in a corner: outside the game's layout, so nothing moves. */
  function backLink() {
    var a = document.createElement("a");
    a.href = "/";
    a.textContent = "← Lobby";
    a.setAttribute("aria-label", "Back to the demo lobby");
    a.className = "lumina-demo-back";
    var css = document.createElement("style");
    css.textContent =
      ".lumina-demo-back{position:fixed;z-index:2147483000;left:max(8px,env(safe-area-inset-left));top:max(8px,env(safe-area-inset-top));" +
      "padding:6px 12px;border-radius:999px;background:rgba(5,12,14,.72);color:#f2c14e;font:600 12px/1.2 system-ui,-apple-system,'Segoe UI',sans-serif;" +
      "letter-spacing:.04em;text-decoration:none;border:1px solid rgba(242,193,78,.35);-webkit-tap-highlight-color:transparent}" +
      ".lumina-demo-back:hover{color:#ffe7a3}.lumina-demo-back:focus-visible{outline:2px solid #f2c14e;outline-offset:2px}";
    document.head.appendChild(css);
    var add = function () { document.body.appendChild(a); };
    if (document.body) add(); else document.addEventListener("DOMContentLoaded", add);
  }

  if (game === "vault") {
    vaultIn();
    addEventListener("pagehide", vaultOut);
    document.addEventListener("visibilitychange", function () { if (document.visibilityState === "hidden") vaultOut(); });
    backLink();
  }

  if (game === "classic") {
    // game.js resumes a stored session when there is no launch token: point it at ours.
    try { sessionStorage.setItem("classic5x3.session", "demo"); } catch (e) { /* game.js shows its own message */ }
    var feature = function () { try { return JSON.parse(store.get(CLASSIC_KEY) || "null"); } catch (e) { return null; } };
    var ready = fetch("rules.json").then(function (r) { return r.json(); }).then(function (rules) {
      var engine = new window.SlotEngine.SpinEngine({ rules: rules });
      engine.initSession({ player_id: "demo", currency: "GEL", locale: "en", game_id: "classic-5x3", balance: read() });
      var f = feature();
      if (f && f.freeSpinsLeft > 0) { engine.session.freeSpinsLeft = f.freeSpinsLeft; engine.session.bonusRoundWin = f.bonusRoundWin || 0; }
      return engine;
    });
    var reply = function (status, body) { return new Response(JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } }); };
    var session = function (engine) {
      var f = feature();
      var inFeature = engine.session.freeSpinsLeft > 0;
      return {
        session_token: "demo", game: { code: "classic-5x3" }, currency: engine.session.currency,
        allowed_bets: engine.getAllowedBets(), balance: { amount: engine.session.balance, currency: engine.session.currency },
        free_spins_left: engine.session.freeSpinsLeft,
        resume: inFeature && f ? { bet_amount: f.bet, feature: { bonus_round_win: engine.session.bonusRoundWin } } : null,
        embed: { allowed_hosts: [] }
      };
    };
    var realFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      var url = new URL(typeof input === "string" ? input : input.url, location.href);
      if (url.origin !== location.origin || url.pathname.indexOf("/game/v1/") !== 0) return realFetch(input, init);
      var path = url.pathname.slice("/game/v1/".length);
      return ready.then(function (engine) {
        engine.session.balance = read(); // the lobby may have reset it meanwhile
        if (path === "session/init" || path === "session") return reply(200, session(engine));
        if (path === "reality-check/ack") return reply(200, { ok: true });
        if (path !== "spin") return reply(404, { error: { code: "NOT_FOUND", message: "not in the demo" } });
        var body = {};
        try { body = JSON.parse((init && init.body) || "{}"); } catch (e) { body = {}; }
        var f = feature();
        var free = engine.session.freeSpinsLeft > 0;
        var bet = free && f ? f.bet : Number(body.bet_amount);
        if (!free && engine.session.balance < bet) return reply(402, { error: { code: "INSUFFICIENT_FUNDS", message: "Not enough demo credit: reset it in the lobby" } });
        var r;
        try { r = engine.spin({ bet_amount: bet }); } catch (err) { return reply(422, { error: { code: String(err.message || "ROUND_FAILED") } }); }
        write(r.balance_after);
        if (r.free_spins_left > 0) store.set(CLASSIC_KEY, JSON.stringify({ freeSpinsLeft: r.free_spins_left, bonusRoundWin: r.bonus_round_win, bet: bet }));
        else store.del(CLASSIC_KEY);
        r.round_ref = "DEMO-" + String(r.spin_id).slice(0, 8);
        r.balance = { amount: r.balance_after, currency: engine.session.currency };
        return reply(200, r);
      });
    };
    backLink();
  }
})();
