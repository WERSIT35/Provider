# Notification & popup skeleton (#49)

Every popup in the Vault 20K client goes through one component, `VxNotify` in
`client/notify.js`. A new skin, or a new game on this client, swaps visuals and
sounds; it never rebuilds a popup's structure or its behaviour.

## What runs through it

| Name | Kind | Root | Closes on | Reasons |
|------|------|------|-----------|---------|
| `feature` | feature | `#featureScreen` (over the board) | a tap anywhere, or `dismissFeature()` | `tap`, `dismissed` |
| `buyConfirm` | modal | `#buyConfirmModal` | Buy / Cancel, Esc, Enter, backdrop | `confirm`, `cancel` |
| `reality` | modal | `#realityCheck` | its two buttons only | `continue`, `leave` |
| `info` | modal | `#psInfoModal` (rules / settings) | ✕, Esc, backdrop | `closed` |
| `freeRounds` | modal | `#frModal` (operator free rounds) | Play, Esc, Enter, Space, backdrop | `play` |
| `bigwin` | bigwin | `#bigWinOverlay` | `BigWinController` | `done` |
| `winCombine` | celebration | built on demand in the reel stage | its timer | `timeout` |
| banner | banner | the ticker (no DOM of its own) | its duration | — |

Kinds:

- **modal** owns the keyboard while it is the top-most open modal. Tab is
  trapped inside it. Esc and Enter act only as its `dismiss` rules say. Enter
  on a focused button is that button's own click. Space never reaches the game
  (it would spin). The focus goes back to whatever had it when the modal
  opened.
- **feature** is a full-board screen.
- **bigwin**: the skeleton only tracks it (`external: true`), and
  `BigWinController` draws it.
- **celebration** is a self-closing overlay that is built, shown and removed.
- **banner** adapts the ticker's transient line (`ticker.flash`), the game's
  single message line.

## The DOM contract

On the root, everything optional except the root itself:

```html
<div id="…">                         <!-- the skeleton adds: class "vx-n vx-n--<kind>", data-vx-state, aria-hidden -->
  <div data-vx-slot="art"></div>      <!-- shows the skin's art (--vx-n-art) -->
  <p   data-vx-slot="kicker"></p>
  <h2  data-vx-slot="title"></h2>
  <p   data-vx-slot="body"></p>
  <div data-vx-slot="actions">
    <button data-vx-close="cancel">Cancel</button>
    <button data-vx-close="confirm" data-vx-autofocus>Buy</button>
  </div>
</div>
```

- `data-vx-close="<reason>"` closes the popup, and `open()` resolves with that reason.
- `data-vx-autofocus` marks what gets the focus when a modal opens.
- Visibility follows each root's existing stylesheet, set per registration:
  - `visibility: "attr"` toggles the `hidden` attribute.
  - `"class"` toggles `.hidden`.
  - `"state"` sets only `data-vx-state`, and the CSS fades it.
- Each root also gets `data-vx-state="open|closed"`. A closed root never takes
  a click (`.vx-n[data-vx-state="closed"]`).
- Every popup sits outside the document flow, so opening one never moves the
  board. The probe checks this with a per-frame bounding-box watch.

## API

```js
// Register once (main.js, "Notifications (#49)").
VxNotify.register("buyConfirm", root, {
  kind: "modal",                       // modal | feature | bigwin | celebration | banner
  visibility: "class",                 // attr | class | state
  dismiss: { backdrop: "cancel", escape: "cancel", enter: "confirm" }, // or { anywhere: "tap" }
  audio: { open: "click", close: null, confirm: "buy_feature" },        // window.Sound names
  fill: (slots, data) => { slots.title.textContent = data.title; },     // optional
  onKey: (e) => false                  // extra keys for a modal (return true when handled)
});

const reason = await VxNotify.open("buyConfirm", data);  // resolves with the close reason
VxNotify.close("feature", "dismissed");
VxNotify.isOpen("info"); VxNotify.anyModalOpen(); VxNotify.openNames();

// A celebration built on demand, removed when its time is up.
await VxNotify.celebrate("winCombine", stageEl, (root) => { /* build */ }, { ms: 2660, className: "win-combine-overlay" });

// The ticker's transient line.
VxNotify.banner("Feature bought", "bonus", 900);

// One event stream for every popup (analytics, audio ducking, embed bridge…).
VxNotify.on("open",  ({ name, kind }) => {});
VxNotify.on("close", ({ name, kind, reason }) => {});
// The root also dispatches DOM events: vx:open / vx:close (bubbling).
```

## Skinning: swap assets and audio, keep the skeleton

```js
VxNotify.skin("feature", {
  className: "skin-pharaoh",                       // extra classes on the root
  assets: { art: "assets/skins/pharaoh/feature.webp", "--feature-accent": "#ffcf6b" },
  audio: { open: "feature_open", close: "feature_close" }
});
```

- `assets.art` (or any key) becomes a CSS custom property on the root. A URL
  is wrapped in `url(...)`, and a bare key `k` becomes `--vx-n-k`.
- `[data-vx-slot="art"]` shows `--vx-n-art`. A skin's stylesheet can use any of
  the other properties.
- `audio` names play through `window.Sound.play(name)`, so a skin only adds
  sounds to the sound bank. Nothing in the popup's DOM or lifecycle changes.

## Verified by

`tools/probes/motion-probe.js`, section "notification skeleton". It drives
every popup with real key presses (Esc, Enter, Tab, Space) and checks:

- the feature slots are filled and a tap closes the screen
- buy confirm: autofocus, Tab trap, Space never spins, Esc cancels, Enter on
  Cancel cancels, Enter confirms
- the info modal opens on its section, pages with the arrows, closes on Esc and
  returns the focus to the opener
- Space closes the free-rounds notice
- Esc cannot dismiss the reality check
- the big win is tracked
- the win-combine overlay is built and removed
- the banner shows on the ticker
- skins swap the class, the art and the sound
- one event stream reports every open and close with its reason
- the board moves 0px throughout

The platform's `check:resume`, `check:embed` and `check:campaigns` and the
demo casino's `check:casino-embed` drive the same popups through their
existing ids and classes.
