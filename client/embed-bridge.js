// Casino ↔ game postMessage contract (protocol "vault20k.embed", v1).
//
// Lifecycle signals only. Money never moves over postMessage: debits and credits are
// server-to-server (RGS → casino wallet webhooks), and every balance the game sends
// here is informational. A casino must refresh its own wallet, never trust it.
//
// Envelope, both directions:  { protocol: "vault20k.embed", v: 1, type, data }
//
// Game → casino
//   ready           { game_code, currency, balance, resumed, in_feature, free_spins_left }
//   roundStarted    { trace_id, bet, ante, free_spin, free_round }   (trace_id: the round's W3C trace)
//   roundEnded      { round_ref, trace_id, bet, win, balance, free_spin, free_spins_left }
//   balanceChanged  { balance, currency }
//   featureState    { active, free_spins_left, bonus_win }
//   paused          { paused }       (answer to pause / resume)
//   muted           { muted }        (answer to setMuted, and when the player toggles sound)
//   state           { paused, muted, in_round, in_feature, balance, currency }  (answer to getState)
//   error           { code, message }
//   realityCheck    { session_started_at, elapsed_ms, rounds, wagered, won, net }  (the
//                   jurisdiction's reality check is on screen; play waits for the player)
//   exitRequested   { reason }       (the player chose to leave, e.g. "reality_check":
//                   close the game; it stays paused until then)
//
// Casino → game
//   hello                   handshake; needed only when the game cannot see the parent's
//                           origin itself (no ancestorOrigins and no Referer). Answered with ready.
//   pause / resume          pause holds the game between rounds (reality check, deposit
//                           modal): no new paid round starts, base autoplay stops, and a
//                           bonus waits before its next free spin. The round on screen finishes.
//   setMuted { muted }
//   getState
//
// Security: the game only ever talks to ONE origin, its direct parent, and only when
// that origin's host is in the operator's registered domains (the same list /play's
// CSP frame-ancestors enforces). Outgoing messages name that origin as targetOrigin
// (never "*"); incoming ones must come from window.parent AND that origin.
(function (root) {
  "use strict";

  const PROTOCOL = "vault20k.embed";
  const VERSION = 1;
  const COMMANDS = new Set(["hello", "pause", "resume", "setMuted", "getState"]);

  let allowed = null; // Set of "host[:port]"; null until connect()
  let parentOrigin = null;
  let readyData = null;
  const handlers = Object.create(null);

  const framed = (() => {
    try { return root.parent && root.parent !== root; } catch { return true; }
  })();

  function hostOf(origin) {
    try {
      const u = new URL(origin);
      if (u.protocol !== "https:" && u.protocol !== "http:") return null;
      return u.host.toLowerCase();
    } catch {
      return null;
    }
  }

  function isAllowedOrigin(origin) {
    const host = typeof origin === "string" ? hostOf(origin) : null;
    return Boolean(host && allowed && allowed.has(host));
  }

  /** The parent's origin as the browser reports it, without asking the parent. */
  function observedParentOrigin() {
    try {
      const ao = root.location.ancestorOrigins;
      if (ao && ao.length) return ao[0];
    } catch { /* not supported */ }
    try {
      if (root.document.referrer) return new URL(root.document.referrer).origin;
    } catch { /* no usable referrer */ }
    return null;
  }

  function post(type, data) {
    if (!parentOrigin) return false;
    try {
      root.parent.postMessage({ protocol: PROTOCOL, v: VERSION, type, data: data || {} }, parentOrigin);
      return true;
    } catch {
      return false;
    }
  }

  function onMessage(event) {
    if (!framed || event.source !== root.parent) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object" || msg.protocol !== PROTOCOL || msg.v !== VERSION) return;
    if (!COMMANDS.has(msg.type)) return;
    if (!parentOrigin) {
      // Handshake fallback: adopt the sender's origin only if it is registered.
      if (msg.type !== "hello" || !isAllowedOrigin(event.origin)) return;
      parentOrigin = event.origin;
    } else if (event.origin !== parentOrigin) {
      return;
    }
    if (msg.type === "hello") {
      if (readyData) post("ready", readyData);
      return;
    }
    const fn = handlers[msg.type];
    if (typeof fn === "function") {
      try { fn(msg.data && typeof msg.data === "object" ? msg.data : {}); } catch { /* a handler must never break the game */ }
    }
  }

  const EmbedBridge = {
    /** True once a parent origin has been verified and messages will be delivered. */
    get connected() { return Boolean(parentOrigin); },
    get parentOrigin() { return parentOrigin; },
    get framed() { return framed; },

    /**
     * Arm the bridge with the operator's registered hosts (session/init `embed.allowed_hosts`).
     * A no-op when the game is not framed or the list is empty.
     */
    connect(allowedHosts) {
      if (!framed || allowed) return EmbedBridge.connected;
      const list = Array.isArray(allowedHosts) ? allowedHosts.map((h) => String(h).toLowerCase()) : [];
      if (!list.length) return false;
      allowed = new Set(list);
      const observed = observedParentOrigin();
      if (observed && isAllowedOrigin(observed)) parentOrigin = observed;
      root.addEventListener("message", onMessage);
      return EmbedBridge.connected;
    },

    /** Announce the game is playable. Re-sent on a later `hello`. */
    ready(data) {
      readyData = data || {};
      return post("ready", readyData);
    },

    emit(type, data) {
      return post(type, data);
    },

    /** Register the handler for one casino command (pause, resume, setMuted, getState). */
    on(type, fn) {
      if (COMMANDS.has(type) && type !== "hello") handlers[type] = fn;
    },

    PROTOCOL,
    VERSION
  };

  root.EmbedBridge = EmbedBridge;
})(typeof window !== "undefined" ? window : globalThis);
