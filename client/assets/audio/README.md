# Banana X — audio assets (optional)

The game ships with a **synthesized** sound engine (`client/engine/audio.js`) that
needs no files. This folder is the drop-in path for upgrading to real audio.

## How to use real sound files

1. Drop an audio file here (`.mp3`, `.ogg`, or `.wav` — keep them short, ~<200 KB).
2. In `client/engine/audio.js`, add a `src` to the matching `SFX` entry, e.g.:

   ```js
   win_big: {
     src: "win_big.mp3",            // <-- relative to assets/audio/
     synth: (c, d) => { ...existing fallback... }
   },
   ```

When a `src` is present and decodes successfully, `Sound.play()` uses the file;
otherwise it falls back to the synth automatically. No caller changes needed.

## Manifest keys (events the game triggers)

| key                  | when it fires                              |
| -------------------- | ------------------------------------------ |
| `click`              | generic button press                       |
| `bet_change`         | bet +/- (opts: `{up}`)                     |
| `turbo_toggle`       | turbo on/off (opts: `{on}`)                |
| `spin_start`         | a spin begins                              |
| `reel_stop`          | a reel/column lands (opts: `{index}`)      |
| `tumble`             | a cascade drop step (opts: `{step}`)       |
| `explode`            | winning symbols explode (opts: `{tier}`)   |
| `win_tick`           | win meter count-up tick (opts: `{progress}`)|
| `win_small`          | small win reveal                           |
| `win_big`            | big win reveal                             |
| `win_mega`           | mega win reveal                            |
| `multiplier_catch`   | a multiplier is caught (opts: `{value}`)   |
| `multiplier_combine` | multipliers combine (opts: `{value}`)      |
| `bonus_trigger`      | free spins / bonus triggered               |
| `buy_feature`        | Buy Feature confirmed                      |
| `max_win`            | max win cap hit                            |
