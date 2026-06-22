(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Banana X — living ambiance layer (Gates-of-Olympus-style "fun").
  //
  // Pure DOM/CSS so it overlays the canvas reels without touching the renderer:
  //   • fx-backdrop  — drifting nebula + starfield + floating gems (parallax).
  //   • mascot       — a glowing deity "idol" built from the crown art that
  //                    idles (breathes/floats) and reacts to game events.
  //   • fx-overlay   — transient spectacle: lightning bolts, god-rays, and a
  //                    coin/gem shower on big wins.
  //
  // Hybrid art seam: drop a character image at MASCOT_IMG and it replaces the
  // CSS idol with no other change.
  //
  // API: Ambiance.init(); Ambiance.react(type, opts)
  //   type: "spin" | "multiplier" {value} | "win" {tier,amount} | "bonus" | "idle"
  // ---------------------------------------------------------------------------

  const doc = root.document;
  if (!doc) return;

  // Optional real-character art. Leave null to use the CSS idol.
  const MASCOT_IMG = null; // e.g. "assets/mascot/zeus.png"
  const CROWN_IMG = "assets/symbols/TOP_CROWN-removebg-preview.png";

  const reduceMotion = root.matchMedia && root.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const state = { backdrop: null, mascot: null, overlay: null, stage: null, altar: null, vault: null, inited: false };

  const el = (cls, parent, tag = "div") => {
    const node = doc.createElement(tag);
    node.className = cls;
    if (parent) parent.appendChild(node);
    return node;
  };

  function buildBackdrop() {
    const bd = el("fx-backdrop");
    bd.setAttribute("aria-hidden", "true");
    el("fx-nebula fx-nebula-1", bd);
    el("fx-nebula fx-nebula-2", bd);
    el("fx-nebula fx-nebula-3", bd);
    el("fx-stars", bd);
    const floaters = el("fx-floaters", bd);
    if (!reduceMotion) {
      const gems = ["#9be7ff", "#ffd86f", "#ff7fa8", "#b58bff", "#77f1d0"];
      const count = root.innerWidth < 620 ? 9 : 16;
      for (let i = 0; i < count; i++) {
        const f = el("fx-floater", floaters);
        const size = 6 + Math.random() * 16;
        f.style.left = `${Math.random() * 100}%`;
        f.style.top = `${Math.random() * 100}%`;
        f.style.width = `${size}px`;
        f.style.height = `${size}px`;
        f.style.setProperty("--c", gems[i % gems.length]);
        f.style.setProperty("--dur", `${10 + Math.random() * 16}s`);
        f.style.setProperty("--delay", `${-Math.random() * 18}s`);
        f.style.setProperty("--drift", `${(Math.random() * 2 - 1) * 40}px`);
        f.style.opacity = String(0.25 + Math.random() * 0.4);
      }
    }
    doc.body.insertBefore(bd, doc.body.firstChild);
    state.backdrop = bd;
  }

  function buildStage() {
    // The ambiance layer sits INSIDE the game frame but UNDER the reel window
    // (the reels get a higher z-index in CSS), so nothing ever paints over the
    // play area. The mascot is then positioned in the margin/top band beside
    // the reels — outside them, but clearly in view.
    const altar = doc.querySelector(".altar");
    if (!altar) return;
    if (getComputedStyle(altar).position === "static") altar.style.position = "relative";
    state.altar = altar;
    state.vault = altar.querySelector(".vault-window");

    const stage = el("fx-stage", altar);
    stage.setAttribute("aria-hidden", "true");
    state.stage = stage;

    buildAltarDeco(stage);

    const overlay = el("fx-overlay", stage);
    state.overlay = overlay;

    const m = el("mascot", stage);
    el("mascot-rays", m);
    el("mascot-aura", m);
    const fig = el("mascot-figure", m);
    if (MASCOT_IMG) {
      const img = el("mascot-art", fig, "img");
      img.src = MASCOT_IMG;
      img.alt = "";
    } else {
      el("mascot-orb", fig);
      const crown = el("mascot-crown", fig, "img");
      crown.src = CROWN_IMG;
      crown.alt = "";
    }
    const orbit = el("mascot-orbit", m);
    el("orbit-gem orbit-gem-1", orbit);
    el("orbit-gem orbit-gem-2", orbit);
    el("orbit-gem orbit-gem-3", orbit);
    state.mascot = m;

    positionMascot();
  }

  // Fun decoration ON the altar frame itself — floating gem images + glowing
  // orbs that drift around the edges/margins (they sit behind the reel window,
  // so the play area stays clean). Gives the framed game area life.
  function buildAltarDeco(stage) {
    const deco = el("fx-deco", stage);
    if (reduceMotion) return;
    const gems = ["RED_GEM", "BLUE_DIAMOND", "YELLOW_HEX", "PURPLE_TRIANGLE", "GREEN_TRIANGLE", "CHALICE", "RING", "TOP_CROWN"];
    const orbColors = ["#9be7ff", "#ffd86f", "#ff7fa8", "#b58bff", "#77f1d0"];
    const n = root.innerWidth < 620 ? 8 : 14;
    for (let i = 0; i < n; i++) {
      const useImg = i % 3 !== 0; // ~2/3 gem images, 1/3 glowing orbs
      const node = el("fx-deco-item", deco, useImg ? "img" : "div");
      // Bias toward the frame edges (top/bottom bands or side columns) so the
      // decoration frames the reels rather than hiding behind them.
      let top, left;
      if (Math.random() < 0.5) {
        top = Math.random() < 0.5 ? Math.random() * 17 : 83 + Math.random() * 15;
        left = Math.random() * 100;
      } else {
        left = Math.random() < 0.5 ? Math.random() * 11 : 89 + Math.random() * 10;
        top = Math.random() * 100;
      }
      node.style.top = `${top}%`;
      node.style.left = `${left}%`;
      const size = 18 + Math.random() * 28;
      node.style.width = `${size}px`;
      node.style.height = `${size}px`;
      node.style.setProperty("--dur", `${12 + Math.random() * 14}s`);
      node.style.setProperty("--delay", `${-Math.random() * 16}s`);
      node.style.setProperty("--spin", `${Math.random() < 0.5 ? -1 : 1}`);
      if (useImg) {
        node.src = `assets/symbols/${gems[i % gems.length]}-removebg-preview.png`;
        node.alt = "";
        node.classList.add("fx-deco-gem");
      } else {
        node.classList.add("fx-deco-orb");
        node.style.setProperty("--c", orbColors[i % orbColors.length]);
      }
    }
  }

  // Place the mascot OUTSIDE the reel window: in the left/right margin when
  // there's room (desktop/admin), otherwise in the band just above the reels
  // (phones). Coordinates are relative to the .altar (which fx-stage fills).
  function positionMascot() {
    const m = state.mascot;
    const altar = state.altar;
    const vault = state.vault || (altar && altar.querySelector(".vault-window"));
    if (!m || !altar || !vault) return;
    const a = altar.getBoundingClientRect();
    const v = vault.getBoundingClientRect();
    const mW = m.offsetWidth || 96;
    const mH = m.offsetHeight || 120;
    const gap = 8;
    const rLeft = v.left - a.left;
    const rRight = v.right - a.left;
    const rTop = v.top - a.top;
    let left, top;
    if (rLeft >= mW + gap) {            // room in the left margin → beside reels
      left = rLeft - mW - gap;
      top = rTop + Math.min(40, v.height * 0.12);
    } else if (a.width - rRight >= mW + gap) { // room on the right
      left = rRight + gap;
      top = rTop + Math.min(40, v.height * 0.12);
    } else {                            // no side room (phones) → above the reels
      left = Math.max(2, rLeft + 2);
      top = Math.max(2, rTop - mH - gap);
    }
    m.style.left = `${Math.round(left)}px`;
    m.style.top = `${Math.round(top)}px`;
  }

  // --- reactions -------------------------------------------------------------
  function flashClass(node, cls, ms) {
    if (!node) return;
    node.classList.remove(cls);
    void node.offsetWidth; // restart animation
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), ms);
  }

  function castLightning(intensity = 1) {
    const ov = state.overlay;
    if (!ov || reduceMotion) return;
    const bolts = intensity >= 3 ? 3 : intensity >= 2 ? 2 : 1;
    for (let i = 0; i < bolts; i++) {
      const bolt = el(`fx-bolt fx-bolt-${1 + Math.floor(Math.random() * 3)}`, ov);
      bolt.style.setProperty("--x", `${10 + Math.random() * 80}%`);
      bolt.style.setProperty("--delay", `${i * 90}ms`);
      setTimeout(() => bolt.remove(), 700 + i * 90);
    }
    flashClass(ov, "fx-flash", intensity >= 3 ? 520 : 300);
  }

  function coinShower(amount = 24, palette = "gold") {
    const ov = state.overlay;
    if (!ov || reduceMotion) return;
    const n = Math.min(60, amount);
    for (let i = 0; i < n; i++) {
      const coin = el(`fx-coin fx-coin-${palette}`, ov);
      coin.style.left = `${Math.random() * 100}%`;
      coin.style.setProperty("--dur", `${1.1 + Math.random() * 1.3}s`);
      coin.style.setProperty("--delay", `${Math.random() * 0.6}s`);
      coin.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
      coin.style.setProperty("--sway", `${(Math.random() * 2 - 1) * 60}px`);
      coin.style.setProperty("--scale", String(0.7 + Math.random() * 0.8));
      setTimeout(() => coin.remove(), 2600);
    }
  }

  function godRays(ms = 1400) {
    flashClass(state.overlay, "fx-rays", ms);
  }

  function react(type, opts = {}) {
    if (!state.inited) return;
    positionMascot(); // keep it pinned beside the reels (layout may have shifted)
    const m = state.mascot;
    switch (type) {
      case "spin":
        flashClass(m, "is-charging", 600);
        break;
      case "multiplier": {
        const v = Number(opts.value) || 2;
        const intensity = v >= 250 ? 3 : v >= 50 ? 2 : 1;
        flashClass(m, "is-casting", 620);
        castLightning(intensity);
        if (v >= 250) godRays(900);
        break;
      }
      case "win": {
        const big = opts.tier === "blast-great" || opts.tier === "great" || opts.tier === "epic";
        if (big) {
          flashClass(m, "is-celebrating", 1600);
          godRays(1500);
          coinShower(opts.amountX >= 50 ? 48 : 30, "gold");
        }
        break;
      }
      case "bonus":
        flashClass(m, "is-celebrating", 1800);
        godRays(1600);
        coinShower(40, "violet");
        castLightning(2);
        break;
      default:
        break;
    }
  }

  // --- pointer interactivity (parallax + tap sparkle) ------------------------
  function installPointer() {
    if (reduceMotion) return;
    let raf = 0;
    let tx = 0, ty = 0;
    const onMove = (e) => {
      const w = root.innerWidth || 1;
      const h = root.innerHeight || 1;
      const px = (e.clientX / w) * 2 - 1; // -1..1
      const py = (e.clientY / h) * 2 - 1;
      tx = px; ty = py;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const apply = () => {
      raf = 0;
      if (state.backdrop) {
        state.backdrop.style.setProperty("--fx-px", tx.toFixed(3));
        state.backdrop.style.setProperty("--fx-py", ty.toFixed(3));
      }
      if (state.mascot) {
        state.mascot.style.setProperty("--fx-px", tx.toFixed(3));
        state.mascot.style.setProperty("--fx-py", ty.toFixed(3));
      }
    };
    root.addEventListener("pointermove", onMove, { passive: true });

    const onTap = (e) => {
      // Skip taps on actual controls — only sparkle on "empty" stage area.
      const t = e.target;
      if (t && t.closest && t.closest("button, select, input, a, .ritual-deck, .control-toolbar")) return;
      const spark = el("fx-spark", state.backdrop);
      spark.style.left = `${e.clientX}px`;
      spark.style.top = `${e.clientY}px`;
      setTimeout(() => spark.remove(), 700);
    };
    root.addEventListener("pointerdown", onTap, { passive: true });
  }

  function init() {
    if (state.inited) return;
    buildBackdrop();
    buildStage();
    installPointer();
    state.inited = true;
    // Re-place the mascot once layout settles and whenever the frame resizes.
    setTimeout(positionMascot, 60);
    setTimeout(positionMascot, 400);
    let rAF = 0;
    root.addEventListener("resize", () => {
      if (rAF) return;
      rAF = requestAnimationFrame(() => { rAF = 0; positionMascot(); });
    }, { passive: true });
  }

  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", init);
  else init();

  root.Ambiance = { init, react };
})(typeof window !== "undefined" ? window : globalThis);
