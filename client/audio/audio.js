(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Vault 20K — sound engine.
  //
  // Real sound files first, synth as the safety net:
  //   • assets/audio/manifest.json (built by tools/build-audio.js) lists, per
  //     sound key, 1-4 file variations and the three music moods. Files are
  //     decoded once the first gesture unlocks audio; the sounds of the first
  //     spin load first.
  //   • EVENTS maps every game event (Sound.play(name, opts)) to a sound key,
  //     its bus and its per-play shaping (gain, playback rate, stereo pan,
  //     music duck). Variations rotate round-robin with no immediate repeat,
  //     with a small pitch / gain jitter, so repeats never sound identical.
  //   • Until a file is decoded (or if one is missing) the event's synth voice
  //     (SFX) plays, so the game is never silent.
  //
  // Mix: every voice goes to a bus (sfx, ui, music, ambience) → the master
  // (the player's volume / mute) → a limiter → the output. One AudioContext
  // for the whole client (main.js has no audio graph of its own). Music runs
  // in three moods (base, freeSpins, bigWin), crossfaded, and ducks under
  // wins and strikes.
  //
  // Browser autoplay policy: the context starts on the first user gesture
  // (unlock(), wired by main.js and self-installed as a safety net).
  // ---------------------------------------------------------------------------

  const STORAGE_KEY = "bananax.sound";
  const AUDIO_BASE = "assets/audio/";

  // Bus levels (linear) under the master. UI sits under the game; music
  // under both.
  const BUS_LEVEL = { sfx: 1, ui: 0.55, music: 0.42, ambience: 0.5 };
  // Music: crossfade between moods, and how far / how fast it ducks.
  const MUSIC_FADE_S = 0.8;
  const DUCK = { db: -9, attackS: 0.04, releaseS: 0.35 };
  // Per-play variation on file voices.
  const JITTER = { rate: 0.03, db: 1.5 };

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }
  const dbToGain = (db) => Math.pow(10, db / 20);

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
    master: null,      // player volume / mute
    limiter: null,
    buses: {},         // name -> GainNode
    duckNode: null,    // music bus duck stage
    duckUntil: 0,
    unlocked: false,
    manifest: null,    // assets/audio/manifest.json
    manifestP: null,
    ext: "ogg",
    buffers: new Map(), // file path -> AudioBuffer
    loading: new Map(), // file path -> Promise
    lastPlay: new Map(), // event -> timestamp (minGap)
    lastVariant: new Map(), // sound key -> last variation index
    recent: [],        // probes: the last plays { name, key, file, bus, synth }
    listeners: new Set(),
    warmed: false,
    suspended: false,
    wasPlaying: false
  };

  function ensureContext() {
    if (state.ctx) return state.ctx;
    const Ctor = root.AudioContext || root.webkitAudioContext;
    if (!Ctor) return null;
    const ctx = new Ctor();
    // Limiter: a fast, hard compressor just under 0 dBFS, so stacked voices
    // (a burst + a strike + a sting) never clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 2;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.2;
    limiter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.value = prefs.muted ? 0 : prefs.volume;
    master.connect(limiter);
    const buses = {};
    for (const [name, level] of Object.entries(BUS_LEVEL)) {
      const g = ctx.createGain();
      g.gain.value = level;
      buses[name] = g;
    }
    // Music runs through its own duck stage before the music bus.
    const duckNode = ctx.createGain();
    duckNode.gain.value = 1;
    duckNode.connect(buses.music);
    Object.values(buses).forEach((g) => g.connect(master));
    state.ctx = ctx;
    state.master = master;
    state.limiter = limiter;
    state.buses = buses;
    state.duckNode = duckNode;
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

  // --- synth voices (the fallback) ------------------------------------------
  // synth(ctx, dest, opts) schedules a generated voice. It plays while the
  // event's sound file is not decoded (or missing), so the game is never silent.
  // `minGap` debounces rapid identical triggers (ms).
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


  // Synth voices for the events added with the sound files.
  SFX.tick = {
    minGap: 5,
    synth: (c, d, o = {}) => {
      const up = Math.max(0, (Number(o.rows) || 5) - 1 - (Number(o.row) || 0));
      const f = 900 * Math.pow(2, (up * 2 + (Number(o.col) || 0)) / 12);
      tone(c, d, { type: "triangle", freq: f, freqEnd: f * 0.6, dur: 0.04, gain: 0.07, release: 0.01 });
    }
  };
  SFX.scatter_land = {
    minGap: 30,
    synth: (c, d, o = {}) => {
      const f = 660 * Math.pow(2, ((Number(o.n) || 1) - 1) * 2 / 12);
      chord(c, d, { freqs: [f, f * 1.5], dur: 0.22, gain: 0.14 });
    }
  };
  SFX.multiplier_strike = {
    synth: (c, d) => {
      noise(c, d, { dur: 0.12, gain: 0.35, type: "highpass", freq: 3000 });
      noise(c, d, { dur: 0.5, gain: 0.3, type: "lowpass", freq: 900, sweepTo: 120, t: 0.05 });
    }
  };
  SFX.fs_intro = SFX.bonus_trigger;
  SFX.fs_outro = SFX.win_big;

  // --- events → sound keys ---------------------------------------------------
  // Each event returns how to voice one play: the manifest sound `key`, its
  // `bus`, a gain offset in dB, a playback `rate`, a stereo `pan` (-1..1) and
  // whether it `duck`s the music. `minGap` (ms) debounces rapid repeats.
  const colPan = (i, cols = 6) => clamp(((Number(i) || 0) / Math.max(1, cols - 1)) * 0.7 - 0.35, -0.35, 0.35);
  const semis = (n) => Math.pow(2, n / 12);
  const isGreat = (t) => /great|mega|epic|max/.test(String(t || ""));
  const EVENTS = {
    click: { minGap: 30, voice: () => ({ key: "ui_click", bus: "ui" }) },
    bet_change: { minGap: 20, voice: (o) => ({ key: "ui_bet", bus: "ui", rate: o.up ? 1.06 : 0.94 }) },
    turbo_toggle: { voice: (o) => ({ key: o.on ? "ui_turbo_on" : "ui_turbo_off", bus: "ui" }) },
    spin_start: { minGap: 60, voice: () => ({ key: "spin_start", bus: "sfx", db: -2 }) },
    // A reel lands as a stack: one thud per reel, placed left → right.
    reel_stop: { minGap: 8, voice: (o) => ({ key: "reel_stop", bus: "sfx", pan: colPan(o.index), rate: semis(-(Number(o.index) || 0) * 0.35) }) },
    // One light tick per symbol landing, rising as a reel stacks up.
    tick: { minGap: 5, voice: (o) => {
      const up = Math.max(0, (Number(o.rows) || 5) - 1 - (Number(o.row) || 0));
      return { key: "tick", bus: "sfx", db: -9, pan: colPan(o.col), rate: semis(Math.min(10, up * 1.5 + (Number(o.col) || 0) * 0.5)) };
    } },
    // A tumble refill: an airy fall, a little brighter each step of a chain.
    tumble: { minGap: 16, voice: (o) => ({ key: "refill", bus: "sfx", db: -3, rate: semis(Math.min(6, (Number(o.step) || 0) * 1.2)) }) },
    explode: { voice: (o) => ({ key: isGreat(o.tier) ? "explode_great" : "explode", bus: "sfx" }) },
    win_tick: { minGap: 45, voice: (o) => ({ key: "win_tick", bus: "sfx", db: -6, rate: 0.92 + clamp(Number(o.progress) || 0, 0, 1) * 0.5 }) },
    scatter_land: { minGap: 30, voice: (o) => ({ key: "scatter", bus: "sfx", rate: semis(Math.min(12, ((Number(o.n) || 1) - 1) * 2)) }) },
    win_small: { voice: () => ({ key: "win_small", bus: "sfx", duck: true }) },
    win_big: { voice: () => ({ key: "win_big", bus: "sfx", duck: true }) },
    win_mega: { voice: () => ({ key: "win_mega", bus: "sfx", duck: true }) },
    max_win: { voice: () => ({ key: "max_win", bus: "sfx", duck: true }) },
    multiplier_strike: { minGap: 40, voice: () => ({ key: "strike", bus: "sfx", duck: true }) },
    multiplier_drop: { minGap: 8, voice: (o) => ({ key: (Number(o.value) || 2) >= 50 ? "bang_big" : "bang", bus: "sfx", duck: (Number(o.value) || 2) >= 50 }) },
    multiplier_catch: { minGap: 20, voice: (o) => ({ key: "catch", bus: "sfx", rate: semis(Math.min(7, Math.log2(Math.max(2, Number(o.value) || 2)))) }) },
    multiplier_combine: { voice: () => ({ key: "combine", bus: "sfx", duck: true }) },
    bonus_trigger: { voice: () => ({ key: "bonus_trigger", bus: "sfx", duck: true }) },
    fs_intro: { voice: () => ({ key: "fs_intro", bus: "sfx", duck: true }) },
    fs_outro: { voice: () => ({ key: "fs_outro", bus: "sfx", duck: true }) },
    buy_feature: { voice: () => ({ key: "buy", bus: "sfx", duck: true }) }
  };

  // --- manifest + file loading ---------------------------------------------
  function pickExt() {
    try {
      const a = root.document && root.document.createElement("audio");
      // Opus in Ogg where the browser decodes it; AAC (m4a) everywhere else (Safari).
      if (a && a.canPlayType && a.canPlayType('audio/ogg; codecs="opus"')) return "ogg";
    } catch (e) { /* fall through */ }
    return "m4a";
  }

  function loadManifest() {
    if (state.manifestP) return state.manifestP;
    state.ext = pickExt();
    state.manifestP = fetch(AUDIO_BASE + "manifest.json", { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((m) => {
        state.manifest = m && m.sounds ? m : null;
        if (state.manifest) preloadAll();
        return state.manifest;
      })
      .catch(() => null);
    return state.manifestP;
  }

  function loadFile(path) {
    if (state.buffers.has(path)) return Promise.resolve(state.buffers.get(path));
    if (state.loading.has(path)) return state.loading.get(path);
    const ctx = ensureContext();
    if (!ctx) return Promise.resolve(null);
    const url = AUDIO_BASE + path + "." + state.ext;
    const p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error("HTTP " + r.status))))
      .then((buf) => new Promise((res, rej) => ctx.decodeAudioData(buf, res, rej)))
      .then((decoded) => {
        state.buffers.set(path, decoded);
        return decoded;
      })
      .catch(() => null); // that variation stays on the synth fallback
    state.loading.set(path, p);
    return p;
  }

  // The first spin's sounds first, then the rest, then the music.
  const FIRST = ["spin_start", "reel_stop", "tick", "ui_click", "explode", "refill", "win_tick", "win_small", "scatter"];
  function preloadAll() {
    const m = state.manifest;
    if (!m) return;
    const keys = Object.keys(m.sounds);
    const ordered = FIRST.filter((k) => m.sounds[k]).concat(keys.filter((k) => !FIRST.includes(k)));
    let chain = Promise.resolve();
    // Load in small batches so the first spin's files are not queued behind music.
    for (let i = 0; i < ordered.length; i += 4) {
      const batch = ordered.slice(i, i + 4);
      chain = chain.then(() => Promise.all(batch.flatMap((k) => m.sounds[k].map(loadFile))));
    }
    chain.then(() => {
      if (m.music && m.music[music.mood]) return loadFile(m.music[music.mood]).then(() => { if (music.wanted) playMood(music.mood); });
    }).then(() => Promise.all(Object.values(m.music || {}).map(loadFile)));
  }

  /** The next variation of sound `key`: round-robin, never the same twice in a row. */
  function nextVariant(key) {
    const files = state.manifest && state.manifest.sounds[key];
    if (!files || !files.length) return null;
    const ready = files.map((f, i) => (state.buffers.has(f) ? i : -1)).filter((i) => i >= 0);
    if (!ready.length) return null;
    const last = state.lastVariant.has(key) ? state.lastVariant.get(key) : -1;
    let pool = ready.filter((i) => i !== last);
    if (!pool.length) pool = ready;
    const i = pool[Math.floor(Math.random() * pool.length)];
    state.lastVariant.set(key, i);
    return files[i];
  }

  function playFile(path, v) {
    const ctx = state.ctx;
    const src = ctx.createBufferSource();
    src.buffer = state.buffers.get(path);
    src.playbackRate.value = (v.rate || 1) * (1 + (Math.random() * 2 - 1) * JITTER.rate);
    const g = ctx.createGain();
    g.gain.value = dbToGain((v.db || 0) + (Math.random() * 2 - 1) * JITTER.db);
    let out = g;
    if (v.pan && ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = v.pan;
      g.connect(p);
      out = p;
    }
    out.connect(state.buses[v.bus] || state.buses.sfx);
    src.connect(g);
    src.start();
  }

  function remember(entry) {
    state.recent.push(entry);
    if (state.recent.length > 64) state.recent.shift();
  }

  /** Dip the music under a moment (a win, a strike), then let it back. */
  function duck(holdMs = 900) {
    const ctx = state.ctx;
    if (!ctx || !state.duckNode) return;
    const now = ctx.currentTime;
    const g = state.duckNode.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(dbToGain(DUCK.db), now, DUCK.attackS);
    state.duckUntil = performance.now() + holdMs;
    g.setTargetAtTime(1, now + holdMs / 1000, DUCK.releaseS);
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

  // --- music: three moods, crossfaded ----------------------------------------
  // base (the game), freeSpins (the bonus), bigWin (under the big-win
  // count-up; setMusic(..., { temporary: true }) returns to the mood before).
  // Files come from the manifest; without them the synth melody below plays
  // the base mood so there is never silence.
  const N = { // note frequencies (Hz) for the synth fallback melody
    A2: 110.0, C3: 130.81, E3: 164.81, F2: 87.31, G2: 98.0, B2: 123.47,
    A3: 220.0, C4: 261.63, E4: 329.63, F3: 174.61, G3: 196.0, B3: 246.94, D4: 293.66,
    A4: 440.0, C5: 523.25, E5: 659.25, F4: 349.23, G4: 392.0, B4: 493.88, D5: 587.33, G5: 783.99
  };
  const SYNTH_MUSIC = {
    bpm: 82,
    gain: 0.5,
    prog: [
      { bass: N.A2, pad: [N.A3, N.C4, N.E4], mel: [N.A4, N.E5, N.C5, N.E5] },
      { bass: N.F2, pad: [N.F3, N.A3, N.C4], mel: [N.C5, N.A4, N.F4, N.A4] },
      { bass: N.C3, pad: [N.C4, N.E4, N.G4], mel: [N.E5, N.G5, N.E5, N.C5] },
      { bass: N.G2, pad: [N.G3, N.B3, N.D4], mel: [N.D5, N.B4, N.G4, N.B4] }
    ]
  };
  const music = { mood: "base", prev: null, wanted: false, voice: null, synth: null };

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

  function scheduleSynth() {
    const s = music.synth;
    if (!s || s.stopped) return;
    const ctx = state.ctx;
    const beat = 60 / SYNTH_MUSIC.bpm;
    const bar = beat * 4;
    while (s.nextTime < ctx.currentTime + 0.35) {
      const chord = SYNTH_MUSIC.prog[s.step % SYNTH_MUSIC.prog.length];
      const t = s.nextTime;
      chord.pad.forEach((f) => musicVoice(t, f, bar * 0.98, 0.045, "triangle", 0.3, 0.5, s.bus));
      musicVoice(t, chord.bass, bar * 0.92, 0.11, "sine", 0.02, 0.25, s.bus);
      chord.mel.forEach((f, k) => {
        if (f) musicVoice(t + k * beat, f, beat * 0.82, 0.075, "triangle", 0.012, 0.12, s.bus);
      });
      s.nextTime += bar;
      s.step += 1;
    }
    s.timer = setTimeout(scheduleSynth, 130);
  }

  function fadeOutVoice(v) {
    if (!v) return;
    const ctx = state.ctx;
    const now = ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0.0001, now, MUSIC_FADE_S / 3);
    } catch (e) { /* ignore */ }
    if (v.stopped !== undefined) { v.stopped = true; clearTimeout(v.timer); }
    setTimeout(() => {
      try { if (v.src) v.src.stop(); v.gain.disconnect(); } catch (e) { /* ignore */ }
    }, MUSIC_FADE_S * 1000 + 600);
  }

  /** Start (or crossfade to) the current mood's file; the synth melody stands
   *  in while it is not decoded (or missing). */
  function playMood(mood) {
    const ctx = state.ctx;
    if (!ctx || !music.wanted) return;
    const path = state.manifest && state.manifest.music && state.manifest.music[mood];
    const buf = path && state.buffers.get(path);
    if (buf) {
      if (music.voice && music.voice.mood === mood) return;
      const gain = ctx.createGain();
      gain.gain.value = 0.0001;
      gain.connect(state.duckNode);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(gain);
      src.start();
      gain.gain.setTargetAtTime(1, ctx.currentTime, MUSIC_FADE_S / 3);
      fadeOutVoice(music.voice);
      fadeOutVoice(music.synth);
      music.synth = null;
      music.voice = { mood, src, gain };
      return;
    }
    if (path) loadFile(path).then((b) => { if (b && music.mood === mood) playMood(mood); });
    // Nothing decoded for this mood yet: keep whatever plays, or start the synth.
    if (!music.voice && !music.synth) {
      const bus = ctx.createGain();
      bus.gain.value = 0.0001;
      bus.connect(state.duckNode);
      music.synth = { gain: bus, bus, step: 0, nextTime: ctx.currentTime + 0.12, timer: 0, stopped: false };
      bus.gain.setTargetAtTime(SYNTH_MUSIC.gain, ctx.currentTime, 1.2);
      scheduleSynth();
    }
  }

  function startMusic() {
    if (prefs.muted) return;
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    music.wanted = true;
    playMood(music.mood);
  }

  function stopMusic() {
    music.wanted = false;
    if (!state.ctx) { music.voice = null; music.synth = null; return; }
    fadeOutVoice(music.voice);
    fadeOutVoice(music.synth);
    music.voice = null;
    music.synth = null;
  }

  /** Switch the music mood: "base" | "freeSpins" | "bigWin". A temporary
   *  mood (the big-win count-up) remembers the one before; endTemporary()
   *  returns to it. */
  function setMusic(mood, { temporary = false } = {}) {
    if (!mood || mood === music.mood) return;
    if (temporary) music.prev = music.prev || music.mood;
    else music.prev = null;
    music.mood = mood;
    playMood(mood);
  }

  function endTemporaryMusic() {
    if (!music.prev) return;
    const back = music.prev;
    music.prev = null;
    music.mood = back;
    playMood(back);
  }

  // --- anticipation drone (scatter near-trigger) ---------------------------
  // A rising, filtered sawtooth for `ms`, on the sfx bus. Never outlives the
  // anticipation it scores.
  const drone = (() => {
    let nodes = null;
    function stop() {
      if (!nodes || !state.ctx) return;
      const n = nodes;
      nodes = null;
      const t = state.ctx.currentTime;
      n.gain.gain.cancelScheduledValues(t);
      n.gain.gain.setTargetAtTime(0, t, 0.05);
      setTimeout(() => n.oscs.forEach((o) => { try { o.stop(); } catch (e) { /* already stopped */ } }), 300);
    }
    function start(ms, { from = 55, to = 110 } = {}) {
      stop();
      if (prefs.muted || state.suspended) return;
      const ctx = ensureContext();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      const dur = Math.max(0.3, ms / 1000);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 6;
      filter.frequency.setValueAtTime(220, t);
      filter.frequency.exponentialRampToValueAtTime(2400, t + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2, t + Math.min(0.25, dur / 2));
      const oscs = [0, 9].map((detune) => {
        const o = ctx.createOscillator();
        o.type = "sawtooth";
        o.frequency.setValueAtTime(from, t);
        o.frequency.exponentialRampToValueAtTime(to, t + dur);
        o.detune.value = detune;
        o.connect(filter);
        o.start(t);
        return o;
      });
      filter.connect(gain);
      gain.connect(state.buses.sfx);
      nodes = { gain, oscs };
      const mine = nodes;
      setTimeout(() => { if (nodes === mine) stop(); }, ms + 400);
    }
    return { start, stop, isPlaying: () => Boolean(nodes) };
  })();

  // --- public API ------------------------------------------------------------
  function unlock() {
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    state.unlocked = true;
    applyMasterGain();
    prewarm();
    loadManifest();
    if (!prefs.muted) startMusic();
  }

  function play(name, opts = {}) {
    const ev = EVENTS[name];
    const synth = SFX[name];
    if (!ev && !synth) return;
    if (prefs.muted) return;
    // Parked in the background: drop the sound rather than resuming the context.
    // Timer-driven game state (autoplay, win count-ups) keeps advancing while
    // hidden, and without this every one of those steps would un-suspend the
    // audio hardware we just parked.
    if (state.suspended) return;
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    if (!state.manifestP) loadManifest();

    const minGap = (ev && ev.minGap) || (synth && synth.minGap) || 0;
    if (minGap) {
      const now = performance.now();
      const last = state.lastPlay.get(name) || 0;
      if (now - last < minGap) return;
      state.lastPlay.set(name, now);
    }

    const v = ev ? Object.assign({ bus: "sfx", db: 0, rate: 1, pan: 0 }, ev.voice(opts || {})) : { bus: "sfx" };
    if (v.duck) duck(name === "win_small" ? 500 : 1100);
    const file = ev ? nextVariant(v.key) : null;
    try {
      if (file) {
        playFile(file, v);
        remember({ name, key: v.key, file, bus: v.bus, synth: false });
      } else if (synth) {
        synth.synth(ctx, state.buses[v.bus] || state.buses.sfx, opts);
        remember({ name, key: v.key || name, file: null, bus: v.bus, synth: true });
      }
    } catch (e) {
      /* never let a sound crash the game */
    }
  }

  function setMuted(muted) {
    prefs.muted = Boolean(muted);
    savePrefs(prefs);
    ensureContext();
    applyMasterGain();
    if (prefs.muted) { stopMusic(); drone.stop(); } else if (state.unlocked) startMusic();
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
  // A backgrounded game parks the whole audio graph (music, drone, context);
  // resumeAudio() puts it back as it was. `wasPlaying` remembers whether
  // music was running so we don't start it for a player who had muted or
  // never made the first gesture.
  function suspendAudio() {
    if (state.suspended) return;
    state.suspended = true;
    state.wasPlaying = music.wanted;
    stopMusic();
    drone.stop();
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
    setMusic,
    endTemporaryMusic,
    duck,
    drone,
    suspendAudio,
    resumeAudio,
    isSuspended: () => Boolean(state.suspended),
    contextState: () => (state.ctx ? state.ctx.state : "none"),
    isMuted: () => prefs.muted,
    getVolume: () => prefs.volume,
    names: () => Array.from(new Set(Object.keys(EVENTS).concat(Object.keys(SFX)))),
    // Probes: the mix graph and the last plays, read-only.
    debug: {
      buses: () => Object.keys(state.buses),
      hasLimiter: () => Boolean(state.limiter),
      recent: () => state.recent.slice(),
      manifest: () => state.manifest,
      ext: () => state.ext,
      loaded: () => Array.from(state.buffers.keys()),
      ready: () => (state.manifestP || loadManifest()).then(() => true),
      music: () => ({ mood: music.mood, prev: music.prev, playing: music.voice ? music.voice.mood : (music.synth ? "synth" : null) }),
      duckLevel: () => (state.duckNode ? state.duckNode.gain.value : 1),
      contexts: () => (state.ctx ? 1 : 0)
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
