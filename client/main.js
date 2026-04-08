const sessionIdEl = document.getElementById("sessionId");
const balanceEl = document.getElementById("balance");
const betViewEl = document.getElementById("betView");
const lastWinEl = document.getElementById("lastWin");
const freeSpinsEl = document.getElementById("freeSpins");
const betSelectEl = document.getElementById("betSelect");
const spinBtnEl = document.getElementById("spinBtn");
const reelsEl = document.getElementById("reels");
const resultDumpEl = document.getElementById("resultDump");

let sessionId = null;

function formatMoney(v) {
  return Number(v).toFixed(2);
}

function renderEmptyGrid() {
  reelsEl.innerHTML = "";
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.textContent = "-";
      reelsEl.appendChild(cell);
    }
  }
}

function renderMatrix(matrix) {
  reelsEl.innerHTML = "";
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const symbol = matrix[row][col];
      const cell = document.createElement("div");
      cell.className = "cell";
      if (symbol === "WILD") cell.classList.add("wild");
      if (symbol === "SCATTER") cell.classList.add("scatter");
      cell.textContent = symbol;
      reelsEl.appendChild(cell);
    }
  }
}

async function api(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

async function initSession() {
  const data = await api("/api/v1/session/init", {
    player_id: `player_${Date.now()}`,
    currency: "GEL",
    locale: "en",
    game_id: "project-khma"
  });
  sessionId = data.session_id;
  sessionIdEl.textContent = sessionId.slice(0, 8);
  balanceEl.textContent = formatMoney(data.balance);
  betSelectEl.innerHTML = "";
  data.allowed_bets.forEach((bet) => {
    const option = document.createElement("option");
    option.value = String(bet);
    option.textContent = formatMoney(bet);
    betSelectEl.appendChild(option);
  });
  betSelectEl.value = "1";
  betViewEl.textContent = "1.00";
}

async function spin() {
  if (!sessionId) return;
  spinBtnEl.disabled = true;
  try {
    const bet = Number(betSelectEl.value);
    betViewEl.textContent = formatMoney(bet);
    const payload = await api("/api/v1/spin", {
      session_id: sessionId,
      spin_id: crypto.randomUUID(),
      bet_amount: bet
    });

    renderMatrix(payload.matrix);
    balanceEl.textContent = formatMoney(payload.balance_after);
    lastWinEl.textContent = formatMoney(payload.total_win);
    freeSpinsEl.textContent = String(payload.free_spins_left);
    resultDumpEl.textContent = JSON.stringify(payload, null, 2);
  } catch (err) {
    resultDumpEl.textContent = `Error: ${err.message}`;
  } finally {
    spinBtnEl.disabled = false;
  }
}

betSelectEl.addEventListener("change", () => {
  betViewEl.textContent = formatMoney(Number(betSelectEl.value));
});
spinBtnEl.addEventListener("click", spin);

renderEmptyGrid();
initSession().catch((err) => {
  resultDumpEl.textContent = `Init failed: ${err.message}`;
});
