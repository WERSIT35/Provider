const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, "..");
const CLIENT_DIR = path.join(ROOT, "client");
const MATH_DIR = path.join(ROOT, "math");

const paytable = JSON.parse(
  fs.readFileSync(path.join(MATH_DIR, "paytable-v1.json"), "utf8")
);
const reelStrips = JSON.parse(
  fs.readFileSync(path.join(MATH_DIR, "reel-strips-v1.json"), "utf8")
);

const sessions = new Map();
const ALLOWED_BETS = [0.2, 0.5, 1, 2, 5, 10];

const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [0, 2, 2, 2, 0]
];

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function createSession({ player_id, currency, locale, game_id }) {
  const sessionId = crypto.randomUUID();
  const session = {
    sessionId,
    playerId: player_id || `player_${Date.now()}`,
    currency: currency || "GEL",
    locale: locale || "en",
    gameId: game_id || "project-khma",
    balance: 1000,
    freeSpinsLeft: 0,
    bonusMultiplier: 1,
    spinHistory: new Map(),
    createdAt: new Date().toISOString()
  };
  sessions.set(sessionId, session);
  return session;
}

function randomInt(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

function generateMatrix() {
  const matrix = [[], [], []];
  const reels = reelStrips.reels;
  for (let reelIndex = 0; reelIndex < reels.length; reelIndex += 1) {
    const strip = reels[reelIndex];
    const stop = randomInt(strip.length);
    for (let row = 0; row < 3; row += 1) {
      matrix[row][reelIndex] = strip[(stop + row) % strip.length];
    }
  }
  return matrix;
}

function maybeApplyExpandingWild(matrix, isFreeSpin) {
  const chance = isFreeSpin ? 0.12 : 0.08;
  if (Math.random() >= chance) {
    return { matrix, expandedReel: null };
  }
  const expandedReel = randomInt(5);
  const next = matrix.map((r) => r.slice());
  for (let row = 0; row < 3; row += 1) {
    next[row][expandedReel] = "WILD";
  }
  return { matrix: next, expandedReel };
}

function countScatters(matrix) {
  let count = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let reel = 0; reel < 5; reel += 1) {
      if (matrix[row][reel] === "SCATTER") count += 1;
    }
  }
  return count;
}

function evaluateLine(lineSymbols, betPerLine, multiplier) {
  const regularSymbols = Object.keys(paytable.symbols).filter(
    (s) => s !== "SCATTER"
  );
  let best = 0;
  let bestSymbol = null;
  let bestCount = 0;

  for (const symbol of regularSymbols) {
    let count = 0;
    for (let i = 0; i < lineSymbols.length; i += 1) {
      const sym = lineSymbols[i];
      const matches = sym === symbol || (sym === "WILD" && symbol !== "SCATTER");
      if (!matches) break;
      count += 1;
    }
    if (count >= 3) {
      const payout = paytable.symbols[symbol]?.[String(count)] || 0;
      const value = payout * betPerLine * multiplier;
      if (value > best) {
        best = value;
        bestSymbol = symbol;
        bestCount = count;
      }
    }
  }

  return {
    amount: Number(best.toFixed(2)),
    symbol: bestSymbol,
    count: bestCount
  };
}

function evaluateSpin(matrix, totalBet, bonusMultiplier) {
  const lineBet = totalBet / PAYLINES.length;
  let lineWinsTotal = 0;
  const lineWins = [];

  for (let lineIndex = 0; lineIndex < PAYLINES.length; lineIndex += 1) {
    const payline = PAYLINES[lineIndex];
    const symbols = payline.map((row, reel) => matrix[row][reel]);
    const result = evaluateLine(symbols, lineBet, bonusMultiplier);
    if (result.amount > 0) {
      lineWinsTotal += result.amount;
      lineWins.push({
        lineIndex,
        symbol: result.symbol,
        count: result.count,
        amount: result.amount
      });
    }
  }

  const scatterCount = countScatters(matrix);
  const scatterMul = paytable.symbols.SCATTER[String(scatterCount)] || 0;
  const scatterWin = Number((scatterMul * totalBet).toFixed(2));

  const trigger = paytable.scatter_triggers[String(scatterCount)];
  const freeSpinsAwarded = trigger ? trigger.free_spins : 0;

  return {
    lineWins,
    lineWinsTotal: Number(lineWinsTotal.toFixed(2)),
    scatterCount,
    scatterWin,
    freeSpinsAwarded,
    totalWin: Number((lineWinsTotal + scatterWin).toFixed(2))
  };
}

function resolveSpin(session, spinId, betAmount) {
  if (session.spinHistory.has(spinId)) {
    return session.spinHistory.get(spinId);
  }

  const isFreeSpin = session.freeSpinsLeft > 0;
  if (!isFreeSpin && session.balance < betAmount) {
    throw new Error("INSUFFICIENT_FUNDS");
  }

  if (!isFreeSpin) {
    session.balance = Number((session.balance - betAmount).toFixed(2));
  } else {
    session.freeSpinsLeft -= 1;
  }

  const baseMatrix = generateMatrix();
  const withFeature = maybeApplyExpandingWild(baseMatrix, isFreeSpin);
  const activeMultiplier = isFreeSpin ? session.bonusMultiplier : 1;
  const evaluation = evaluateSpin(withFeature.matrix, betAmount, activeMultiplier);

  if (evaluation.freeSpinsAwarded > 0) {
    if (isFreeSpin) {
      session.freeSpinsLeft += 5;
      session.bonusMultiplier = Math.min(5, session.bonusMultiplier + 1);
    } else {
      session.freeSpinsLeft += evaluation.freeSpinsAwarded;
      session.bonusMultiplier = 2;
    }
  }

  session.balance = Number((session.balance + evaluation.totalWin).toFixed(2));
  if (session.freeSpinsLeft === 0) {
    session.bonusMultiplier = 1;
  }

  const payload = {
    spin_id: spinId,
    is_free_spin: isFreeSpin,
    multiplier_applied: activeMultiplier,
    matrix: withFeature.matrix,
    expanded_wild_reel: withFeature.expandedReel,
    line_wins: evaluation.lineWins,
    scatter_count: evaluation.scatterCount,
    scatter_win: evaluation.scatterWin,
    free_spins_awarded: evaluation.freeSpinsAwarded,
    free_spins_left: session.freeSpinsLeft,
    total_win: evaluation.totalWin,
    balance_after: session.balance
  };

  session.spinHistory.set(spinId, payload);
  return payload;
}

function handleApi(req, res, parsedUrl) {
  if (req.method === "GET" && parsedUrl.pathname === "/api/v1/health") {
    return sendJson(res, 200, { status: "ok", uptime: process.uptime() });
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/session/init") {
    return parseBody(req)
      .then((body) => {
        const session = createSession(body);
        sendJson(res, 200, {
          session_id: session.sessionId,
          balance: session.balance,
          allowed_bets: ALLOWED_BETS,
          currency: session.currency,
          locale: session.locale,
          game_id: session.gameId,
          math_config_id: paytable.version
        });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/spin") {
    return parseBody(req)
      .then((body) => {
        const session = sessions.get(body.session_id);
        if (!session) {
          sendJson(res, 404, { error: "SESSION_NOT_FOUND" });
          return;
        }
        const spinId = body.spin_id || crypto.randomUUID();
        const betAmount = Number(body.bet_amount);
        if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
          sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
          return;
        }
        try {
          const outcome = resolveSpin(session, spinId, betAmount);
          sendJson(res, 200, outcome);
        } catch (err) {
          sendJson(res, 400, { error: err.message || "INTERNAL_ERROR" });
        }
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(req, res, parsedUrl) {
  let requested = parsedUrl.pathname;
  if (requested === "/") requested = "/index.html";
  const filePath = path.normalize(path.join(CLIENT_DIR, requested));
  if (!filePath.startsWith(CLIENT_DIR)) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  if (parsedUrl.pathname.startsWith("/api/")) {
    handleApi(req, res, parsedUrl);
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res, parsedUrl);
    return;
  }
  sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
});

server.listen(PORT, () => {
  console.log(`Slot MVP running at http://localhost:${PORT}`);
});
