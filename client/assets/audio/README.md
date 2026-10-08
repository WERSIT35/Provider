# Vault 20K: audio

The sound engine is `client/audio/audio.js`. It plays the files listed in
`manifest.json` and falls back to its synthesized voices until a file is decoded
(or if one is missing), so the game is never silent.

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
