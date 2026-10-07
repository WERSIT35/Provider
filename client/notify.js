// Vault 20K — unified notification & popup skeleton (#49).
//
// Every popup the game shows (the feature-trigger screen, the big-win
// celebration, the win-combine finale, the info / buy / reality-check /
// free-rounds modals and the ticker's transient notices) goes through ONE
// lifecycle here, so a new skin or a new game only swaps visuals and sounds,
// never the skeleton. See docs/notification-skeleton.md.
//
// A notification is a root element registered under a name, with a kind:
//   modal        dialog that owns the keyboard (Tab trapped, focus restored
//                on close) until it is dismissed
//   feature      full-board screen dismissed by a tap anywhere (or a timer)
//   bigwin       the big-win overlay; its CONTENT is BigWinController's, the
//                skeleton tracks its lifecycle (external: true)
//   celebration  a short self-closing overlay built on demand (win combine)
//   banner       the ticker's transient line: no DOM of its own (adapter)
//
// Skeleton contract on the root (all optional except the root):
//   [data-vx-slot="art|kicker|title|body|actions"]   content slots
//   [data-vx-close="<reason>"]                       closes with that reason
//   [data-vx-autofocus]                              focused on open
// The skeleton sets on the root: class `vx-n vx-n--<kind>`, data-vx-state
// (open | closed), aria-hidden, and (by `visibility`) the hidden attribute or
// the .hidden class, so every existing stylesheet keeps working. Overlays
// stay outside the document flow: opening one never moves the board.
//
// Skins: VxNotify.skin(name, { className, assets: { art: url, ...cssVars },
// audio: { open, close, confirm } }) swaps a notification's look and sounds
// without touching its DOM. Sounds play through window.Sound.play(name).
(function () {
  "use strict";

  const KIND_LAYER = { banner: 0, celebration: 1, feature: 2, bigwin: 3, modal: 4 };
  const registry = new Map(); // name → NotificationSkeleton
  const listeners = new Map(); // event → Set<fn>
  const openStack = []; // open notifications, oldest first

  function emit(type, detail) {
    for (const fn of listeners.get(type) || []) {
      try { fn(detail); } catch (e) { console.error(e); }
    }
  }

  function playSound(name) {
    if (name) window.Sound?.play(name);
  }

  function focusables(root) {
    return [...root.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")]
      .filter((n) => !n.disabled && n.getClientRects().length > 0);
  }

  class NotificationSkeleton {
    /**
     * @param {string} name
     * @param {HTMLElement} root
     * @param {object} opts
     *   kind        modal | feature | bigwin | celebration | banner
     *   visibility  "attr" (hidden attribute), "class" (.hidden) or "state"
     *               (data-vx-state only: the CSS fades it)
     *   external    true: something else shows/hides the root (bigwin)
     *   dismiss     { backdrop, escape, enter, anywhere }: reasons or false.
     *               e.g. { escape: "cancel", enter: "confirm" }
     *   audio       { open, close, confirm } sound names
     *   onKey(e)    extra keyboard handling while open (modal); return true
     *               when the key was handled
     *   fill(slots, data)  writes `data` into the slots on open
     */
    constructor(name, root, opts = {}) {
      this.name = name;
      this.root = root;
      this.kind = opts.kind || "modal";
      this.visibility = opts.visibility || "attr";
      this.external = Boolean(opts.external);
      this.dismiss = opts.dismiss || {};
      this.audio = { ...(opts.audio || {}) };
      this.onKey = opts.onKey || null;
      this.fill = opts.fill || null;
      this.state = "closed";
      this._resolve = null;
      this._opener = null;
      this._skinClass = "";
      this._onKeyDown = (e) => this._key(e);
      this._onClick = (e) => this._click(e);
      root.classList.add("vx-n", `vx-n--${this.kind}`);
      root.style.setProperty("--vx-n-layer", String(KIND_LAYER[this.kind] ?? 1));
      // An external root (bigwin) shows and hides itself: only its state is tracked.
      if (this.external) root.dataset.vxState = "closed";
      else {
        this._paint(false);
        root.addEventListener("click", this._onClick);
      }
    }

    get isOpen() { return this.state === "open"; }

    /** The named slots of this notification (data-vx-slot). */
    slots() {
      const out = {};
      this.root.querySelectorAll("[data-vx-slot]").forEach((n) => { out[n.dataset.vxSlot] = n; });
      return out;
    }

    /** Open it (filling the slots with `data`). Resolves with the close
     *  reason. Opening an open one first closes it with "replaced". */
    open(data) {
      if (this.isOpen) this.close("replaced");
      if (data !== undefined && this.fill) this.fill(this.slots(), data);
      this.state = "open";
      this._opener = document.activeElement;
      if (!this.external) this._paint(true);
      this.root.dataset.vxState = "open";
      openStack.push(this);
      if (this.kind === "modal") document.addEventListener("keydown", this._onKeyDown, true);
      else if (this.dismiss.escape || this.dismiss.enter) document.addEventListener("keydown", this._onKeyDown);
      playSound(this.audio.open);
      if (this.kind === "modal" && !this.external) {
        const target = this.root.querySelector("[data-vx-autofocus]") || focusables(this.root)[0] || this.root;
        setTimeout(() => { if (this.isOpen) target.focus?.(); }, 0);
      }
      emit("open", { name: this.name, kind: this.kind });
      this.root.dispatchEvent(new CustomEvent("vx:open", { bubbles: true, detail: { name: this.name } }));
      return new Promise((resolve) => { this._resolve = resolve; });
    }

    /** Close it with `reason` (the open() promise resolves with it). */
    close(reason = "closed") {
      if (!this.isOpen) return;
      this.state = "closed";
      if (!this.external) this._paint(false);
      this.root.dataset.vxState = "closed";
      const i = openStack.indexOf(this);
      if (i >= 0) openStack.splice(i, 1);
      document.removeEventListener("keydown", this._onKeyDown, true);
      document.removeEventListener("keydown", this._onKeyDown);
      playSound(reason === "confirm" ? this.audio.confirm || this.audio.close : this.audio.close);
      if (this.kind === "modal" && this._opener && typeof this._opener.focus === "function" && document.contains(this._opener)) {
        this._opener.focus();
      }
      this._opener = null;
      const resolve = this._resolve;
      this._resolve = null;
      emit("close", { name: this.name, kind: this.kind, reason });
      this.root.dispatchEvent(new CustomEvent("vx:close", { bubbles: true, detail: { name: this.name, reason } }));
      resolve?.(reason);
    }

    /** Swap the look and sounds (VxNotify.skin). */
    applySkin({ className = "", assets = {}, audio = {} } = {}) {
      if (this._skinClass) this.root.classList.remove(...this._skinClass.split(/\s+/).filter(Boolean));
      this._skinClass = className;
      if (className) this.root.classList.add(...className.split(/\s+/).filter(Boolean));
      for (const [k, v] of Object.entries(assets)) {
        const prop = k.startsWith("--") ? k : `--vx-n-${k}`;
        this.root.style.setProperty(prop, /^(https?:|data:|\/|\.\.?\/|assets\/)/.test(String(v)) ? `url("${v}")` : String(v));
      }
      Object.assign(this.audio, audio);
    }

    _paint(open) {
      const r = this.root;
      if (this.visibility === "attr") r.hidden = !open;
      else if (this.visibility === "class") r.classList.toggle("hidden", !open);
      r.setAttribute("aria-hidden", open ? "false" : "true");
      r.dataset.vxState = open ? "open" : "closed";
    }

    _click(e) {
      if (!this.isOpen) return;
      const closer = e.target.closest?.("[data-vx-close]");
      if (closer && this.root.contains(closer)) {
        this.close(closer.dataset.vxClose || "closed");
        return;
      }
      if (this.dismiss.anywhere) {
        this.close(this.dismiss.anywhere);
        return;
      }
      if (this.dismiss.backdrop && e.target === this.root) this.close(this.dismiss.backdrop);
    }

    _key(e) {
      if (!this.isOpen) return;
      // Only the top-most open modal owns the keyboard.
      if (this.kind === "modal" && openStack.filter((n) => n.kind === "modal").pop() !== this) return;
      if (this.onKey && this.onKey(e)) return;
      if (e.key === "Escape" && this.dismiss.escape) {
        e.preventDefault();
        e.stopPropagation();
        this.close(this.dismiss.escape);
        return;
      }
      // Enter on a focused button inside is that button's own click.
      const onButton = e.target?.closest?.("button") && this.root.contains(e.target);
      if ((e.key === "Enter" || (e.key === " " && this.dismiss.space)) && this.dismiss.enter && !(e.key === "Enter" && onButton)) {
        e.preventDefault();
        e.stopPropagation();
        this.close(this.dismiss.enter);
        return;
      }
      if (this.kind !== "modal") return;
      if (e.key === " " && !e.target.closest?.("button, input, select, textarea")) {
        e.preventDefault(); // Space must never reach the game (it spins) while a modal is up
        e.stopPropagation();
        return;
      }
      if (e.key !== "Tab") return;
      const f = focusables(this.root);
      if (!f.length) { e.preventDefault(); return; }
      const first = f[0];
      const last = f[f.length - 1];
      const inside = this.root.contains(document.activeElement);
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  const VxNotify = {
    NotificationSkeleton,
    /** Register `root` under `name` (see NotificationSkeleton for opts). */
    register(name, root, opts) {
      if (!root) return null;
      const n = new NotificationSkeleton(name, root, opts);
      registry.set(name, n);
      return n;
    },
    get(name) { return registry.get(name) || null; },
    open(name, data) {
      const n = registry.get(name);
      return n ? n.open(data) : Promise.resolve("missing");
    },
    close(name, reason) { registry.get(name)?.close(reason); },
    isOpen(name) { return Boolean(registry.get(name)?.isOpen); },
    /** True while any modal (it owns the keyboard) is open. */
    anyModalOpen() { return openStack.some((n) => n.kind === "modal"); },
    /** Names of the open notifications, oldest first. */
    openNames() { return openStack.map((n) => n.name); },
    /** Swap a notification's look and sounds (see the header). */
    skin(name, spec) { registry.get(name)?.applySkin(spec); },
    on(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
      return () => listeners.get(type).delete(fn);
    },
    /**
     * A celebration built on demand: `build(root)` fills a fresh root, which
     * is appended to `host`, opened, and removed after `ms` (or when closed).
     * Resolves with the close reason.
     */
    celebrate(name, host, build, { ms, className = "", audio = {} } = {}) {
      const root = document.createElement("div");
      if (className) root.className = className;
      build(root);
      host.appendChild(root);
      const n = new NotificationSkeleton(name, root, { kind: "celebration", visibility: "state", audio, dismiss: {} });
      registry.set(name, n);
      const done = n.open();
      const timer = ms > 0 ? setTimeout(() => n.close("timeout"), ms) : 0;
      return done.then((reason) => {
        clearTimeout(timer);
        root.remove();
        if (registry.get(name) === n) registry.delete(name);
        return reason;
      });
    },
    /** The banner adapter: a transient line on the ticker (the game's single
     *  message line), set by the game with setBanner(fn). */
    banner(text, tone = "info", ms = 860) {
      emit("open", { name: "banner", kind: "banner", text, tone });
      bannerImpl?.(text, tone, ms);
    },
    setBanner(fn) { bannerImpl = fn; }
  };
  let bannerImpl = null;

  window.VxNotify = VxNotify;
})();
