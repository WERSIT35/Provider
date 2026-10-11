"use strict";

// The sound redesign's event map: what each beat should sound like, and how to
// find CC0 candidates for it on Freesound (search terms, longest usable take).
// tools/audition/fetch-candidates.js reads this; the audition page shows it.
// tier: UI < base < win < feature < peak (loudness order of the final mix).

module.exports = [
  // ── UI ──
  { id: "ui_click", group: "UI", tier: "ui", brief: "Soft, premium, felt-like button click (high-end phone UI). Very short, no tail.", maxS: 0.35, queries: ["soft click button", "felt click", "tactile click", "keyboard click soft"] },
  { id: "ui_toggle", group: "UI", tier: "ui", brief: "Subtle switch for on/off (pitched up for on, down for off). Under 80 ms.", maxS: 0.4, queries: ["switch toggle", "light switch", "small switch click"] },
  { id: "ui_confirm", group: "UI", tier: "ui", brief: "A dialog's yes: a touch fuller than a click, soft pop or wood tap.", maxS: 0.5, queries: ["soft pop", "wood tap soft", "button press soft"] },

  // ── Base game ──
  { id: "spin_start", group: "Base game", tier: "base", brief: "Short punchy mechanical engage: vault-dial ratchet or heavy latch release, soft air push. Under 400 ms.", maxS: 1.2, queries: ["latch release metal", "safe dial", "ratchet click", "vault lock", "lever pull"] },
  { id: "reel_stop", group: "Base game", tier: "base", brief: "One per reel: solid, damped metal or wood thunk (panned by column).", maxS: 1.2, queries: ["heavy thud", "wood thunk", "drawer close", "metal thud"] },
  { id: "tick", group: "Base game", tier: "base", brief: "Each symbol landing: barely there, a soft crystal or wood tap.", maxS: 0.5, queries: ["glass tap", "crystal tap", "wood tap", "marble click"] },
  { id: "refill", group: "Base game", tier: "base", brief: "Tumble refill: soft air rush (brightens each chain step).", maxS: 1.2, queries: ["whoosh soft", "air swoosh", "swish"] },

  // ── Wins ──
  { id: "win_light", group: "Wins", tier: "win", brief: "A winning cluster lights up: bright metallic or crystal shimmer (scaled by win size).", maxS: 3, queries: ["crystal shimmer", "chime sparkle", "glass chime", "magic sparkle"] },
  { id: "explode", group: "Wins", tier: "win", brief: "Cluster burst: glass or crystal shatter with a low thump (bigger cluster = fuller).", maxS: 2.5, queries: ["glass shatter", "glass break", "crystal break"] },
  { id: "win_tick", group: "Wins", tier: "base", brief: "Win count-up tick: one coin or chip clink (speeds up during the count).", maxS: 0.6, queries: ["coin drop", "coin clink", "poker chip", "coin single"] },
  { id: "win_land", group: "Wins", tier: "win", brief: "The count-up lands (small win): coins settling, short.", maxS: 2.5, queries: ["coins pour", "coins jingle", "coins drop pile"] },
  { id: "combine_total", group: "Wins", tier: "win", brief: "Win × multiplier: the total locks in, coins or a register ching.", maxS: 2.5, queries: ["cash register", "coins stack", "coin purse"] },

  // ── Multipliers ──
  { id: "strike", group: "Multipliers", tier: "win", brief: "Lightning strike on the flash: real electric crack + short thunder tail.", maxS: 4, queries: ["electric spark", "electricity zap", "thunder crack", "tesla coil"] },
  { id: "bang", group: "Multipliers", tier: "win", brief: "Multiplier reveal: gold bell or anvil hit (weight scales with value).", maxS: 3.5, queries: ["anvil hit", "metal bell hit", "bell strike", "church bell single"] },
  { id: "soul_launch", group: "Multipliers", tier: "base", brief: "Multipliers fly to the total: a fast clean whoosh.", maxS: 1, queries: ["whoosh fast", "swish fast", "fly by"] },
  { id: "catch", group: "Multipliers", tier: "win", brief: "Arrival on the total: a satisfying metallic lock-in click.", maxS: 1.2, queries: ["lock click metal", "lock mechanism", "latch lock", "padlock close"] },
  { id: "combine_slam", group: "Multipliers", tier: "win", brief: "Win and multiplier chips collide: heavy metal impact.", maxS: 2.5, queries: ["metal impact heavy", "impact hit", "punch heavy"] },

  // ── Scatters & feature ──
  { id: "scatter", group: "Scatters & feature", tier: "win", brief: "Scatter lands: one tuned bell (stepped up per scatter 1-2-3-4).", maxS: 3.5, queries: ["bell ding", "handbell", "tuned bell", "singing bowl"] },
  { id: "riser", group: "Scatters & feature", tier: "win", brief: "One scatter away: sustained, rising tension bed until the board settles (looped).", maxS: 8, queries: ["riser tension", "tension build", "reverse cymbal", "suspense rising"] },
  { id: "scatter_catch", group: "Scatters & feature", tier: "feature", brief: "The scatters lock on: big gong or bell, bigger than any base sound.", maxS: 6, queries: ["gong", "big bell hit", "temple bell"] },
  { id: "vault_slam", group: "Scatters & feature", tier: "feature", brief: "Layer for the feature trigger: a heavy vault or safe door slam.", maxS: 3.5, queries: ["vault door", "heavy door slam metal", "safe door close", "iron door slam"] },
  { id: "feature_award", group: "Scatters & feature", tier: "feature", brief: "Feature trigger: short orchestral or brass fanfare (with the vault slam).", maxS: 6, queries: ["orchestral fanfare", "brass fanfare", "fanfare short"] },
  { id: "feature_more", group: "Scatters & feature", tier: "feature", brief: "Retrigger +5: a lighter cousin of the fanfare (a short stab).", maxS: 3.5, queries: ["orchestra hit", "brass stab", "orchestral stab", "horn stab", "orchestra hit short"] },
  { id: "fs_intro", group: "Scatters & feature", tier: "feature", brief: "Free spins begin: cinematic swell into the bonus.", maxS: 7, queries: ["cinematic swell", "orchestral swell", "orchestra crescendo", "brass swell", "cinematic rise"] },
  { id: "fs_outro", group: "Scatters & feature", tier: "feature", brief: "Feature ends: a summary sting (scaled to the feature's win).", maxS: 6, queries: ["orchestral ending", "orchestra finale", "orchestral sting", "fanfare ending", "timpani roll", "brass ending"] },

  // ── Big wins ──
  { id: "bigwin_open", group: "Big wins", tier: "peak", brief: "Big-win overlay opens: cinematic impact.", maxS: 5, queries: ["cinematic impact", "trailer hit", "cinematic boom", "orchestral impact", "epic impact"] },
  { id: "sub_impact", group: "Big wins", tier: "peak", brief: "Layer for big moments: deep sub boom.", maxS: 5, queries: ["sub boom", "sub drop", "deep boom"] },
  { id: "win_big", group: "Big wins", tier: "peak", brief: "Big win tier: orchestral hit.", maxS: 5, queries: ["orchestral hit", "epic hit", "orchestra hit big", "cinematic hit horns", "orchestral cymbal hit"] },
  { id: "win_mega", group: "Big wins", tier: "peak", brief: "Mega / Epic tier: orchestra + choir hit, bigger than Big.", maxS: 6, queries: ["choir hit", "orchestral hit epic", "brass hit", "choir orchestra hit", "orchestra stab", "epic choir hit"] },
  { id: "max_win", group: "Big wins", tier: "peak", brief: "Max win: the biggest moment in the game. Orchestra, choir, sub.", maxS: 10, queries: ["epic cinematic climax", "orchestral climax", "epic choir"] },
  { id: "buy", group: "Big wins", tier: "feature", brief: "Buy feature confirmed: coins handed over, a solid ching.", maxS: 2.5, queries: ["coins handful", "cash register ching", "coins bag"] },

  // ── Space ──
  { id: "reverb_ir", group: "Space", tier: "ui", brief: "Impulse response for the shared reverb send (a hall or warm room). Played dry here.", maxS: 6, queries: ["impulse response hall", "impulse response room", "impulse response church", "IR reverb", "impulse response"], must: "impulse|\bIR\b|reverb" }
];
