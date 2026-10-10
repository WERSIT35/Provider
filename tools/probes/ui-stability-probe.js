// UI stability outside the reel grid: does any notice, win message, multiplier
// display or popup MOVE the chrome (layout shift), and does every animation the
// stylesheet asks for actually play?
//
// Usage: node tools/probes/ui-stability-probe.js [--out <dir>] [--label <name>]
//          [--widths 320,360,390,768,1366] [--events normal,tumble,...] [--no-sheets]
//
// For each viewport it loads the real client (standalone engine, headless
// Chrome) and plays, in real time and through the game's own code paths:
//   normal win, tumble chain, multiplier landing, big win, autoplay, buy
//   confirm → free spins with a Total Multiplier, free-rounds notice, reality
//   check, ticker notices.
// Outcomes are picked by re-rolling the standalone engine and restoring its
// session between tries (probe-only; no engine code is touched). A bought
// bonus is cut to 3 free spins to keep the run short.
//
// Measured in the page, per event:
//   layout shift  PerformanceObserver('layout-shift') entries and the nodes that
//                 moved. "board" = .reels-stage / canvas; overlays (modals,
//                 big win, soul layer, feature screen, win combine) are listed
//                 apart since they sit outside the flow.
//   geometry      the layout box (offset chain: transforms excluded) of every
//                 element in the player shell, every frame. Any element whose
//                 box changes while both frames rendered it = moved/resized.
//   animations    every CSS rule that animates or transitions is checked:
//                   animation-not-started  matched a rendered element, no
//                                          animation ran within 2 frames
//                   toggled-within-frame   its state class was added and removed
//                                          before a frame was drawn
//                   class-on-hidden        state class added to a display:none
//                                          element (the animation cannot run)
//                   transition-skipped     the element was shown/inserted in the
//                                          same frame as its state change
//                   transition-jumped      a transitioned value changed with no
//                                          transition
//                   waapi-not-playing      element.animate() never ran
//                 plus a static audit of rules that animate layout properties.
// Writes <out>/<label>-report.json, <label>-report.md and one contact sheet per
// width (<label>-<width>.jpg). Exits 1 if any shift / move / animation issue.
// Needs Chrome and sharp (root devDependency).
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);
const REPO = path.join(__dirname, "..", "..");
const ROOT = path.join(REPO, "client");
const LABEL = opt("label", "run");
const OUT = path.resolve(opt("out", fs.mkdtempSync(path.join(os.tmpdir(), "vx-ui-"))));
const SHEETS = !flag("no-sheets");
const VIEWPORTS = { 320: [320, 568], 360: [360, 740], 390: [390, 844], 768: [768, 1024], 1366: [1366, 768] };
const WIDTHS = opt("widths", "320,360,390,768,1366").split(",").map(Number);
const ALL_EVENTS = ["normal", "tumble", "multiplier", "bigwin", "autoplay", "buy", "freerounds", "reality", "notice"];
const EVENTS = opt("events", ALL_EVENTS.join(",")).split(",");
const PORT = 3500 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".wav": "audio/wav", ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg" };
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  });
  return {
    ready: new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); }),
    send: (method, params = {}) => { const i = id++; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); },
    close: () => ws.close()
  };
}
async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text || "eval failed");
  return r.result.value;
}

// ── In-page instrumentation (installed before any page script) ──────────────
function INSTRUMENT() {
  const now = () => performance.now();
  const U = window.__ui = {
    shifts: [], starts: [], issues: [], moves: [], appear: [], waapi: [], muts: [],
    frame: 0, lastFrameT: 0, layoutRules: []
  };
  const ids = new WeakMap(); let nextId = 1;
  const idOf = (n) => { if (!ids.has(n)) ids.set(n, nextId++); return ids.get(n); };
  function desc(n) {
    if (n && n.nodeType === 3) n = n.parentElement;
    if (!n || !n.tagName) return "?";
    if (n.id) return `#${n.id}`;
    const cls = [...n.classList].filter((c) => !/^(is-|hidden$|vx-n|badge-bump|soul-hit)/.test(c)).slice(0, 2).join(".");
    const p = n.parentElement;
    const pd = !p ? "" : p.id ? `#${p.id}` : p.classList[0] ? `.${p.classList[0]}` : p.tagName.toLowerCase();
    return `${pd ? pd + " > " : ""}${n.tagName.toLowerCase()}${cls ? "." + cls : ""}`;
  }
  const OVERLAY = ".ps-modal, .confirm-modal, .big-win-overlay, .soul-layer, .feature-screen, .win-combine-overlay, #bootLoader, .autoplay-popover";
  function region(n) {
    if (n && n.nodeType === 3) n = n.parentElement;
    if (!n || !n.closest) return "other";
    if (n.closest(OVERLAY)) return "overlay";
    if (n.closest(".reels-stage")) return "board";
    return "ui";
  }
  U.desc = desc; U.region = region;
  const r4 = (r) => r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];

  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      U.shifts.push({ t: e.startTime, value: e.value, recent: e.hadRecentInput,
        sources: (e.sources || []).map((s) => ({ node: desc(s.node), region: region(s.node), prev: r4(s.previousRect), cur: r4(s.currentRect) })) });
    }
  }).observe({ type: "layout-shift", buffered: true });

  // Runtime: a transition or keyframe animation that moves a layout property.
  const LAYOUT_RE = /^(left|top|right|bottom|width|height|inset|margin|padding|font-size|letter-spacing|line-height|gap|min-|max-)/;
  U.kfProps = new Map();
  for (const type of ["animationstart", "transitionrun"]) {
    document.addEventListener(type, (e) => {
      const name = e.animationName || e.propertyName;
      U.starts.push({ t: now(), frame: U.frame, type, target: e.target, el: desc(e.target), name, pseudo: e.pseudoElement || "" });
      const lp = type === "transitionrun" ? (LAYOUT_RE.test(name) ? [name] : []) : (U.kfProps.get(name) || []).filter((p) => LAYOUT_RE.test(p));
      if (lp.length && region(e.target) !== "other") {
        U.issues.push({ t: now(), type: "layout-property-animated", el: desc(e.target) + (e.pseudoElement || ""), detail: `${type === "transitionrun" ? "transition" : "@" + name} animates ${lp.join(", ")}` });
      }
    }, true);
  }

  const origAnimate = Element.prototype.animate;
  Element.prototype.animate = function (kf, o) {
    const a = origAnimate.call(this, kf, o);
    const first = Array.isArray(kf) ? kf[0] || {} : kf || {};
    U.waapi.push({ t: now(), frame: U.frame, el: desc(this), a, props: Object.keys(first).filter((k) => k !== "offset" && k !== "easing"), checked: false });
    return a;
  };

  // CSS rules that animate / transition, and the state tokens in their selectors.
  const LAYOUT_PROPS = /^(left|top|right|bottom|width|height|inset|margin|padding|font-size|letter-spacing|line-height|gap|min-|max-)/;
  function collectRules() {
    const anim = []; const trans = []; const keyframes = new Map();
    const kwalk = (rules) => {
      for (const r of rules) {
        if (r instanceof CSSKeyframesRule) {
          const props = new Set();
          for (const k of r.cssRules) for (let i = 0; i < k.style.length; i++) props.add(k.style[i]);
          keyframes.set(r.name, [...props]);
        } else if (r.cssRules) kwalk(r.cssRules);
      }
    };
    for (const sh of document.styleSheets) { try { kwalk(sh.cssRules); } catch { /* cross-origin */ } }
    U.kfProps = keyframes;
    // Split a shorthand at top-level commas (not inside calc()/var()/cubic-bezier()).
    const splitTop = (v) => { const out = []; let depth = 0, cur = ""; for (const ch of v) { if (ch === "(") depth++; if (ch === ")") depth--; if (ch === "," && !depth) { out.push(cur.trim()); cur = ""; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
    const walk = (rules, media) => {
      for (const r of rules) {
        if (r instanceof CSSKeyframesRule) continue;
        if (r instanceof CSSMediaRule) walk(r.cssRules, r.media.mediaText);
        else if (r instanceof CSSSupportsRule) walk(r.cssRules, media);
        else if (r instanceof CSSStyleRule) {
          let names = (r.style.animationName || "").split(",").map((s) => s.trim()).filter((s) => s && s !== "none" && s !== "initial" && s !== "inherit");
          let tprops = (r.style.transitionProperty || "").split(",").map((s) => s.trim());
          let tdurs = (r.style.transitionDuration || "").split(",").map((s) => s.trim());
          // A shorthand with var() leaves its longhands empty in the CSSOM: read the raw value.
          const rawA = r.style.getPropertyValue("animation");
          if (!names.length && rawA) names = splitTop(rawA).map((part) => part.split(/s+/).find((tk) => keyframes.has(tk))).filter(Boolean);
          const rawT = r.style.getPropertyValue("transition");
          if (!r.style.transitionProperty && rawT) {
            const parts = splitTop(rawT);
            tprops = parts.map((part) => part.split(/s+/)[0]);
            tdurs = parts.map((part) => (/(^|s)0m?s(s|$)/.test(part) && !/calc|var/.test(part) ? "0s" : "1s"));
          }
          for (const sel of r.selectorText.split(",")) {
            const s = sel.trim();
            const pm = s.match(/::?(before|after)$/);
            const pseudo = pm ? `::${pm[1]}` : "";
            const base = pm ? s.slice(0, pm.index) : s;
            if (/:(hover|active|focus|focus-visible|has)\b/.test(base)) continue;
            const tokens = [...base.matchAll(/\.([\w-]+)/g)].map((m) => m[1])
              .concat([...base.matchAll(/\[([\w-]+)/g)].map((m) => `@${m[1]}`));
            for (const name of names) anim.push({ sel: s, base, pseudo, name, media, tokens });
            tprops.forEach((p, i) => {
              if (!p || p === "none") return;
              const dur = tdurs[i] ?? tdurs[tdurs.length - 1] ?? "0s";
              if (/^0m?s$/.test(dur)) return;
              const props = p === "all" ? ["opacity", "transform"] : [p];
              if (pseudo) return;
              for (const prop of props) trans.push({ sel: s, base, prop, media, tokens });
            });
            tprops.forEach((p) => { if (LAYOUT_PROPS.test(p)) U.layoutRules.push(`${s} { transition: ${p} }`); });
          }
        }
      }
    };
    for (const sh of document.styleSheets) { try { walk(sh.cssRules, ""); } catch { /* cross-origin */ } }
    for (const a of anim) {
      const lp = (keyframes.get(a.name) || []).filter((p) => LAYOUT_PROPS.test(p));
      if (lp.length) U.layoutRules.push(`${a.sel} { animation: ${a.name} } animates ${lp.join(", ")}`);
    }
    U.layoutRules = [...new Set(U.layoutRules)];
    return { anim, trans, tokens: new Set([...anim, ...trans].flatMap((r) => r.tokens)) };
  }

  const rendered = (n) => n.isConnected && n.getClientRects().length > 0;
  const mediaOk = (m) => !m || matchMedia(m).matches;
  function box(n) {
    if (!n.isConnected || !n.offsetParent && getComputedStyle(n).position !== "fixed") return null;
    let x = 0, y = 0, p = n;
    while (p) { x += p.offsetLeft; y += p.offsetTop; p = p.offsetParent; }
    return [x, y, n.offsetWidth, n.offsetHeight];
  }

  function start() {
    const R = collectRules();
    U.ruleCount = { anim: R.anim.length, trans: R.trans.length };
    // Mutations: no style flush here (it would change what the page renders).
    const addedAt = new WeakMap(); // el → Map(token → frame)
    const pendingAdds = []; // {el, token, frame}
    new MutationObserver((recs) => {
      for (const m of recs) {
        const n = m.target;
        if (m.type === "childList") {
          for (const a of m.addedNodes) if (a.nodeType === 1) pendingAdds.push({ el: a, token: "+inserted", frame: U.frame });
          continue;
        }
        if (m.attributeName === "class") {
          const before = new Set((m.oldValue || "").split(/\s+/).filter(Boolean));
          const after = new Set([...n.classList]);
          let map = addedAt.get(n); if (!map) addedAt.set(n, (map = new Map()));
          for (const c of after) if (!before.has(c)) { map.set(c, U.frame); if (R.tokens.has(c)) pendingAdds.push({ el: n, token: c, frame: U.frame }); }
          for (const c of before) if (!after.has(c) && map.get(c) === U.frame && R.tokens.has(c)) {
            U.issues.push({ t: now(), type: "toggled-within-frame", el: desc(n), detail: `.${c} added and removed before a frame was drawn` });
          }
        } else {
          const tok = `@${m.attributeName}`;
          if (R.tokens.has(tok) || m.attributeName === "hidden") pendingAdds.push({ el: n, token: tok, frame: U.frame });
        }
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeOldValue: true,
      attributeFilter: ["class", "hidden", "data-vx-state", "data-state", "data-tier", "aria-hidden", "style"] });

    let prevAnimKeys = new Set();
    const expects = [];
    const prevTrans = new WeakMap(); // el → {rendered, vals:{prop:val}}
    const prevBox = new WeakMap();
    let tracked = [];
    U.retrack = () => {
      tracked = [...document.querySelectorAll(".vault-shell *")].filter((n) => n instanceof HTMLElement && !n.closest(".hud-state, .admin-only"));
    };
    U.retrack();

    function sample() {
      U.frame += 1;
      const t = now();
      U.lastFrameT = t;
      // 1. Geometry of every shell element (layout box, transforms excluded).
      for (const n of tracked) {
        if (n.closest(OVERLAY)) continue;
        const b = rendered(n) ? box(n) : null;
        const p = prevBox.get(n);
        if (p !== undefined) {
          if (p && b && (Math.abs(p[0] - b[0]) >= 1 || Math.abs(p[1] - b[1]) >= 1 || Math.abs(p[2] - b[2]) >= 1 || Math.abs(p[3] - b[3]) >= 1)) {
            U.moves.push({ t, el: desc(n), region: region(n), from: p, to: b });
          } else if (!p !== !b) U.appear.push({ t, el: desc(n), region: region(n), shown: Boolean(b) });
        }
        prevBox.set(n, b);
      }
      // 2. CSS animations that should be running.
      const docAnims = document.getAnimations();
      const curKeys = new Set();
      for (const r of R.anim) {
        if (!mediaOk(r.media)) continue;
        let list; try { list = document.querySelectorAll(r.base); } catch { continue; }
        for (const n of list) {
          if (n.closest(".admin-only") || !rendered(n)) continue;
          const names = getComputedStyle(n, r.pseudo || null).animationName.split(",").map((s) => s.trim());
          if (!names.includes(r.name)) continue;
          const key = `${idOf(n)}${r.pseudo}|${r.name}`;
          curKeys.add(key);
          if (!prevAnimKeys.has(key)) expects.push({ key, n, pseudo: r.pseudo, name: r.name, sel: r.sel, frame: U.frame, t });
        }
      }
      prevAnimKeys = curKeys;
      for (let i = expects.length - 1; i >= 0; i--) {
        const x = expects[i];
        if (U.frame - x.frame < 2) continue;
        expects.splice(i, 1);
        const started = U.starts.some((s) => s.type === "animationstart" && s.target === x.n && s.name === x.name && s.pseudo === x.pseudo && s.t >= x.t - 40)
          || docAnims.some((a) => a.animationName === x.name && a.effect?.target === x.n && (a.effect.pseudoElement || "") === x.pseudo);
        if (!started) {
          const cs = x.n.isConnected ? getComputedStyle(x.n, x.pseudo || null) : null;
          const reason = !x.n.isConnected ? "removed before it ran"
            : !rendered(x.n) ? "hidden (display:none) before its first frame"
            : cs && /^0m?s$/.test(cs.animationDuration) ? "zero duration"
            : "no animation instance (state applied without a style pass, or overridden)";
          U.issues.push({ t: x.t, type: "animation-not-started", el: desc(x.n) + x.pseudo, detail: `${x.name} (${x.sel}): ${reason}` });
        }
      }
      // 3. Transitions: value jumps, and shown-in-the-same-frame state changes.
      const recentTok = new Map(); // el → Set(tokens added since last frame)
      for (const a of pendingAdds.splice(0)) {
        if (!recentTok.has(a.el)) recentTok.set(a.el, new Set());
        recentTok.get(a.el).add(a.token);
        // An animation-bearing class added to an unrendered element cannot run.
        if (a.token[0] !== "@" && a.token[0] !== "+" && a.el.isConnected && !rendered(a.el)
          && R.anim.some((r) => r.tokens.includes(a.token) && mediaOk(r.media) && safeMatches(a.el, r.base))) {
          U.issues.push({ t, type: "class-on-hidden", el: desc(a.el), detail: `.${a.token} added while the element is display:none` });
        }
      }
      const seen = new Set();
      for (const r of R.trans) {
        if (!mediaOk(r.media)) continue;
        let list; try { list = document.querySelectorAll(r.base); } catch { continue; }
        for (const n of list) {
          if (n.closest(".admin-only")) continue;
          const k = `${idOf(n)}|${r.prop}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const isR = rendered(n);
          const val = isR ? getComputedStyle(n).getPropertyValue(r.prop) : null;
          let prev = prevTrans.get(n); if (!prev) prevTrans.set(n, (prev = { rendered: null, vals: {}, ran: {} }));
          const had = prev.vals[r.prop];
          // Chrome names a shorthand's transition by its longhands (border-color → border-top-color).
          const sameProp = (tp) => tp === r.prop || (r.prop.includes("-") && tp.startsWith(r.prop.split("-")[0] + "-") && tp.endsWith("-" + r.prop.split("-").pop()));
          const running = () => n.getAnimations().some((a) => a instanceof CSSTransition && sameProp(a.transitionProperty));
          // A transition's last frame lands on the end value with nothing running: not a jump.
          const ranBefore = prev.ran[r.prop];
          if (isR && had != null && prev.rendered && val !== had && !running() && !ranBefore
            && !U.starts.some((s) => s.type === "transitionrun" && s.target === n && sameProp(s.name) && s.frame >= U.frame - 1)) {
            U.issues.push({ t, type: "transition-jumped", el: desc(n), detail: `${r.prop}: ${had} → ${val} with no transition (${r.sel})` });
          }
          const toks = recentTok.get(n) || recentTok.get(n.parentElement);
          if (isR && prev.rendered === false && toks && [...toks].some((tk) => r.tokens.includes(tk) || tk === "+inserted" || tk === "@hidden")) {
            const stateTok = [...toks].filter((tk) => r.tokens.includes(tk));
            if (stateTok.length && !running()) {
              U.issues.push({ t, type: "transition-skipped", el: desc(n), detail: `${r.prop}: shown and state ${stateTok.join(" ")} applied in the same frame (${r.sel})` });
            }
          }
          if (isR && prev.rendered == null && toks && toks.has("+inserted") && r.tokens.some((tk) => toks.has(tk)) && !running()) {
            U.issues.push({ t, type: "transition-skipped", el: desc(n), detail: `${r.prop}: inserted and put in its end state in the same frame (${r.sel})` });
          }
          prev.rendered = isR;
          prev.ran[r.prop] = isR && running();
          if (isR) prev.vals[r.prop] = getComputedStyle(n).getPropertyValue(r.prop);
        }
      }
      // 4. element.animate() calls.
      for (const w of U.waapi) {
        if (w.checked || U.frame - w.frame < 2) continue;
        w.checked = true;
        const ok = w.a.playState === "running" || (w.a.playState === "finished" && Number(w.a.currentTime) > 0);
        if (!ok) U.issues.push({ t: w.t, type: "waapi-not-playing", el: w.el, detail: `animate(${w.props.join(",")}) playState=${w.a.playState}` });
        const lp = w.props.filter((p) => LAYOUT_PROPS.test(p.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())));
        if (lp.length) U.issues.push({ t: w.t, type: "waapi-layout-prop", el: w.el, detail: `animate() on ${lp.join(",")}` });
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }
  function safeMatches(n, sel) { try { return n.matches(sel) || Boolean(n.querySelector(sel)); } catch { return false; } }

  U.window = (t0, t1) => ({
    shifts: U.shifts.filter((s) => s.t >= t0 && s.t <= t1).map(({ t, value, recent, sources }) => ({ t: t - t0, value, recent, sources })),
    moves: U.moves.filter((s) => s.t >= t0 && s.t <= t1).map((m) => ({ ...m, t: m.t - t0 })),
    appear: U.appear.filter((s) => s.t >= t0 && s.t <= t1).map((m) => ({ ...m, t: m.t - t0 })),
    issues: U.issues.filter((s) => s.t >= t0 && s.t <= t1).map((m) => ({ ...m, t: m.t - t0 })),
    played: [...new Set(U.starts.filter((s) => s.t >= t0 && s.t <= t1 && U.region(s.target) !== "other").map((s) => `${s.el}${s.pseudo} ${s.type === "animationstart" ? "@" : "~"}${s.name}`))],
    waapi: [...new Set(U.waapi.filter((w) => w.t >= t0 && w.t <= t1).map((w) => `${w.el} animate(${w.props.join(",")})`))]
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
}

// ── In-page driver: plays the events through the game's own code paths ──────
function DRIVER() {
  const D = window.__drv = { status: "idle", log: [], want: null };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const busy = () => isRoundInFlight() || state.bonusAutoplay || VxNotify.openNames().length > 0;
  D.waitIdle = async (timeout = 90000) => {
    const t = performance.now();
    while (performance.now() - t < timeout) {
      if (!busy()) { await sleep(400); if (!busy()) return true; }
      await sleep(100);
    }
    throw new Error("timed out waiting for idle");
  };
  // Feature screens and big wins close themselves after a while; speed them up.
  let featureSince = 0;
  setInterval(() => {
    if (VxNotify.isOpen("feature")) {
      featureSince ||= performance.now();
      if (performance.now() - featureSince > 1400) { featureSince = 0; dismissFeature(); }
    } else featureSince = 0;
    const bw = document.getElementById("bigWinOverlay");
    if (bw?.classList.contains("is-done")) { if (!bw.__doneAt) bw.__doneAt = performance.now(); else if (performance.now() - bw.__doneAt > 900) bw.click(); }
    else if (bw) bw.__doneAt = 0;
  }, 100);

  // Outcome picker: re-roll the standalone engine (restoring its session) until
  // the result fits what the event needs.
  const real = window.__realApi || api;
  window.__realApi = real;
  const bet = () => Number(el.betSelect.value || 1);
  const x = (r) => Number(r.total_win || 0) / bet();
  const noEvents = (r) => !(r.events || []).length && !Number(r.free_spins_awarded || 0);
  D.preds = {
    normal: (r) => noEvents(r) && r.total_win > 0 && Number(r.multiplier_applied || 1) <= 1 && (r.tumble_steps || []).length === 2 && x(r) < 5,
    tumble: (r) => noEvents(r) && r.total_win > 0 && Number(r.multiplier_applied || 1) <= 1 && (r.tumble_steps || []).length >= 4 && x(r) < 10,
    multiplier: (r) => noEvents(r) && r.total_win > 0 && Number(r.multiplier_applied || 1) > 1 && x(r) < 10,
    bigwin: (r) => noEvents(r) && x(r) >= 10 && x(r) < 25,
    quiet: (r) => noEvents(r) && x(r) < 5,
    freespin: (r) => !Number(r.free_spins_awarded || 0) && !(r.events || []).length && Number(r.multiplier_applied || 1) > 1 && r.total_win > 0 && x(r) < 10
  };
  api = async (p, payload) => {
    const eng = await getEngine();
    if (p === "/api/v1/buy-free-spins") {
      const r = await real(p, payload);
      if (Number(r.free_spins_awarded || 0) > 0) { eng.session.freeSpinsLeft = 3; r.free_spins_left = 3; }
      return r;
    }
    if (p !== "/api/v1/spin" || !D.want) return real(p, payload);
    const inBonus = eng.session.freeSpinsLeft > 0;
    const pred = inBonus ? D.preds.freespin : D.preds[D.want.pred];
    const snap = Object.fromEntries(Object.entries(eng.session).filter(([, v]) => v === null || typeof v !== "object"));
    let last = null;
    for (let i = 0; i < (inBonus ? 400 : 6000); i++) {
      Object.assign(eng.session, snap);
      const extra = !inBonus && D.want.force ? { force_multiplier_value: D.want.force } : {};
      last = await real(p, { ...payload, ...extra, spin_id: crypto.randomUUID() });
      if (pred(last)) return last;
    }
    D.log.push(`no ${inBonus ? "freespin" : D.want.pred} outcome found; used the last roll`);
    return last;
  };

  const click = (sel) => { const n = typeof sel === "string" ? document.querySelector(sel) : sel; n.click(); return n; };
  const waitFor = async (fn, ms = 20000) => { const t = performance.now(); while (!fn()) { if (performance.now() - t > ms) throw new Error("waitFor timeout"); await sleep(50); } };
  const spinOnce = async (pred, force) => {
    D.want = { pred, force };
    el.spinBtn.click();
    await waitFor(() => isRoundInFlight());
    await D.waitIdle();
    D.want = null;
  };
  D.events = {
    normal: () => spinOnce("normal"),
    tumble: () => spinOnce("tumble"),
    multiplier: () => spinOnce("multiplier", 3),
    bigwin: () => spinOnce("bigwin", 10),
    autoplay: async () => {
      D.want = { pred: "quiet" };
      click("#autoplayBtn");
      await sleep(500);
      click('#autoplayPopover button[data-autoplay="10"]');
      await waitFor(() => state.autoplayActive);
      await waitFor(() => state.autoplayLeft <= 7, 60000);
      click("#autoplayBtn"); // stop: the current spin finishes
      await D.waitIdle();
      D.want = null;
    },
    buy: async () => {
      D.want = { pred: "quiet" };
      click("#buyFreeBtn");
      await waitFor(() => VxNotify.isOpen("buyConfirm"));
      await sleep(1500);
      click("#buyConfirmBtn");
      await waitFor(() => state.bonusAutoplay, 30000);
      await D.waitIdle(120000);
      D.want = null;
    },
    freerounds: async () => {
      freeRoundsLoad([{ campaign_id: "probe", name: "Probe", bet_amount: bet(), spins_remaining: 5, valid_to: null }], 0);
      const done = freeRoundsUi.begin();
      await waitFor(() => VxNotify.isOpen("freeRounds"));
      await sleep(1500);
      click("#frPlayBtn");
      await done;
      await sleep(800);
      freeRounds.queue = [];
      freeRoundsUi.settle(); // releases the lock and flashes the total on the ticker
      await sleep(1500);
    },
    reality: async () => {
      const done = realityCheckPrompt({ elapsed_ms: 3725000, rounds: 1234, wagered: 98765.43, won: 87654.32, net: -11111.11 });
      await waitFor(() => VxNotify.isOpen("reality"));
      await sleep(1500);
      click("#realityContinue");
      await done;
      await sleep(600);
    },
    notice: async () => {
      pulseBanner("Multiplier locked: 100x", "bonus", 1200);
      await sleep(1600);
      VxNotify.banner("Feature bought", "win", 1200);
      await sleep(1600);
    }
  };
  D.start = (name) => {
    D.status = "running"; D.error = null;
    window.__ui.retrack();
    D.t0 = performance.now();
    D.events[name]().then(() => { D.status = "done"; }, (e) => { D.status = "done"; D.error = String(e && e.stack || e); })
      .finally(() => { D.t1 = performance.now(); });
    return D.t0;
  };
  return true;
}

// ── Contact sheet: one row per event ───────────────────────────────────────
async function writeSheet(rows, file, vw, vh) {
  const sharp = require("sharp");
  const th = vw < vh ? 300 : 210;
  const tw = Math.round((vw / vh) * th);
  const labelW = 120;
  const cols = Math.max(...rows.map((r) => r.frames.length), 1);
  const comps = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const svg = Buffer.from(`<svg width="${labelW}" height="${th}"><rect width="${labelW}" height="${th}" fill="#111"/><text x="8" y="24" fill="#fff" font-size="15" font-family="monospace">${r.name}</text><text x="8" y="46" fill="${r.bad ? "#ff6b6b" : "#7dd87d"}" font-size="13" font-family="monospace">${r.bad ? "ISSUES" : "ok"}</text></svg>`);
    comps.push({ input: svg, left: 0, top: i * th });
    for (let j = 0; j < r.frames.length; j++) {
      const f = r.frames[j];
      const img = await sharp(f.buf).resize({ width: tw, height: th, fit: "fill" }).toBuffer();
      const lab = Buffer.from(`<svg width="${tw}" height="18"><rect width="${tw}" height="18" fill="black" opacity="0.7"/><text x="4" y="13" fill="white" font-size="12" font-family="monospace">${Math.round(f.t)}ms</text></svg>`);
      comps.push({ input: await sharp(img).composite([{ input: lab, top: 0, left: 0 }]).toBuffer(), left: labelW + j * tw, top: i * th });
    }
  }
  await sharp({ create: { width: labelW + cols * tw, height: rows.length * th, channels: 3, background: "#000" } })
    .composite(comps).jpeg({ quality: 72 }).toFile(file);
}

async function runViewport(base, width) {
  const [vw, vh] = VIEWPORTS[width] || [width, Math.round(width * 1.8)];
  const target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(${INSTRUMENT.toString()})();` });
  const mobile = vw < 900;
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: vw, height: vh, deviceScaleFactor: 1, mobile });
  if (mobile) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?reset` });
  for (let i = 0; i < 200; i++) {
    await sleep(100);
    try { if (await evaluate(cdp, `document.body.classList.contains("app-ready") && typeof state !== "undefined" && !!state.sessionId && !!state.rules`)) break; } catch { /* navigating */ }
  }
  await sleep(1500);
  await evaluate(cdp, `(${DRIVER.toString()})()`);
  const out = { width, viewport: [vw, vh], events: {}, layoutRules: await evaluate(cdp, "__ui.layoutRules"), rules: await evaluate(cdp, "__ui.ruleCount") };
  const rows = [];
  for (const name of EVENTS) {
    const shots = [];
    const t0 = await evaluate(cdp, `__drv.start(${JSON.stringify(name)})`);
    const began = Date.now();
    let next = 0;
    while (true) {
      const status = await evaluate(cdp, "__drv.status");
      if (status !== "running") break;
      if (Date.now() - began > 180000) throw new Error(`${name}: event did not finish`);
      if (SHEETS && Date.now() - began >= next) {
        const s = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
        shots.push({ t: Date.now() - began, buf: Buffer.from(s.data, "base64") });
        next += next < 3000 ? 450 : 1500;
      }
      await sleep(60);
    }
    const res = await evaluate(cdp, `(() => { const w = __ui.window(${t0} - 50, __drv.t1 + 600); w.error = __drv.error; w.log = __drv.log.splice(0); w.tier = document.body.className; w.dur = __drv.t1 - ${t0}; return w; })()`);
    await sleep(700); // the window above includes 600ms after the event
    out.events[name] = res;
    const cls = res.shifts.reduce((s, e) => s + e.value, 0);
    const bad = cls > 0 || res.moves.length > 0 || res.issues.length > 0 || res.error;
    if (SHEETS) {
      const s = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 60 });
      shots.push({ t: Date.now() - began, buf: Buffer.from(s.data, "base64") });
      const pick = shots.length <= 7 ? shots : Array.from({ length: 7 }, (_, i) => shots[Math.round((i * (shots.length - 1)) / 6)]);
      rows.push({ name, bad, frames: pick });
    }
    console.log(`  ${String(width).padStart(4)} ${name.padEnd(11)} CLS=${cls.toFixed(4)} moves=${res.moves.length} issues=${res.issues.length}${res.error ? " ERROR " + res.error.split("\n")[0] : ""}`);
  }
  if (SHEETS) await writeSheet(rows, path.join(OUT, `${LABEL}-${width}.jpg`), vw, vh);
  cdp.close();
  return out;
}

function summarize(results) {
  const lines = [`# UI stability probe: ${LABEL}`, ""];
  let failed = false;
  const byEl = new Map();
  const note = (key, ev, w, info) => {
    if (!byEl.has(key)) byEl.set(key, { events: new Set(), widths: new Set(), info: new Set() });
    const e = byEl.get(key); e.events.add(ev); e.widths.add(w); if (info) e.info.add(info);
  };
  for (const r of results) {
    lines.push(`## ${r.width}px (${r.viewport.join("x")})`, "", "| event | CLS ui | CLS board | CLS overlay | moved/resized | animation issues |", "|---|---|---|---|---|---|");
    for (const [name, e] of Object.entries(r.events)) {
      const cls = { ui: 0, board: 0, overlay: 0, other: 0 };
      for (const s of e.shifts) {
        const regions = new Set(s.sources.map((x) => x.region));
        const reg = regions.has("board") ? "board" : regions.has("ui") ? "ui" : regions.has("overlay") ? "overlay" : "other";
        cls[reg] += s.value;
        for (const src of s.sources) note(`shift ${src.region} ${src.node}`, name, r.width, `${(src.prev || []).join(",")} → ${(src.cur || []).join(",")}`);
      }
      const moved = [...new Set(e.moves.map((m) => m.el))];
      for (const m of e.moves) note(`move ${m.region} ${m.el}`, name, r.width, `[${m.from}] → [${m.to}]`);
      for (const i of e.issues) note(`${i.type} ${i.el}`, name, r.width, i.detail);
      if (cls.ui + cls.board + cls.overlay + cls.other > 0 || e.moves.length || e.issues.length || e.error) failed = true;
      lines.push(`| ${name} | ${cls.ui.toFixed(4)} | ${cls.board.toFixed(4)} | ${cls.overlay.toFixed(4)} | ${moved.join("<br>") || "—"} | ${[...new Set(e.issues.map((i) => `${i.type}: ${i.el}`))].join("<br>") || "—"} |`);
    }
    lines.push("");
  }
  lines.push("## By element", "");
  for (const [k, v] of [...byEl.entries()].sort()) {
    lines.push(`- **${k}** — events: ${[...v.events].join(", ")}; widths: ${[...v.widths].join(", ")}`);
    for (const i of [...v.info].slice(0, 4)) lines.push(`  - ${i}`);
  }
  lines.push("", "## Rules that animate layout properties (static audit)", "");
  for (const l of results[0]?.layoutRules || []) lines.push(`- \`${l}\``);
  lines.push("", "## Animations that ran (per event, first width)", "");
  const first = results[0];
  if (first) for (const [name, e] of Object.entries(first.events)) lines.push(`- **${name}**: ${[...e.played, ...e.waapi].join("; ") || "—"}`);
  return { md: lines.join("\n"), failed };
}

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vx-ui-prof-"));
  const chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--no-first-run", "--hide-scrollbars", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const base = await new Promise((resolve) => {
    let buf = "";
    chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
  });
  const results = [];
  try {
    for (const w of WIDTHS) results.push(await runViewport(base, w));
  } finally {
    chrome.kill(); server.close();
  }
  fs.writeFileSync(path.join(OUT, `${LABEL}-report.json`), JSON.stringify(results, null, 1));
  const { md, failed } = summarize(results);
  fs.writeFileSync(path.join(OUT, `${LABEL}-report.md`), md);
  console.log(`\nreport: ${path.join(OUT, `${LABEL}-report.md`)}`);
  console.log(failed ? "UI STABILITY PROBE: FAIL" : "PROBE: PASS");
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* in use */ } process.exit(failed ? 1 : 0); }, 400);
})().catch((e) => { console.error(e); process.exit(1); });
