(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Banana X — hybrid sound engine.
  //
  // "Hybrid" = every SFX has a synthesized (Web Audio) fallback that works with
  // ZERO asset files, but each entry can also declare a `src` audio file. When a
  // file is registered and decoded, `play()` uses it; otherwise it synthesizes.
  // To upgrade to real audio later: drop files in assets/audio/ and add `src:`
  // to the manifest entry — no caller changes needed.
  //
  // Browser autoplay policy: an AudioContext can only start after a user gesture,
  // so the context is created lazily and `unlock()` is wired to the first
  // pointer/key/touch event by main.js (and self-installs a listener too).
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = "bananax.sound";
  const AUDIO_BASE = "assets/audio/";

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function loadPrefs() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { muted: false, volume: 0.8 };
      const parsed = JSON.parse(raw);
      return {
        muted: Boolean(parsed.muted),
        volume: typeof parsed.volume === "number" ? clamp(parsed.volume, 0, 1) : 0.8
      };
    } catch (e) {
      return { muted: false, volume: 0.8 };
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
    } catch (e) {
      /* private mode / quota — non-fatal */
    }
  }

  const prefs = loadPrefs();

  const state = {
    ctx: null,
    master: null,
    unlocked: false,
    buffers: new Map(), // name -> AudioBuffer (decoded file, if any)
    loading: new Map(), // name -> Promise
    lastPlay: new Map(), // name -> timestamp (debounce identical rapid triggers)
    listeners: new Set(), // change subscribers (UI sync)
    warmed: false, // whether the audio pipeline has been pre-warmed
    suspended: false, // parked because the tab/app is in the background
    wasPlaying: false // music state to restore when we come back
  };

  function ensureContext() {
    if (state.ctx) return state.ctx;
    const Ctor = root.AudioContext || root.webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = prefs.muted ? 0 : prefs.volume;
    master.connect(ctx.destination);
    state.ctx = ctx;
    state.master = master;
    return ctx;
  }

  function applyMasterGain() {
    if (!state.master || !state.ctx) return;
    const target = prefs.muted ? 0 : prefs.volume;
    const now = state.ctx.currentTime;
    state.master.gain.cancelScheduledValues(now);
    state.master.gain.setTargetAtTime(target, now, 0.02);
  }

  function notify() {
    state.listeners.forEach((fn) => {
      try {
        fn({ muted: prefs.muted, volume: prefs.volume });
      } catch (e) {
        /* ignore listener errors */
      }
    });
  }

  // --- synth primitives ------------------------------------------------------
  // Each returns nothing; they schedule short-lived nodes that self-clean.

  function tone(ctx, dest, { type = "sine", freq = 440, freqEnd = null, t = 0, dur = 0.2, gain = 0.5, attack = 0.002, release = null } = {}) {
    const start = ctx.currentTime + t;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (freqEnd != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), start + dur);
    const rel = release == null ? dur * 0.6 : release;
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur + rel);
    osc.connect(g).connect(dest);
    osc.start(start);
    osc.stop(start + dur + rel + 0.02);
  }

  function noise(ctx, dest, { t = 0, dur = 0.2, gain = 0.4, type = "highpass", freq = 1200, q = 0.7, sweepTo = null } = {}) {
    const start = ctx.currentTime + t;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.setValueAtTime(freq, start);
    if (sweepTo != null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), start + dur);
    filt.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), start + dur * 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    src.connect(filt).connect(g).connect(dest);
    src.start(start);
    src.stop(start + dur + 0.02);
  }

  function chord(ctx, dest, { freqs = [], t = 0, dur = 0.5, gain = 0.25, type = "triangle" } = {}) {
    freqs.forEach((f, i) => tone(ctx, dest, { type, freq: f, t: t + i * 0.012, dur, gain, attack: 0.01 }));
  }

  // --- SFX manifest ----------------------------------------------------------
  // synth(ctx, dest, opts) schedules the sound. Add `src:"file.mp3"` to prefer a
  // file. `minGap` debounces rapid identical triggers (ms).
  const SFX = {
    click: {
      minGap: 30,
      synth: (c, d) => tone(c, d, { type: "square", freq: 520, freqEnd: 360, dur: 0.05, gain: 0.18 })
    },
    bet_change: {
      minGap: 20,
      synth: (c, d, o = {}) => tone(c, d, { type: "triangle", freq: o.up ? 680 : 460, freqEnd: o.up ? 760 : 400, dur: 0.07, gain: 0.22 })
    },
    turbo_toggle: {
      synth: (c, d, o = {}) => tone(c, d, { type: "sawtooth", freq: o.on ? 420 : 620, freqEnd: o.on ? 880 : 320, dur: 0.14, gain: 0.22 })
    },
    spin_start: {
      synth: (c, d) => {
        // Mechanical launch: a punchy click, an upward whoosh, and a short
        // air-rush tail so the spin clearly "kicks off".
        tone(c, d, { type: "square", freq: 320, freqEnd: 180, dur: 0.06, gain: 0.22 });
        noise(c, d, { dur: 0.5, gain: 0.2, type: "bandpass", freq: 360, sweepTo: 3000, q: 0.7 });
        tone(c, d, { type: "sawtooth", freq: 150, freqEnd: 560, dur: 0.46, gain: 0.14 });
        tone(c, d, { type: "sine", freq: 90, freqEnd: 220, dur: 0.4, gain: 0.1, t: 0.02 });
      }
    },
    // Symbols dropping in and landing on the board (initial reveal + refills).
    reel_stop: {
      minGap: 8,
      synth: (c, d, o = {}) => {
        const base = 220 + (o.index || 0) * 24;
        // Soft body thud + a low-passed impact + a faint top sparkle = a
        // satisfying "the symbols just slammed into place" landing.
        tone(c, d, { type: "triangle", freq: base, freqEnd: base * 0.6, dur: 0.11, gain: 0.26 });
        tone(c, d, { type: "sine", freq: base * 0.5, freqEnd: base * 0.34, dur: 0.13, gain: 0.18 });
        noise(c, d, { dur: 0.08, gain: 0.16, type: "lowpass", freq: 1100 });
        noise(c, d, { dur: 0.06, gain: 0.06, type: "highpass", freq: 4200, t: 0.01 });
      }
    },
    tumble: {
      minGap: 16,
      synth: (c, d, o = {}) => {
        // Cascade refill drop — pitch rises slightly each step so a long tumble
        // chain feels like it's building. A soft thud + a quick airy fall.
        const base = 300 + (o.step || 0) * 44;
        tone(c, d, { type: "sine", freq: base, freqEnd: base * 0.55, dur: 0.12, gain: 0.2 });
        noise(c, d, { dur: 0.1, gain: 0.1, type: "lowpass", freq: 1400, sweepTo: 500 });
      }
    },
    explode: {
      synth: (c, d, o = {}) => {
        const tier = o.tier || "medium";
        const big = tier === "great" || tier === "blast-great";
        const med = big || tier === "medium" || tier === "blast-medium";
        noise(c, d, { dur: big ? 0.34 : med ? 0.24 : 0.16, gain: big ? 0.4 : 0.28, type: "lowpass", freq: 1800, sweepTo: 200 });
        tone(c, d, { type: "sine", freq: big ? 120 : 170, freqEnd: 40, dur: big ? 0.3 : 0.18, gain: big ? 0.4 : 0.26 });
        if (big) tone(c, d, { type: "square", freq: 90, freqEnd: 30, dur: 0.22, gain: 0.2, t: 0.01 });
      }
    },
    win_tick: {
      // The win-meter count-up drives this every ~16ms, so a minGap below that
      // meant a fresh oscillator + gain node ~60x a second for the whole
      // count-up. 45ms still reads as a continuous ticking run but builds a
      // third of the audio graph.
      minGap: 45,
      synth: (c, d, o = {}) => {
        const f = clamp(520 + (o.progress || 0) * 900, 520, 1700);
        tone(c, d, { type: "triangle", freq: f, dur: 0.04, gain: 0.12 });
      }
    },
    win_small: {
      synth: (c, d) => chord(c, d, { freqs: [523, 659, 784], dur: 0.35, gain: 0.18 })
    },
    win_big: {
      synth: (c, d) => {
        chord(c, d, { freqs: [523, 659, 784, 1046], dur: 0.5, gain: 0.2 });
        tone(c, d, { type: "triangle", freq: 1568, dur: 0.4, gain: 0.12, t: 0.18 });
      }
    },
    win_mega: {
      synth: (c, d) => {
        chord(c, d, { freqs: [523, 659, 784, 1046], dur: 0.6, gain: 0.22 });
        chord(c, d, { freqs: [659, 784, 988, 1318], dur: 0.6, gain: 0.18, t: 0.18 });
        tone(c, d, { type: "sawtooth", freq: 80, freqEnd: 160, dur: 0.5, gain: 0.16 });
      }
    },
    multiplier_catch: {
      minGap: 20,
      synth: (c, d, o = {}) => {
        const v = Math.max(2, o.value || 2);
        const f = clamp(440 + Math.log2(v) * 130, 440, 1600);
        tone(c, d, { type: "square", freq: f, freqEnd: f * 1.5, dur: 0.12, gain: 0.2 });
        tone(c, d, { type: "sine", freq: f * 2, dur: 0.16, gain: 0.1, t: 0.04 });
      }
    },
    multiplier_combine: {
      synth: (c, d, o = {}) => {
        const v = Math.max(2, o.value || 2);
        const f = clamp(520 + Math.log2(v) * 90, 520, 1500);
        tone(c, d, { type: "triangle", freq: f, freqEnd: f * 2, dur: 0.22, gain: 0.2 });
        tone(c, d, { type: "sine", freq: f * 0.5, freqEnd: f, dur: 0.22, gain: 0.12 });
      }
    },
    // The signature "a multiplier just dropped onto the board" sound. ALWAYS a
    // clear falling-drop → impact, but the heaviness (impact depth, sub-bass,
    // duration, chime stack) scales continuously with the multiplier value, so
    // a 2x is a light tick-drop and a 1000x is a thunderous slam.
    multiplier_drop: {
      minGap: 8,
      synth: (c, d, o = {}) => {
        const v = Math.max(2, Number(o.value) || 2);
        // 0 (=2x) .. 1 (=1000x) — drives every "heaviness" parameter.
        const heavy = clamp(Math.log2(v) / Math.log2(1000), 0, 1);
        const dropDur = 0.16 + heavy * 0.32;
        const impactFreq = 150 - heavy * 80;     // heavier value → deeper impact
        const impactGain = 0.22 + heavy * 0.24;
        const tImpact = dropDur * 0.8;

        // 1) The DROP — a descending whoosh that falls as the symbol lands.
        tone(c, d, { type: "sawtooth", freq: 820 - heavy * 160, freqEnd: impactFreq * 2.4, dur: dropDur, gain: 0.1 + heavy * 0.08 });
        noise(c, d, { dur: dropDur, gain: 0.08 + heavy * 0.1, type: "bandpass", freq: 1900, sweepTo: 280, q: 0.6 });

        // 2) The IMPACT — deeper + heavier the larger the multiplier.
        tone(c, d, { type: "sine", freq: impactFreq, freqEnd: impactFreq * 0.5, dur: 0.16 + heavy * 0.22, gain: impactGain, t: tImpact });
        if (heavy > 0.45) {
          tone(c, d, { type: "square", freq: impactFreq * 0.7, freqEnd: impactFreq * 0.34, dur: 0.22 + heavy * 0.22, gain: 0.14 + heavy * 0.12, t: tImpact });
          noise(c, d, { dur: 0.22, gain: 0.16 * heavy, type: "lowpass", freq: 1600, sweepTo: 150, t: tImpact });
        }

        // 3) Sparkle/chime stack on landing — taller stack for bigger tiers.
        const chime = clamp(420 + Math.log2(v) * 120, 420, 1600);
        const stack = v >= 1000 ? [chime, chime * 1.25, chime * 1.5, chime * 2]
          : v >= 250 ? [chime, chime * 1.25, chime * 1.5]
          : v >= 50 ? [chime, chime * 1.5]
          : [chime];
        chord(c, d, { freqs: stack, dur: 0.38 + heavy * 0.34, gain: 0.1 + heavy * 0.06, t: tImpact + 0.02 });
      }
    },
    bonus_trigger: {
      synth: (c, d) => {
        chord(c, d, { freqs: [392, 523, 659], dur: 0.3, gain: 0.18 });
        chord(c, d, { freqs: [523, 659, 784], dur: 0.3, gain: 0.18, t: 0.16 });
        chord(c, d, { freqs: [659, 784, 1046, 1318], dur: 0.5, gain: 0.2, t: 0.32 });
      }
    },
    buy_feature: {
      synth: (c, d) => {
        tone(c, d, { type: "sawtooth", freq: 220, freqEnd: 660, dur: 0.18, gain: 0.2 });
        chord(c, d, { freqs: [659, 880, 1318], dur: 0.4, gain: 0.18, t: 0.14 });
      }
    },
    max_win: {
      synth: (c, d) => {
        tone(c, d, { type: "sawtooth", freq: 100, freqEnd: 220, dur: 0.6, gain: 0.18 });
        chord(c, d, { freqs: [784, 988, 1318, 1568], dur: 0.7, gain: 0.22, t: 0.1 });
        chord(c, d, { freqs: [1046, 1318, 1568, 2093], dur: 0.7, gain: 0.18, t: 0.4 });
      }
    }
  };

  // --- file loading (optional, hybrid upgrade path) --------------------------
  function loadFile(name) {
    const def = SFX[name];
    if (!def || !def.src) return Promise.resolve(null);
    if (state.buffers.has(name)) return Promise.resolve(state.buffers.get(name));
    if (state.loading.has(name)) return state.loading.get(name);
    const ctx = ensureContext();
    if (!ctx) return Promise.resolve(null);
    const url = /^https?:|^\//.test(def.src) ? def.src : AUDIO_BASE + def.src;
    const p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("HTTP " + r.status))))
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        state.buffers.set(name, decoded);
        return decoded;
      })
      .catch(() => null); // graceful fallback to synth
    state.loading.set(name, p);
    return p;
  }

  function playBuffer(buffer, gain) {
    const ctx = state.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const g = ctx.createGain();
    g.gain.value = gain == null ? 1 : gain;
    src.connect(g).connect(state.master);
    src.start();
  }

  // Pre-warm the audio pipeline so the FIRST real sound doesn't pay the
  // device's start-up latency (a common cause of a perceived "delay" on the
  // first click/spin). Plays a single-sample silent buffer.
  function prewarm() {
    const ctx = state.ctx;
    if (!ctx || state.warmed) return;
    state.warmed = true;
    try {
      const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
    } catch (e) { /* ignore */ }
  }

  // --- melodic idle music ----------------------------------------------------
  // A soft looping melody (chord progression + bass + per-beat lead) so the idle
  // game has an actual tune, not a flat drone. Scheduled with a Web-Audio
  // lookahead loop. Hybrid `src` seam: set MUSIC.src to loop a real track.
  const N = { // note frequencies (Hz)
    A2: 110.0, C3: 130.81, E3: 164.81, F2: 87.31, G2: 98.0, B2: 123.47,
    A3: 220.0, C4: 261.63, E4: 329.63, F3: 174.61, G3: 196.0, B3: 246.94, D4: 293.66,
    A4: 440.0, C5: 523.25, E5: 659.25, F4: 349.23, G4: 392.0, B4: 493.88, D5: 587.33, G5: 783.99
  };
  const MUSIC = {
    src: null,
    bpm: 82,
    gain: 0.22,
    // i–VI–III–VII in A minor (Am–F–C–G): warm, gently uplifting loop.
    prog: [
      { bass: N.A2, pad: [N.A3, N.C4, N.E4], mel: [N.A4, N.E5, N.C5, N.E5] },
      { bass: N.F2, pad: [N.F3, N.A3, N.C4], mel: [N.C5, N.A4, N.F4, N.A4] },
      { bass: N.C3, pad: [N.C4, N.E4, N.G4], mel: [N.E5, N.G5, N.E5, N.C5] },
      { bass: N.G2, pad: [N.G3, N.B3, N.D4], mel: [N.D5, N.B4, N.G4, N.B4] }
    ]
  };
  let music = null;

  function musicVoice(at, freq, dur, gain, type, attack, release, dest) {
    const ctx = state.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    const peak = Math.max(0.0001, gain);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.setValueAtTime(peak, Math.max(at + attack, at + dur - release));
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  function scheduleMusic() {
    if (!music || music.stopped) return;
    const ctx = state.ctx;
    const beat = 60 / MUSIC.bpm;
    const bar = beat * 4;
    while (music.nextTime < ctx.currentTime + 0.35) {
      const chord = MUSIC.prog[music.step % MUSIC.prog.length];
      const t = music.nextTime;
      // soft sustained pad across the whole bar
      chord.pad.forEach((f) => musicVoice(t, f, bar * 0.98, 0.045, "triangle", 0.3, 0.5, music.bus));
      // gentle bass
      musicVoice(t, chord.bass, bar * 0.92, 0.11, "sine", 0.02, 0.25, music.bus);
      // lead melody — one note per beat
      chord.mel.forEach((f, k) => {
        if (f) musicVoice(t + k * beat, f, beat * 0.82, 0.075, "triangle", 0.012, 0.12, music.bus);
      });
      music.nextTime += bar;
      music.step += 1;
    }
    music.timer = setTimeout(scheduleMusic, 130);
  }

  function startMusic() {
    if (prefs.muted || music) return;
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    const bus = ctx.createGain();
    bus.gain.value = 0.0001;
    bus.connect(state.master);
    music = { bus, step: 0, nextTime: ctx.currentTime + 0.12, timer: 0, stopped: false };

    // Hybrid: loop a real track if registered, else play the synth melody.
    if (MUSIC.src) {
      const url = /^https?:|^\//.test(MUSIC.src) ? MUSIC.src : AUDIO_BASE + MUSIC.src;
      fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
        .then((b) => ctx.decodeAudioData(b))
        .then((decoded) => {
          if (!music || music.bus !== bus) return;
          const s = ctx.createBufferSource();
          s.buffer = decoded; s.loop = true; s.connect(bus); s.start();
          music.fileSrc = s;
          bus.gain.setTargetAtTime(MUSIC.gain, ctx.currentTime, 1.2);
        })
        .catch(() => { if (music && music.bus === bus) scheduleMusic(); });
      bus.gain.setTargetAtTime(MUSIC.gain, ctx.currentTime, 1.2);
      return;
    }
    bus.gain.setTargetAtTime(MUSIC.gain, ctx.currentTime, 1.2);
    scheduleMusic();
  }

  function stopMusic() {
    if (!music || !state.ctx) { music = null; return; }
    const m = music;
    music = null;
    m.stopped = true;
    clearTimeout(m.timer);
    const now = state.ctx.currentTime;
    try {
      m.bus.gain.cancelScheduledValues(now);
      m.bus.gain.setTargetAtTime(0.0001, now, 0.3);
    } catch (e) { /* ignore */ }
    setTimeout(() => {
      try { if (m.fileSrc) m.fileSrc.stop(); m.bus.disconnect(); } catch (e) { /* ignore */ }
    }, 1200);
  }

  // --- public API ------------------------------------------------------------
  function unlock() {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    state.unlocked = true;
    applyMasterGain();
    prewarm();
    if (!prefs.muted) startMusic();
  }

  function play(name, opts = {}) {
    const def = SFX[name];
    if (!def) return;
    if (prefs.muted) return;
    // Parked in the background: drop the sound rather than resuming the context.
    // Timer-driven game state (autoplay, win count-ups) keeps advancing while
    // hidden, and without this every one of those steps would un-suspend the
    // audio hardware we just parked.
    if (state.suspended) return;
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();

    if (def.minGap) {
      const now = performance.now();
      const last = state.lastPlay.get(name) || 0;
      if (now - last < def.minGap) return;
      state.lastPlay.set(name, now);
    }

    // Hybrid seam: prefer a decoded file if available; else synth.
    if (def.src) {
      const cached = state.buffers.get(name);
      if (cached) {
        playBuffer(cached, opts.gain);
        return;
      }
      loadFile(name); // warm for next time; fall through to synth now
    }
    try {
      def.synth(ctx, state.master, opts);
    } catch (e) {
      /* never let a sound crash the game */
    }
  }

  function setMuted(muted) {
    prefs.muted = Boolean(muted);
    savePrefs(prefs);
    ensureContext();
    applyMasterGain();
    if (prefs.muted) stopMusic();
    else if (state.unlocked) startMusic();
    notify();
    return prefs.muted;
  }

  function toggleMuted() {
    return setMuted(!prefs.muted);
  }

  function setVolume(v) {
    prefs.volume = clamp(Number(v) || 0, 0, 1);
    savePrefs(prefs);
    ensureContext();
    applyMasterGain();
    notify();
    return prefs.volume;
  }

  function onChange(fn) {
    if (typeof fn === "function") state.listeners.add(fn);
    return () => state.listeners.delete(fn);
  }

  // --- background suspend ----------------------------------------------------
  // The music scheduler re-arms a setTimeout every 130ms for the entire session
  // and the AudioContext is never suspended, so a backgrounded game kept the
  // audio render thread and the hardware clock alive indefinitely. Worse, a
  // hidden tab clamps setTimeout to ~1s while the scheduler only looks 0.35s
  // ahead, so it under-schedules and then burst-catches-up on every tick.
  //
  // suspendAudio() parks all of it; resumeAudio() puts it back exactly as it
  // was. `wasPlaying` remembers whether music was running so we don't start it
  // for a player who had muted or never triggered the first gesture.
  function suspendAudio() {
    if (state.suspended) return;
    state.suspended = true;
    state.wasPlaying = Boolean(music);
    stopMusic();
    const ctx = state.ctx;
    if (ctx && ctx.state === "running") {
      try { ctx.suspend(); } catch (e) { /* ignore */ }
    }
  }

  function resumeAudio() {
    if (!state.suspended) return;
    state.suspended = false;
    const ctx = state.ctx;
    if (ctx && ctx.state === "suspended") {
      try { ctx.resume(); } catch (e) { /* ignore */ }
    }
    if (state.wasPlaying && !prefs.muted && state.unlocked) startMusic();
    state.wasPlaying = false;
  }

  // Self-install a one-shot unlock on the first user gesture as a safety net,
  // even if main.js forgets to call unlock().
  function installAutoUnlock() {
    const events = ["pointerdown", "touchstart", "keydown", "click"];
    const handler = () => {
      unlock();
      events.forEach((ev) => root.removeEventListener(ev, handler, true));
    };
    events.forEach((ev) => root.addEventListener(ev, handler, true));
  }
  if (typeof root.addEventListener === "function") installAutoUnlock();

  root.Sound = {
    play,
    unlock,
    setMuted,
    toggleMuted,
    setVolume,
    onChange,
    startMusic,
    stopMusic,
    suspendAudio,
    resumeAudio,
    isSuspended: () => Boolean(state.suspended),
    contextState: () => (state.ctx ? state.ctx.state : "none"),
    isMuted: () => prefs.muted,
    getVolume: () => prefs.volume,
    names: () => Object.keys(SFX)
  };
})(typeof window !== "undefined" ? window : globalThis);
