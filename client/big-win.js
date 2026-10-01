// Vault 20K — full-screen big-win celebration.
//
// A self-contained presentation controller. Given the settled win amount, the
// bet and the celebratable tiers, it counts up THROUGH each tier on its own DOM
// layer and particle canvas, then resolves when the player dismisses it (or the
// auto-dismiss fires). It owns no game state and never talks to SlotEngine: the
// amount it shows is the payload's total_win, already decided by the engine.
//
// Isolation (the bonus-round reflow lesson, see #25/#26/#27):
//   • #bigWinOverlay is position:fixed + contain:strict and is shown with
//     opacity/visibility only (never display), so opening it, the per-frame
//     amount text and the tier changes cannot reflow anything in the game.
//   • Particles draw on the overlay's OWN canvas. The reel canvas, its sprite
//     caches and its ResizeObserver never see any of this.
//   • Visual randomness is Math.random(). SlotEngine.RNG is never touched.
//
// Tier contract (WIN_TIERS rows with overlay:true, plus two fields):
//   { key, minX, label, countMs, fx }   fx ∈ "coins" | "sparks" | "motherlode"
//   countMs is how long the count takes to cross that tier's whole span.
(function () {
  "use strict";

  const INTRO_MS = 900;            // 0 → first threshold
  const BEAT_MS = 260;             // hold on each tier-up so the new label lands
  const DISMISS_GUARD_MS = 450;    // after a skip, ignore taps so the final figure is seen
  const FINISH_GUARD_MS = 150;     // after a natural finish, same idea, shorter
  const FADE_MS = 240;             // matches the CSS opacity transition
  const OPEN_TIER_MAX_STRETCH = 3; // cap on how long the top tier may count
  const GRAVITY = 1.9;             // viewport-heights per s²
  const DONE_EMIT_FACTOR = 0.35;   // particles keep trickling while waiting for the tap

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
  const easeOutCubic = (t) => 1 - (1 - t) ** 3;
  const prefersReducedMotion = () =>
    Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // ── Per-tier effects ─────────────────────────────────────────────────────
  // rate: particles per second while the tier is active. burst: fired once on
  // the tier-up, as [kind, count, pattern]. All counts scale with fxScale.
  const FX = {
    coins: {
      rate: { coin: 22 },
      burst: [["coin", 36, "fountain"]]
    },
    sparks: {
      rate: { coin: 26, spark: 60 },
      burst: [["spark", 70, "radial"], ["coin", 24, "cannons"]]
    },
    motherlode: {
      rate: { coin: 34, bar: 9, diamond: 12, spark: 40 },
      burst: [["coin", 50, "fountain"], ["bar", 14, "cannons"], ["diamond", 20, "cannons"], ["spark", 90, "radial"]]
    }
  };

  // ── Sprites ──────────────────────────────────────────────────────────────
  // Rasterized once per controller; particles only ever drawImage them.
  const SPRITE_PX = 96;

  function makeSprite(draw) {
    const c = document.createElement("canvas");
    c.width = c.height = SPRITE_PX;
    draw(c.getContext("2d"), SPRITE_PX);
    return c;
  }

  function buildSprites({ gold, goldBright, goldDeep, diamond, diamondEdge }) {
    const coin = makeSprite((g, s) => {
      const r = s / 2 - 3;
      const face = g.createRadialGradient(s * 0.38, s * 0.34, 2, s / 2, s / 2, r);
      face.addColorStop(0, goldBright);
      face.addColorStop(0.55, gold);
      face.addColorStop(1, goldDeep);
      g.fillStyle = face;
      g.beginPath();
      g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = s * 0.045;
      g.strokeStyle = goldDeep;
      g.beginPath();
      g.arc(s / 2, s / 2, r * 0.68, 0, Math.PI * 2);
      g.stroke();
    });

    const bar = makeSprite((g, s) => {
      // Gold ingot seen at a slight angle: trapezoid body + bright top face.
      const top = s * 0.3, bottom = s * 0.72, inset = s * 0.14;
      const body = g.createLinearGradient(0, top, 0, bottom);
      body.addColorStop(0, goldBright);
      body.addColorStop(0.45, gold);
      body.addColorStop(1, goldDeep);
      g.fillStyle = body;
      g.beginPath();
      g.moveTo(s * 0.08, bottom);
      g.lineTo(s * 0.92, bottom);
      g.lineTo(s - inset, top);
      g.lineTo(inset, top);
      g.closePath();
      g.fill();
      g.fillStyle = goldBright;
      g.fillRect(inset + s * 0.04, top, s - 2 * inset - s * 0.08, s * 0.06);
    });

    const gem = makeSprite((g, s) => {
      const cx = s / 2, cy = s / 2, rx = s * 0.36, ry = s * 0.46;
      const fill = g.createLinearGradient(cx - rx, cy - ry, cx + rx, cy + ry);
      fill.addColorStop(0, "#ffffff");
      fill.addColorStop(0.5, diamond);
      fill.addColorStop(1, diamondEdge);
      g.fillStyle = fill;
      g.beginPath();
      g.moveTo(cx, cy - ry);
      g.lineTo(cx + rx, cy);
      g.lineTo(cx, cy + ry);
      g.lineTo(cx - rx, cy);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(255, 255, 255, 0.7)";
      g.lineWidth = s * 0.02;
      g.beginPath();
      g.moveTo(cx - rx, cy);
      g.lineTo(cx + rx, cy);
      g.moveTo(cx, cy - ry);
      g.lineTo(cx, cy + ry);
      g.stroke();
    });

    return { coin, bar, diamond: gem };
  }

  // ── Particle field ───────────────────────────────────────────────────────
  // Fixed-size pool: no allocation per particle, so a long MOTHERLODE never
  // triggers GC pauses. When the pool is full, new particles are dropped.
  class ParticleField {
    constructor(canvas, { maxDpr, budget }) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.maxDpr = maxDpr;
      this.pool = Array.from({ length: budget }, () => ({ live: false }));
      this.live = 0;
      this.cursor = 0;
      this.w = 1;
      this.h = 1;
      this.dpr = 1;
      this.sprites = null;
      this.sparkColors = ["#ffffff"];
    }

    resize() {
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (this.canvas.width !== bw) this.canvas.width = bw;
      if (this.canvas.height !== bh) this.canvas.height = bh;
      this.w = w;
      this.h = h;
      this.dpr = dpr;
    }

    _spawn() {
      const n = this.pool.length;
      for (let k = 0; k < n; k++) {
        const i = (this.cursor + k) % n;
        if (!this.pool[i].live) {
          this.cursor = (i + 1) % n;
          this.live++;
          return this.pool[i];
        }
      }
      return null;
    }

    emit(kind, count, pattern) {
      const { w, h } = this;
      const g = (GRAVITY * h) / 1e6; // px per ms²
      const unit = clamp(Math.min(w, h) / 700, 0.7, 1.5);
      for (let n = 0; n < count; n++) {
        const p = this._spawn();
        if (!p) return;
        p.live = true;
        p.kind = kind;
        p.age = 0;
        p.rot = rand(0, Math.PI * 2);
        p.vr = rand(-0.004, 0.004);
        p.phase = rand(0, Math.PI * 2);
        p.spin = rand(0.006, 0.014);
        p.grav = kind === "spark" ? g * 0.25 : g;
        if (pattern === "radial") {
          const a = rand(0, Math.PI * 2);
          const sp = Math.min(w, h) * rand(0.0006, 0.0016);
          p.x = w / 2;
          p.y = h * 0.46;
          p.vx = Math.cos(a) * sp;
          p.vy = Math.sin(a) * sp;
        } else if (pattern === "cannons") {
          const right = Math.random() < 0.5;
          const ang = rand(0.35, 0.75) * (right ? -1 : 1); // radians from vertical, aimed inward
          const v = Math.sqrt(2 * g * h * rand(0.4, 0.8)) * rand(1, 1.25);
          p.x = right ? w + 24 : -24;
          p.y = h * rand(0.7, 0.95);
          p.vx = Math.sin(ang) * v;
          p.vy = -Math.cos(ang) * v;
        } else {
          // fountain: from bottom-centre, peaking between 55% and 95% of the height
          const ang = rand(-0.38, 0.38);
          const v = Math.sqrt(2 * g * h * rand(0.55, 0.95));
          p.x = w / 2 + rand(-0.06, 0.06) * w;
          p.y = h + 24;
          p.vx = Math.sin(ang) * v;
          p.vy = -Math.cos(ang) * v;
        }
        if (kind === "spark") {
          p.life = rand(420, 820);
          p.size = 2 * unit;
          p.color = pick(this.sparkColors);
        } else {
          p.life = 6000;
          p.size = unit * (kind === "bar" ? rand(30, 40) : kind === "diamond" ? rand(18, 28) : rand(20, 32));
        }
      }
    }

    step(dt) {
      if (!this.live) return;
      const floor = this.h + 60;
      for (const p of this.pool) {
        if (!p.live) continue;
        p.age += dt;
        p.vy += p.grav * dt;
        if (p.kind === "spark") {
          const drag = 1 - 0.0018 * dt;
          p.vx *= drag;
          p.vy *= drag;
        }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        p.phase += p.spin * dt;
        if (p.age >= p.life || (p.y > floor && p.vy > 0)) {
          p.live = false;
          this.live--;
        }
      }
    }

    draw() {
      const { ctx, dpr } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      if (!this.live || !this.sprites) return;

      // Solids. One setTransform per particle (rotation + coin flip folded in)
      // instead of save/translate/rotate/scale/restore.
      for (const p of this.pool) {
        if (!p.live || p.kind === "spark") continue;
        const sprite = this.sprites[p.kind];
        const flip = p.kind === "coin" ? Math.max(0.12, Math.abs(Math.cos(p.phase))) : 1;
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        ctx.globalAlpha = p.life - p.age < 400 ? Math.max(0, (p.life - p.age) / 400) : 1;
        ctx.setTransform(c * flip * dpr, s * flip * dpr, -s * dpr, c * dpr, p.x * dpr, p.y * dpr);
        ctx.drawImage(sprite, -p.size / 2, -p.size / 2, p.size, p.size);
      }

      // Sparks: additive streaks along their velocity.
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "lighter";
      ctx.lineCap = "round";
      for (const p of this.pool) {
        if (!p.live || p.kind !== "spark") continue;
        ctx.globalAlpha = 1 - p.age / p.life;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.size;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 22, p.y - p.vy * 22);
        ctx.stroke();
      }
      ctx.globalCompositeOperation = "source-over";
      ctx.globalAlpha = 1;
    }

    clear() {
      for (const p of this.pool) p.live = false;
      this.live = 0;
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  // ── Controller ───────────────────────────────────────────────────────────
  class BigWinController {
    /**
     * @param {object} o
     * @param {HTMLElement} o.root     the #bigWinOverlay element
     * @param {(v:number)=>string} o.format  amount formatter (main.js fmt)
     * @param {object} o.palette       { gold, goldBright, goldDeep, diamond, diamondEdge, sparks[] } as #rrggbb
     * @param {number} [o.maxDpr=2]    canvas resolution cap (pass the renderer's tier cap)
     * @param {number} [o.fxScale=1]   particle density (pass the renderer's fxCeil)
     * @param {object} [o.hooks]       onTier(tier, {skipped}), onTick(value, total), onComplete(), onDismiss()
     */
    constructor({ root, format, palette, maxDpr = 2, fxScale = 1, hooks = {} }) {
      this.root = root;
      this.format = format || ((v) => Number(v).toFixed(2));
      this.hooks = hooks;
      this.fxScale = clamp(fxScale, 0.2, 1);
      this.stage = root.querySelector("[data-bw-stage]");
      this.labelEl = root.querySelector("[data-bw-label]");
      this.amountEl = root.querySelector("[data-bw-amount]");
      this.announceEl = root.querySelector("[data-bw-announce]");
      this.field = new ParticleField(root.querySelector("[data-bw-canvas]"), {
        maxDpr,
        budget: Math.max(80, Math.round(420 * this.fxScale))
      });
      this.field.sprites = buildSprites(palette);
      this.field.sparkColors = palette.sparks && palette.sparks.length ? palette.sparks : ["#ffffff"];

      this.run = null;
      this._rafId = 0;
      this._fadeTimer = 0;
      this._autoTimer = 0;
      this._lastText = "";

      root.addEventListener("pointerdown", (e) => {
        if (!this.run) return;
        // The overlay is the only thing under the finger while it is open; stop
        // the press from reaching anything else (e.g. a focused spin button).
        e.preventDefault();
        e.stopPropagation();
        this.advance();
      });
      this._onKey = (e) => {
        if (e.code === "Space" || e.code === "Enter" || e.code === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.advance();
        }
      };
      this._onResize = () => this.field.resize();
    }

    get active() {
      return Boolean(this.run);
    }

    /**
     * Celebrate a settled win. Resolves with { skipped, shown } once dismissed;
     * resolves immediately with shown:false if the win is below every tier.
     * @param {object} o
     * @param {number} o.amount      settled total win (currency)
     * @param {number} o.bet         the round's bet
     * @param {object[]} o.tiers     celebratable tiers (any order)
     * @param {object} [o.finalTier] replaces the label at the end (max-win cap)
     * @param {number} [o.speed=1]   duration multiplier, e.g. 0.35 in turbo
     * @param {boolean} [o.reducedMotion] defaults to the OS setting
     * @param {number} [o.autoDismissMs=0] dismiss on its own after finishing (autoplay / free spins)
     */
    play({ amount, bet, tiers, finalTier = null, speed = 1, reducedMotion = prefersReducedMotion(), autoDismissMs = 0 }) {
      if (this.run) this._close(true);
      // A previous celebration may still be fading out with its loop running;
      // stop it so this one never runs two rAF chains.
      clearTimeout(this._fadeTimer);
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = 0;

      const ladder = tiers.slice().sort((a, b) => a.minX - b.minX);
      const reached = ladder.filter((t) => amount >= t.minX * bet - 1e-9);
      if (!reached.length || !(bet > 0)) return Promise.resolve({ skipped: false, shown: false });

      const run = {
        amount,
        bet,
        ladder,
        reached,
        finalTier,
        speed: clamp(speed, 0.05, 2),
        reduced: Boolean(reducedMotion),
        autoDismissMs,
        segs: this._timeline(amount, bet, ladder, reached, clamp(speed, 0.05, 2)),
        seg: 0,
        segT: 0,
        phase: "count", // count → beat → count … → done
        beatLeft: 0,
        value: 0,
        tier: null,
        skipped: false,
        dismissAt: Infinity,
        emitAcc: Object.create(null),
        resolve: null,
        prevFocus: document.activeElement
      };
      const done = new Promise((resolve) => { run.resolve = resolve; });
      this.run = run;

      delete this.root.dataset.tier;
      this.root.classList.remove("is-done");
      this.root.classList.toggle("is-reduced", run.reduced);
      this.labelEl.textContent = "";
      this._setAmount(0);
      if (this.announceEl) this.announceEl.textContent = "";

      this.field.clear();
      this.field.resize();
      window.addEventListener("resize", this._onResize);
      document.addEventListener("keydown", this._onKey, true);
      this.root.classList.add("is-open");
      this.root.setAttribute("aria-hidden", "false");
      try { this.root.focus({ preventScroll: true }); } catch (_) { /* old Safari */ }

      if (run.reduced) {
        // No count, no particles: the final state fades in.
        const top = reached[reached.length - 1];
        this._applyTier(top, { skipped: true, quiet: true });
        this._finish();
      } else {
        this._lastFrame = performance.now();
        this._loop();
      }
      return done;
    }

    /** What a tap does: skip while counting, dismiss once finished. */
    advance() {
      const run = this.run;
      if (!run) return;
      if (run.phase !== "done") this.skip();
      else if (performance.now() >= run.dismissAt) this.dismiss();
    }

    /** Jump to the final amount and the highest tier reached. */
    skip() {
      const run = this.run;
      if (!run || run.phase === "done") return;
      run.skipped = true;
      const top = run.reached[run.reached.length - 1];
      if (run.tier !== top) this._applyTier(top, { skipped: true });
      this._finish();
    }

    dismiss() {
      if (!this.run) return;
      this._close(false);
    }

    // ── internals ──────────────────────────────────────────────────────────

    // Count segments: 0 → first threshold, then threshold → threshold, then the
    // last threshold → amount. Each segment that ends ON a threshold carries the
    // tier-up. Later tiers cover more value in less time, so the count speeds up.
    _timeline(amount, bet, ladder, reached, speed) {
      const segs = [];
      let from = 0;
      reached.forEach((tier, i) => {
        const to = tier.minX * bet;
        const ms = i === 0 ? INTRO_MS : reached[i - 1].countMs;
        segs.push({ from, to, ms: ms * speed, tierUp: tier, ease: easeOutQuad });
        from = to;
      });
      const top = reached[reached.length - 1];
      if (amount > from + 1e-9) {
        const next = ladder[ladder.indexOf(top) + 1];
        let ms;
        if (next) {
          // Ends inside a bounded tier: time proportional to how far in, floored
          // so a win just over a threshold still gets a readable count.
          const frac = (amount - from) / (next.minX * bet - from);
          ms = top.countMs * clamp(0.45 + 0.55 * frac, 0.45, 1);
        } else {
          // Open-ended top tier: grows with the log of how far past it we are,
          // so 60x and 20,000x both feel right without the latter taking a minute.
          ms = top.countMs * Math.min(OPEN_TIER_MAX_STRETCH, 1 + 0.6 * Math.log10(amount / from));
        }
        segs.push({ from, to: amount, ms: ms * speed, tierUp: null, ease: easeOutCubic });
      }
      return segs;
    }

    _loop() {
      this._rafId = requestAnimationFrame((now) => {
        this._rafId = 0;
        // Clamped so a backgrounded tab resumes the count where it left off.
        const dt = clamp(now - this._lastFrame, 0, 50);
        this._lastFrame = now;
        this._frame(dt);
        if (this.run || this.field.live) this._loop();
      });
    }

    _frame(dt) {
      const run = this.run;
      if (run && run.phase === "beat") {
        run.beatLeft -= dt;
        if (run.beatLeft <= 0) {
          run.seg++;
          run.segT = 0;
          // _finish() owns the transition to "done" (it no-ops if already there).
          if (run.seg < run.segs.length) run.phase = "count";
          else this._finish();
        }
      } else if (run && run.phase === "count") {
        const seg = run.segs[run.seg];
        run.segT += dt;
        const p = seg.ms > 0 ? Math.min(1, run.segT / seg.ms) : 1;
        this._setAmount(seg.from + (seg.to - seg.from) * seg.ease(p));
        if (this.hooks.onTick) this.hooks.onTick(run.value, run.amount);
        if (p >= 1) {
          this._setAmount(seg.to);
          if (seg.tierUp) {
            this._applyTier(seg.tierUp, { skipped: false });
            run.phase = "beat";
            run.beatLeft = BEAT_MS * run.speed;
          } else {
            this._finish();
          }
        }
      }
      if (run && !run.reduced && run.tier) this._emitContinuous(run, dt);
      this.field.step(dt);
      this.field.draw();
    }

    _emitContinuous(run, dt) {
      const fx = FX[run.tier.fx] || FX.coins;
      const factor = (run.phase === "done" ? DONE_EMIT_FACTOR : 1) * this.fxScale * (dt / 1000);
      for (const kind in fx.rate) {
        run.emitAcc[kind] = (run.emitAcc[kind] || 0) + fx.rate[kind] * factor;
        const n = Math.floor(run.emitAcc[kind]);
        if (n > 0) {
          run.emitAcc[kind] -= n;
          this.field.emit(kind, n, kind === "spark" ? "radial" : "fountain");
        }
      }
    }

    _applyTier(tier, { skipped, quiet = false }) {
      const run = this.run;
      run.tier = tier;
      this.root.dataset.tier = tier.key;
      this.labelEl.textContent = tier.label || "";
      const fx = FX[tier.fx] || FX.coins;
      if (!run.reduced && !quiet) {
        for (const [kind, count, pattern] of fx.burst) {
          this.field.emit(kind, Math.round(count * this.fxScale), pattern);
        }
        // Web Animations, not class toggling: no forced reflow to restart them.
        this.labelEl.animate(
          [
            { transform: "scale(1.9)", opacity: 0, filter: "blur(6px)" },
            { transform: "scale(0.94)", opacity: 1, filter: "blur(0)", offset: 0.6 },
            { transform: "scale(1)", opacity: 1, filter: "blur(0)" }
          ],
          { duration: 420, easing: "cubic-bezier(0.2, 0.9, 0.3, 1.2)" }
        );
      }
      if (this.hooks.onTier) this.hooks.onTier(tier, { skipped });
    }

    _finish() {
      const run = this.run;
      if (!run || run.phase === "done") return;
      run.phase = "done";
      this._setAmount(run.amount);
      if (run.finalTier) this._applyTier(run.finalTier, { skipped: run.skipped });
      this.root.classList.add("is-done");
      run.dismissAt = performance.now() + (run.skipped ? DISMISS_GUARD_MS : FINISH_GUARD_MS);
      if (this.announceEl) {
        this.announceEl.textContent = `${run.tier.label || "Win"}: ${this.format(run.amount)}`;
      }
      if (run.autoDismissMs > 0) {
        this._autoTimer = setTimeout(() => this.dismiss(), run.autoDismissMs);
      }
      if (this.hooks.onComplete) this.hooks.onComplete();
    }

    _setAmount(v) {
      this.run.value = v;
      const text = this.format(v);
      if (text !== this._lastText) {
        this.amountEl.textContent = text;
        this._lastText = text;
      }
    }

    _close(immediate) {
      const run = this.run;
      this.run = null;
      clearTimeout(this._autoTimer);
      window.removeEventListener("resize", this._onResize);
      document.removeEventListener("keydown", this._onKey, true);
      this.root.classList.remove("is-open");
      this.root.setAttribute("aria-hidden", "true");
      const finishClose = () => {
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = 0;
        this.field.clear();
      };
      if (immediate) finishClose();
      else this._fadeTimer = setTimeout(finishClose, FADE_MS);
      if (run.prevFocus && typeof run.prevFocus.focus === "function") {
        try { run.prevFocus.focus({ preventScroll: true }); } catch (_) { /* detached */ }
      }
      if (this.hooks.onDismiss) this.hooks.onDismiss();
      run.resolve({ skipped: run.skipped, shown: true });
    }
  }

  window.BigWinController = BigWinController;
})();
