(function (root) {
  "use strict";

  const KEY = "bananax.session.v1";

  function getStorage(storage) {
    return storage || root.localStorage || null;
  }

  function loadSession(storage) {
    const s = getStorage(storage);
    if (!s) return null;
    try {
      const raw = s.getItem(KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function saveSession(session, storage) {
    const s = getStorage(storage);
    if (!s) return;
    try {
      const persisted = {
        sessionId: session.sessionId,
        playerId: session.playerId,
        currency: session.currency,
        locale: session.locale,
        gameId: session.gameId,
        balance: session.balance,
        freeSpinsLeft: session.freeSpinsLeft,
        freeSpinPersistentMultiplier: session.freeSpinPersistentMultiplier,
        bonusRoundWin: session.bonusRoundWin,
        anteEnabled: session.anteEnabled,
        crazyMode: session.crazyMode,
        createdAt: session.createdAt
      };
      s.setItem(KEY, JSON.stringify(persisted));
    } catch {}
  }

  function clearSession(storage) {
    const s = getStorage(storage);
    if (!s) return;
    try { s.removeItem(KEY); } catch {}
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.SessionStore = { loadSession, saveSession, clearSession, KEY };
})(typeof window !== "undefined" ? window : globalThis);
