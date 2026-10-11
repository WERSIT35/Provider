(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // Vault 20K — sound engine.
  //
  // Every sound is a real recording (no generated voices):
  //   • assets/audio/manifest.json (built by tools/build-audio.js) lists, per
  //     sound key, 1-4 file variations and the three music moods. Files are
  //     decoded once the first gesture unlocks audio; the sounds of the first
  //     spin load first.
  //   • EVENTS maps every game event (Sound.play(name, opts)) to a sound key,
  //     its bus and its per-play shaping (gain, playback rate, stereo pan,
  //     music duck). Variations rotate round-robin with no immediate repeat,
  //     with a small pitch / gain jitter, so repeats never sound identical.
  //   • A sound whose file is not decoded yet is skipped (the first spin's
  //     sounds are decoded first, within a few hundred ms of the first gesture).
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

  // Bus levels (linear) under the master. UI sits ~12 dB under the game (its
  // files are levelled 4 dB under sfx, build-audio TARGET, and its bus is
  // -8 dB); music under both.
  const BUS_LEVEL = { sfx: 1, ui: 0.4, music: 0.42, ambience: 0.5 };
  // Music: crossfade between moods, and how far / how fast it ducks.
  const MUSIC_FADE_S = 0.8;
  const DUCK = { db: -9, attackS: 0.04, releaseS: 0.35 };
  // Per-play variation on file voices.
  const JITTER = { rate: 0.03, db: 1.5 };
  // One shared room (convolution reverb from the picked impulse response). Each
  // sound's send amount comes from the manifest (by loudness tier: UI dry,
  // frequent sounds close, wins and the feature open up); RETURN is the wet level.
  const REVERB = { returnGain: 0.9 };
  // Two loud hits on the same frame (a strike and its reveal, the big-win open
  // and its first tier) would stack into one clipped blob: the second one, if
  // it starts within `ms` of the first, sits `db` under it. Both stay on the
  // frame they belong to.
  const STACK = { ms: 20, db: -6 };
  const LOUD = new Set(["strike", "bang", "bang_big", "scatter_catch", "feature_award", "feature_more", "bigwin_open",
    "win_small", "win_big", "win_mega", "win_epic", "max_win", "combine", "combine_slam", "explode_great", "fs_intro", "fs_outro", "buy"]);

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
    lastLoudAt: -Infinity, // when the last LOUD voice started (STACK)
    lastVariant: new Map(), // sound key -> last variation index
    recent: [],        // probes: the last plays { name, key, file, bus, pan, rate, db, send, at }
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
    // Reverb: every voice with a send feeds reverbIn; the convolver gets its
    // impulse response once the manifest's IR is decoded (dry until then).
    const reverbIn = ctx.createGain();
    const convolver = ctx.createConvolver();
    const reverbOut = ctx.createGain();
    reverbOut.gain.value = REVERB.returnGain;
    reverbIn.connect(convolver);
    convolver.connect(reverbOut);
    reverbOut.connect(master);
    state.reverbIn = reverbIn;
    state.convolver = convolver;
    state.reverbReady = false;
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

  // --- events → sound keys ---------------------------------------------------
  // Each event returns how to voice one play: the manifest sound `key`, its
  // `bus`, a gain offset in dB, a playback `rate`, a stereo `pan` (-1..1) and
  // whether it `duck`s the music. `minGap` (ms) debounces rapid repeats.
  const colPan = (i, cols = 6) => clamp(((Number(i) || 0) / Math.max(1, cols - 1)) * 0.7 - 0.35, -0.35, 0.35);
  const semis = (n) => Math.pow(2, n / 12);
  const isGreat = (t) => /great|mega|epic|max/.test(String(t || ""));
  const SCATTER_STEPS = [0, 4, 7, 12]; // semitones: root, major 3rd, 5th, octave
  const EVENTS = {
    click: { minGap: 30, voice: () => ({ key: "ui_click", bus: "ui" }) },
    // Bet ±: the same click, a hair up or down.
    bet_change: { minGap: 20, voice: (o) => ({ key: "ui_click", bus: "ui", rate: o.up ? 1.06 : 0.94 }) },
    // On/off switches: one toggle, two semitones up for on, down for off (exact pitch).
    turbo_toggle: { minGap: 30, voice: (o) => ({ key: "ui_toggle", bus: "ui", rate: semis(o.on ? 2 : -2), jitter: false }) },
    // Every other on/off switch (ante, autoplay start/stop) shares turbo's pair.
    toggle: { minGap: 30, voice: (o) => ({ key: "ui_toggle", bus: "ui", rate: semis(o.on ? 2 : -2), jitter: false }) },
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
    // A scatter lands: one bell, stepped up a major triad per scatter on the
    // board (1st, 2nd, 3rd, 4th+ = root, 3rd, 5th, octave), a touch louder each
    // time; the one that completes the trigger rings fullest. Exact pitch (no
    // jitter), so the climb reads as music.
    scatter_land: { minGap: 30, voice: (o) => {
      const n = Math.max(1, Number(o.n) || 1);
      const step = SCATTER_STEPS[Math.min(n, SCATTER_STEPS.length) - 1] + Math.max(0, n - SCATTER_STEPS.length) * 2;
      const done = Number(o.need) > 0 && n >= Number(o.need);
      return { key: "scatter", bus: "sfx", rate: semis(Math.min(16, step)), db: -4 + Math.min(n, 4) + (done ? 1 : 0), jitter: false };
    } },
    // The scatters are caught (lock-on): the gong. A retrigger (+5) is the same
    // gong, lighter and a minor third up.
    scatter_catch: { minGap: 200, voice: (o) => ({ key: "scatter_catch", bus: "sfx", rate: o.retrigger ? semis(3) : 1, db: o.retrigger ? -3 : 0, duck: true }) },
    // The feature screen: free spins awarded / more free spins.
    feature_award: { minGap: 200, voice: (o) => ({ key: o.retrigger ? "feature_more" : "feature_award", bus: "sfx", duck: true }) },
    win_small: { voice: () => ({ key: "win_small", bus: "sfx", duck: true }) },
    win_big: { voice: () => ({ key: "win_big", bus: "sfx", duck: true }) },
    win_mega: { voice: () => ({ key: "win_mega", bus: "sfx", duck: true }) },
    win_epic: { voice: () => ({ key: "win_epic", bus: "sfx", duck: true }) },
    max_win: { voice: () => ({ key: "max_win", bus: "sfx", duck: true }) },
    // A winning cluster lights up (light), and the count-up lands (small win).
    win_light: { minGap: 60, voice: () => ({ key: "win_light", bus: "sfx", db: -5 }) },
    win_land: { minGap: 120, voice: () => ({ key: "win_land", bus: "sfx", duck: true }) },
    // The big-win overlay opens: a firework over a cannon, and the music dips.
    bigwin_open: { minGap: 200, voice: () => ({ key: "bigwin_open", bus: "sfx", duck: true }) },
    // The lightning strike, on the flash frame: crack + short thunder.
    multiplier_strike: { minGap: 40, voice: () => ({ key: "strike", bus: "sfx", duck: true }) },
    // The multiplier is revealed: its bell's pitch and weight follow the value,
    // 2x small and bright … 1000x huge and deep (a low blast joins from 50x).
    multiplier_drop: { minGap: 8, voice: (o) => {
      const v = Math.max(2, Number(o.value) || 2);
      const w = clamp(Math.log2(v / 2) / Math.log2(500), 0, 1); // 2x → 0, 1000x → 1
      return { key: v >= 50 ? "bang_big" : "bang", bus: "sfx", rate: 1.18 - 0.38 * w, db: -6 + 6 * w, duck: v >= 50, jitter: false };
    } },
    // Multipliers fly to the total: a whoosh as they leave, a glint as each
    // lands, pitched up with the total it lands on.
    soul_launch: { minGap: 60, voice: () => ({ key: "soul_launch", bus: "sfx", db: -6 }) },
    multiplier_catch: { minGap: 20, voice: (o) => ({ key: "catch", bus: "sfx", rate: semis(Math.min(9, Math.log2(Math.max(2, Number(o.value) || 2)) * 1.2)), jitter: false }) },
    // Win × Multiplier = Total: chips rise, slam, collide, the total lands.
    combine_enter: { minGap: 100, voice: () => ({ key: "combine_enter", bus: "sfx", db: -4 }) },
    combine_slam: { minGap: 100, voice: () => ({ key: "combine_slam", bus: "sfx" }) },
    multiplier_combine: { minGap: 100, voice: () => ({ key: "combine", bus: "sfx", duck: true }) },
    combine_total: { minGap: 100, voice: () => ({ key: "combine_total", bus: "sfx" }) },
    fs_intro: { voice: () => ({ key: "fs_intro", bus: "sfx", duck: true }) },
    fs_outro: { voice: () => ({ key: "fs_outro", bus: "sfx", duck: true }) },
    buy_feature: { voice: () => ({ key: "buy", bus: "sfx", duck: true }) },
    // A dialog's positive answer (play, continue): a touch fuller than a click.
    ui_confirm: { minGap: 60, voice: () => ({ key: "ui_confirm", bus: "ui" }) }
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
      .catch(() => null); // that variation is skipped (the others still play)
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
    }).then(() => Promise.all(Object.values(m.music || {}).map(loadFile)))
      .then(() => (m.ir ? loadFile(m.ir) : null))
      .then((ir) => { if (ir && state.convolver) { state.convolver.buffer = ir; state.reverbReady = true; } });
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
    // Pitched (musical) events keep their exact pitch: jitter only the rest.
    const jitterRate = v.jitter === false ? 0 : (Math.random() * 2 - 1) * JITTER.rate;
    src.playbackRate.value = (v.rate || 1) * (1 + jitterRate);
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
    // Its share of the room, after its own gain and pan (UI stays dry).
    const send = v.bus === "ui" ? 0 : (v.send != null ? v.send : (state.manifest && state.manifest.sends && state.manifest.sends[v.key]) || 0);
    if (send > 0 && state.reverbReady) {
      const sg = ctx.createGain();
      sg.gain.value = send;
      out.connect(sg);
      sg.connect(state.reverbIn);
    }
    src.connect(g);
    src.start();
    return { rate: src.playbackRate.value, db: 20 * Math.log10(Math.max(g.gain.value, 1e-6)), send };
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
  // Files come from the manifest; a mood starts once its file is decoded.
  const music = { mood: "base", prev: null, wanted: false, voice: null };

  function fadeOutVoice(v) {
    if (!v) return;
    const ctx = state.ctx;
    const now = ctx.currentTime;
    try {
      v.gain.gain.cancelScheduledValues(now);
      v.gain.gain.setTargetAtTime(0.0001, now, MUSIC_FADE_S / 3);
    } catch (e) { /* ignore */ }
    setTimeout(() => {
      try { if (v.src) v.src.stop(); v.gain.disconnect(); } catch (e) { /* ignore */ }
    }, MUSIC_FADE_S * 1000 + 600);
  }

  /** Start (or crossfade to) the current mood's file, once it is decoded. */
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
      music.voice = { mood, src, gain };
      return;
    }
    // Not decoded yet: keep what plays and crossfade once it is.
    if (path) loadFile(path).then((b) => { if (b && music.mood === mood) playMood(mood); });
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
    if (!state.ctx) { music.voice = null; return; }
    fadeOutVoice(music.voice);
    music.voice = null;
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

  // --- anticipation riser (scatter near-trigger) ---------------------------
  // A recorded air swell (the manifest's "riser"), looped for `ms`: its pitch
  // climbs (playback rate from → to, as a ratio of the A-110 reference) and a
  // low-pass opens, on the sfx bus. Never outlives the anticipation it scores.
  const drone = (() => {
    let nodes = null;
    function stop() {
      if (!nodes || !state.ctx) return;
      const n = nodes;
      nodes = null;
      const t = state.ctx.currentTime;
      n.gain.gain.cancelScheduledValues(t);
      n.gain.gain.setTargetAtTime(0, t, 0.06);
      setTimeout(() => { try { n.src.stop(); } catch (e) { /* already stopped */ } }, 400);
    }
    function start(ms, { from = 55, to = 110 } = {}) {
      stop();
      if (prefs.muted || state.suspended || !state.unlocked) return;
      const ctx = ensureContext();
      if (!ctx) return;
      if (ctx.state === "suspended") ctx.resume();
      const file = nextVariant("riser");
      if (!file) return;
      const t = ctx.currentTime;
      const dur = Math.max(0.3, ms / 1000);
      const src = ctx.createBufferSource();
      src.buffer = state.buffers.get(file);
      src.loop = true;
      src.playbackRate.setValueAtTime(0.75 * (from / 55), t);
      src.playbackRate.exponentialRampToValueAtTime(0.75 * (to / 55), t + dur);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.Q.value = 4;
      filter.frequency.setValueAtTime(500, t);
      filter.frequency.exponentialRampToValueAtTime(6000, t + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.7, t + dur * 0.85);
      src.connect(filter).connect(gain).connect(state.buses.sfx);
      src.start(t);
      nodes = { gain, src };
      remember({ name: "drone", key: "riser", file, bus: "sfx" });
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
    if (!ev) return;
    if (prefs.muted) return;
    // Parked in the background: drop the sound rather than resuming the context.
    // Timer-driven game state (autoplay, win count-ups) keeps advancing while
    // hidden, and without this every one of those steps would un-suspend the
    // audio hardware we just parked.
    if (state.suspended) return;
    // Before the first gesture the output cannot start: a sound scheduled now
    // would be held and burst out late once it does. Skip it instead.
    if (!state.unlocked) return;
    const ctx = ensureContext();
    if (!ctx) return;
    if (ctx.state === "suspended") ctx.resume();
    if (!state.manifestP) loadManifest();

    const minGap = ev.minGap || 0;
    if (minGap) {
      const now = performance.now();
      const last = state.lastPlay.get(name) || 0;
      if (now - last < minGap) return;
      state.lastPlay.set(name, now);
    }

    const v = Object.assign({ bus: "sfx", db: 0, rate: 1, pan: 0 }, ev.voice(opts || {}));
    const file = nextVariant(v.key);
    if (!file) return; // not decoded yet: skip rather than play anything else
    if (v.duck) duck(name === "win_small" ? 500 : 1100);
    if (LOUD.has(v.key)) {
      const now = performance.now();
      if (now - state.lastLoudAt < STACK.ms) v.db += STACK.db;
      else state.lastLoudAt = now;
    }
    try {
      const out = playFile(file, v);
      remember({ name, key: v.key, file, bus: v.bus, pan: v.pan || 0, at: performance.now(), ...out });
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

  // Fetch and decode every sound as soon as the page loads, not at the first
  // gesture: decoding works on a context that has not started yet, so by the
  // time the player taps Spin everything is ready and the very first spin is
  // fully voiced (the gesture only starts the output, in unlock()).
  function preloadOnLoad() {
    if (!ensureContext()) return;
    loadManifest();
  }
  if (root.document) {
    if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", preloadOnLoad, { once: true });
    else preloadOnLoad();
  }

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
    names: () => Object.keys(EVENTS),
    // Probes: the mix graph and the last plays, read-only.
    debug: {
      buses: () => Object.keys(state.buses),
      hasLimiter: () => Boolean(state.limiter),
      recent: () => state.recent.slice(),
      manifest: () => state.manifest,
      ext: () => state.ext,
      loaded: () => Array.from(state.buffers.keys()),
      ready: () => (state.manifestP || loadManifest()).then(() => true),
      unlocked: () => state.unlocked,
      reverbReady: () => state.reverbReady,
      music: () => ({ mood: music.mood, prev: music.prev, playing: music.voice ? music.voice.mood : null }),
      duckLevel: () => (state.duckNode ? state.duckNode.gain.value : 1),
      contexts: () => (state.ctx ? 1 : 0)
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
