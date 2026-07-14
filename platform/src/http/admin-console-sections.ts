/**
 * Static HTML section fragments shared by the two console pages
 * (provider-console.ts and operator-console.ts). Operator-only vs provider-only
 * controls are tagged data-provider / data-operator and toggled at runtime by the
 * shared script's applyScopeVisibility(). The operator page simply omits the
 * sections it does not offer (onboarding, operators, accounts).
 */

export const SECTION_INSPECTOR = /* html */ `
<section id="inspectorView" hidden>
  <div class="panel">
    <h2>Round Inspector</h2>
    <p class="muted">Paste a Round ID a player shared (e.g. <code>r_abc…</code>) to see exactly what happened on that spin. The matrix below is a faithful playback of the stored outcome — no re-computation.</p>
    <div class="toolbar">
      <input class="search" id="roundRefInput" placeholder="r_… (paste round id)"/>
      <button onclick="lookupRound()">Look up</button>
      <span id="inspectorStatus" class="muted"></span>
    </div>
  </div>
  <div class="panel">
    <h2>Legitimacy &amp; actions</h2>
    <p class="muted">Verify recomputes the outcome from the stored server seed and checks the ledger hash-chain. Provider admins can void/settle directly; operator admins raise a request the provider approves.</p>
    <div class="toolbar">
      <button class="ghost" onclick="verifyRound()">✓ Verify legitimacy</button>
      <button class="ghost" onclick="loadRoundTx()">Transaction timeline</button>
      <span data-provider><button class="danger" onclick="voidRoundAction()">Void round</button></span>
      <span data-provider><button onclick="settleRoundAction()">Settle (re-credit)</button></span>
      <span data-operator><button class="ghost" onclick="raiseDisputeAction('void')">Request void</button></span>
      <span data-operator><button class="ghost" onclick="raiseDisputeAction('settle')">Request settle</button></span>
    </div>
    <div id="roundActionOut"></div>
  </div>
  <div id="inspectorContent"></div>
</section>`;

export const SECTION_GAMES = /* html */ `
<section id="gamesView" hidden>
  <div class="panel">
    <h2>Games — turn on / off</h2>
    <p class="muted">Disabling an assignment immediately stops new player sessions for that game. <span data-provider>Provide an operator id to view another tenant;</span> <span data-operator>you see only your own games.</span></p>
    <div class="toolbar">
      <input class="search" id="gamesOp" placeholder="operator id (provider only)" data-provider/>
      <button class="ghost" onclick="loadGames()">Load</button>
    </div>
    <div id="gamesList">–</div>
  </div>
</section>`;

export const SECTION_DISPUTES = /* html */ `
<section id="disputesView" hidden>
  <div class="panel">
    <h2>Disputes</h2>
    <p class="muted">Operators raise a void/settle request against one of their rounds; provider admins approve (executes it) or reject.</p>
    <div class="toolbar">
      <input class="search" id="dspOp" placeholder="operator id (provider only)" data-provider/>
      <select id="dspStatus"><option value="">all</option><option value="open">open</option><option value="approved">approved</option><option value="rejected">rejected</option></select>
      <button class="ghost" onclick="loadDisputes()">Load</button>
    </div>
    <div id="disputesList">–</div>
  </div>
</section>`;

export const SECTION_PLAYERS = /* html */ `
<section id="playersView" hidden>
  <div class="panel">
    <h2>Player lookup</h2>
    <p class="muted">Every round for one player id — the support / dispute triage view.</p>
    <div class="toolbar">
      <input class="search" id="plOp" placeholder="operator id (provider only)" data-provider/>
      <input class="search" id="plPlayer" placeholder="operator_player_id (e.g. p1)"/>
      <button onclick="loadPlayer()">Look up</button>
      <span id="plStatus" class="muted"></span>
    </div>
    <div id="playerRounds">–</div>
  </div>
</section>`;

export const SECTION_REPORTS = /* html */ `
<section id="reportsView" hidden>
  <div class="panel">
    <h2>Reports</h2>
    <div class="toolbar">
      <input class="search" id="repOp" placeholder="operator id (provider only; leave blank for all)" data-provider/>
      <button class="ghost" onclick="loadReports()">Refresh</button>
    </div>
    <div class="grid-2">
      <div class="panel"><h2>Rounds summary</h2><div id="repSummary">–</div></div>
      <div class="panel"><h2>RTP (actual)</h2><div id="repRtp">–</div></div>
      <div class="panel"><h2>GGR by day</h2><div id="repGgr">–</div></div>
      <div class="panel"><h2>Reconciliation</h2><div id="repRecon">–</div></div>
      <div class="panel"><h2>Failed settlements</h2><div id="repFailed">–</div></div>
    </div>
  </div>
</section>`;

export const SECTION_ONBOARDING = /* html */ `
<section id="onboardingView" hidden>
  <div class="panel">
    <h2>Onboard a casino</h2>
    <p class="muted">Each step is the same Admin API the dev-seed script uses — no code editing required.</p>
    <ol style="padding-left:18px; line-height:1.9">
      <li><b>Create operator</b> — a tenant for the casino.</li>
      <li><b>Allowlist a launch domain</b> — only requests from this origin can launch.</li>
      <li><b>Issue an API credential</b> — secret shown ONCE; hand it over securely.</li>
      <li><b>Register the game + approve a math config</b> — only approved configs can go live.</li>
      <li><b>Assign the game</b> — links operator ↔ game ↔ approved config + allowed bets.</li>
      <li><b>(Demo)</b> Mint a launch URL to verify the operator end-to-end.</li>
    </ol>
  </div>
  <div class="panel">
    <h2>1 · Create operator</h2>
    <div class="row">
      <label>Name <input id="opName" placeholder="LuckySpin Casino"/></label>
      <label>Slug <input id="opSlug" placeholder="luckyspin"/></label>
      <label>Default currency <input id="opCurrency" placeholder="GEL" value="GEL"/></label>
      <button onclick="createOperator()">Create</button>
    </div>
    <div id="opResult" class="status" hidden style="margin-top:8px;"></div>
  </div>
  <div class="panel">
    <h2>2 · Allowlist launch domain</h2>
    <div class="row">
      <label>Operator <select id="domainOp"></select></label>
      <label>Domain <input id="domainHost" placeholder="play.luckyspin.com"/></label>
      <label>Environment <select id="domainEnv"><option value="prod">prod</option><option value="sandbox">sandbox</option></select></label>
      <button onclick="addDomain()">Add</button>
    </div>
    <div id="domainResult" class="status" hidden style="margin-top:8px;"></div>
  </div>
  <div class="panel">
    <h2>3 · Issue API credential</h2>
    <div class="row">
      <label>Operator <select id="credOp"></select></label>
      <label>Environment <select id="credEnv"><option value="prod">prod</option><option value="sandbox">sandbox</option></select></label>
      <button onclick="issueCredential()">Issue</button>
    </div>
    <div id="credResult" class="status" hidden style="margin-top:8px;"></div>
  </div>
  <div class="panel">
    <h2>4 · Register game + approve math config</h2>
    <div class="row">
      <label>Game code <input id="gameCode" placeholder="bananax"/></label>
      <label>Game title <input id="gameTitle" placeholder="Banana X"/></label>
      <button onclick="registerGame()">Register game</button>
    </div>
    <div id="gameResult" class="status" hidden style="margin-top:8px;"></div>
    <hr style="border:0; border-top:1px solid var(--line); margin:12px 0;"/>
    <div class="row">
      <label>Game <select id="mcGame"></select></label>
      <label>Version <input id="mcVersion" placeholder="3.0.0" value="3.0.0"/></label>
      <label>RTP profile key <input id="mcKey" placeholder="bananax" value="bananax"/></label>
      <label>Theoretical RTP % <input id="mcRtp" type="number" step="0.01" value="96.38"/></label>
      <label>Config hash <input id="mcHash" placeholder="sha256:…" value="sha256:demo"/></label>
      <button onclick="createMathConfig()">Create + approve</button>
    </div>
    <div id="mcResult" class="status" hidden style="margin-top:8px;"></div>
  </div>
  <div class="panel">
    <h2>5 · Assign game to operator</h2>
    <div class="row">
      <label>Operator <select id="asnOp"></select></label>
      <label>Game <select id="asnGame"></select></label>
      <label>Math config <select id="asnConfig"></select></label>
      <label>Currency <input id="asnCurrency" placeholder="GEL" value="GEL"/></label>
      <label>Allowed bets (comma-sep) <input id="asnBets" value="1, 5, 10, 50, 500"/></label>
      <button onclick="assignGame()">Assign</button>
    </div>
    <div id="asnResult" class="status" hidden style="margin-top:8px;"></div>
  </div>
  <div class="panel">
    <h2>6 · Launch a demo player (optional)</h2>
    <p class="muted">Opens a player session in the demo client at <code>/play</code>. Use this to verify a new operator end-to-end.</p>
    <div class="row">
      <label>Operator <select id="launchOp"></select></label>
      <label>Game code <input id="launchGame" value="bananax"/></label>
      <label>Player id <input id="launchPlayer" value="player-1"/></label>
      <label>Currency <input id="launchCurrency" value="GEL"/></label>
      <label>Origin (must be allowlisted) <input id="launchOrigin" placeholder="play.luckyspin.com"/></label>
      <button onclick="launchDemo()">Open player</button>
    </div>
    <div id="launchResult" class="status" hidden style="margin-top:8px;"></div>
  </div>
</section>`;

export const SECTION_ACCOUNTS = /* html */ `
<section id="accountsView" hidden>
  <div class="panel">
    <h2>Admin accounts</h2>
    <p class="muted">Create logins for provider staff and for operator (casino) admins. New accounts receive a one-time password and must set a new password + enroll an authenticator (2FA) on first sign-in.</p>
    <div class="row">
      <label>Username <input id="acctUser" placeholder="jane.doe"/></label>
      <label>Scope <select id="acctScope"><option value="operator">operator</option><option value="provider">provider</option></select></label>
      <label>Role <select id="acctRole"></select></label>
      <label id="acctOpWrap">Operator <select id="acctOp"></select></label>
      <button onclick="createAccount()">Create account</button>
    </div>
    <div id="acctResult" class="status" hidden style="margin-top:8px;"></div>
  </div>
  <div class="panel">
    <h2>Existing accounts</h2>
    <div class="toolbar"><button class="ghost" onclick="loadAccounts()">Refresh</button></div>
    <div id="accountsList">–</div>
  </div>
</section>`;

export const SECTION_DASHBOARD_PROVIDER = /* html */ `
<section id="dashboardView" hidden>
  <div class="panel"><h2>Overview</h2><div class="cards" id="overviewCards">loading…</div></div>
  <div class="grid-2">
    <div class="panel"><h2>Operators</h2><div id="operatorsList">loading…</div></div>
    <div class="panel">
      <h2>Latest rounds</h2>
      <div class="toolbar">
        <input class="search" id="filterOp" placeholder="filter by operator id (optional)"/>
        <button class="ghost" onclick="loadRounds()">Refresh</button>
      </div>
      <div id="roundsList">loading…</div>
    </div>
  </div>
</section>`;

export const SECTION_DASHBOARD_OPERATOR = /* html */ `
<section id="dashboardView" hidden>
  <div class="panel"><h2>Overview</h2><div class="cards" id="overviewCards">loading…</div></div>
  <div class="panel">
    <h2>Latest rounds</h2>
    <div class="toolbar"><button class="ghost" onclick="loadRounds()">Refresh</button></div>
    <div id="roundsList">loading…</div>
  </div>
</section>`;

/** Assemble a full console page (head + header + auth root + sections + script). */
export function renderConsolePage(opts: {
  title: string;
  brandtag: string;
  consoleKind: "provider" | "operator";
  expectedScope: "provider" | "operator";
  nav: Array<{ view: string; label: string }>;
  sections: string;
}): string {
  const navHtml = opts.nav.map((n) => `<button data-view="${n.view}">${n.label}</button>`).join("\n    ");
  const consoleCfg = JSON.stringify({ kind: opts.consoleKind, expectedScope: opts.expectedScope, title: opts.title });
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${opts.title}</title>
<link rel="stylesheet" href="/console/app.css"/>
</head>
<body>
<header>
  <h1>${opts.title}</h1>
  <span class="brandtag">${opts.brandtag}</span>
  <span class="pill" id="scopePill">not signed in</span>
  <nav id="nav" hidden>
    ${navHtml}
    <button class="ghost" id="signOutBtn" hidden>Sign out</button>
  </nav>
</header>
<main>
  <div id="authRoot"></div>
  ${opts.sections}
</main>
<script>window.__CONSOLE__ = ${consoleCfg};</script>
<script src="/console/app.js"></script>
</body></html>`;
}
