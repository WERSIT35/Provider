(function (root) {
  "use strict";

  function decorateRules(rules) {
    const decorated = JSON.parse(JSON.stringify(rules));
    const symbols = decorated.symbol_payout_display?.symbols || [];
    for (const entry of symbols) {
      const code = String(entry.symbol || "").toUpperCase().replace(/\s+/g, "_");
      entry.asset_path = `assets/symbols/${code.toLowerCase()}.svg`;
    }
    return decorated;
  }

  async function loadRules(url = "math/game-rules-v2.json") {
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Failed to load rules: ${res.status}`);
    const raw = await res.json();
    return decorateRules(raw);
  }

  function getRtpProfileByGameId(rules, gameId) {
    const defaultGameId = String(rules.rtp_profiles?.[0]?.game_id || "bananax");
    const defaultScaler = Number(rules.rtp?.payout_scaler ?? 1.5);
    const gid = String(gameId || defaultGameId).toLowerCase();
    const fromProfiles = (rules.rtp_profiles || []).find(
      (p) => String(p.game_id || "").toLowerCase() === gid
    );
    const source = fromProfiles || rules.rtp || {};
    return {
      game_id: fromProfiles?.game_id || defaultGameId,
      slug: fromProfiles?.slug || "",
      theoretical_percent: Number(source.theoretical_percent ?? rules.rtp?.theoretical_percent ?? 96),
      ante_bet_percent: Number(source.ante_bet_percent ?? source.theoretical_percent ?? 96),
      buy_free_spins_percent: Number(source.buy_free_spins_percent ?? source.theoretical_percent ?? 96),
      payout_scaler: Number(source.payout_scaler ?? rules.rtp?.payout_scaler ?? defaultScaler),
      base_payout_scaler: Number(
        source.base_payout_scaler ?? source.payout_scaler ?? rules.rtp?.payout_scaler ?? defaultScaler
      ),
      free_spin_payout_scaler: Number(
        source.free_spin_payout_scaler ?? source.payout_scaler ?? rules.rtp?.payout_scaler ?? defaultScaler
      ),
      target_band_min: Number(source.target_band_min ?? rules.rtp?.target_band_min ?? 0),
      target_band_max: Number(source.target_band_max ?? rules.rtp?.target_band_max ?? 100),
      target_tolerance_percent: Number(source.target_tolerance_percent ?? rules.rtp?.target_tolerance_percent ?? 0.05)
    };
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.Config = { decorateRules, loadRules, getRtpProfileByGameId };
})(typeof window !== "undefined" ? window : globalThis);
