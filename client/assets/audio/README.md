# Vault 20K: audio

The sound engine is `client/audio/audio.js`. It plays only the recordings listed
in `manifest.json` (no generated sounds). They are fetched and decoded as soon as
the page loads, so the first spin is fully voiced; the first tap only starts the
audio output (browser autoplay policy).

- `sfx/<key>_<n>.{ogg,m4a}`: 1-4 variations per sound key, mono, levelled per
  bus. The engine rotates them (never the same one twice in a row) with a small
  pitch and gain jitter.
- `music/{base,free_spins,big_win}.{ogg,m4a}`: the three music moods, stereo,
  seamless loops, crossfaded by the engine.
- `.ogg` (Opus) for browsers that decode it, `.m4a` (AAC) for Safari.
- `LICENSES.md`: the source and licence of every original (CC0 only).

## Changing a sound

1. Put the licensed original in `art-src/audio/` and add its row to `LICENSES.md`.
2. Edit its recipe (layers, gains, trim, fade) in `tools/build-audio.js`.
3. `node tools/build-audio.js`, then `node tools/build-audio.js --check`
   (licence rows, peaks, size budgets).

Game events → sound keys (bus, gain, pitch, pan, music duck) live in `EVENTS`
in `client/audio/audio.js`.
