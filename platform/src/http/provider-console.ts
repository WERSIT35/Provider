import type { FastifyPluginAsync } from "fastify";
import { SECTION_BUSINESS } from "./admin-console-business";
import {
  renderConsolePage,
  SECTION_DASHBOARD_PROVIDER,
  SECTION_INSPECTOR,
  SECTION_GAMES,
  SECTION_DISPUTES,
  SECTION_PLAYERS,
  SECTION_PLAYER_REPORTS,
  SECTION_CAMPAIGNS,
  SECTION_ONBOARDING,
  SECTION_REPORTS,
  SECTION_ACCOUNTS
} from "./admin-console-sections";

/**
 * Provider Control Plane — OUR admin console (served at /provider). Full control:
 * onboarding, operators, all games, math configs, disputes (approve/reject),
 * reports, round inspector, and admin-account management. Provider-scoped login
 * only. Neutral branding (no single-game identity).
 */
const PAGE = renderConsolePage({
  title: "Provider Control Plane",
  brandtag: "Provider · internal",
  consoleKind: "provider",
  expectedScope: "provider",
  nav: [
    { group: "Lobby", items: [{ view: "dashboard", label: "Dashboard" }] },
    { group: "Players", items: [
      { view: "inspector", label: "Round Inspector" },
      { view: "gameHistory", label: "Game History" },
      { view: "players", label: "Player Lookup" },
      { view: "playerReports", label: "Player Reports" },
      { view: "disputes", label: "Disputes" }
    ] },
    { group: "Intelligence", items: [
      { view: "bizSummary", label: "Business Summary" },
      { view: "gamesProfit", label: "Games Profit Summary" },
      { view: "memberBiz", label: "Member Business Summary" },
      { view: "reports", label: "RTP & Reconciliation" }
    ] },
    { group: "Administration", items: [
      { view: "games", label: "Games" },
      { view: "onboarding", label: "Onboarding" },
      { view: "accounts", label: "Admin Accounts" }
    ] },
    { group: "Promotions", items: [{ view: "campaigns", label: "Free Rounds" }] }
  ],
  sections: [
    SECTION_DASHBOARD_PROVIDER,
    SECTION_INSPECTOR,
    SECTION_GAMES,
    SECTION_DISPUTES,
    SECTION_PLAYERS,
    SECTION_PLAYER_REPORTS,
    SECTION_CAMPAIGNS,
    SECTION_ONBOARDING,
    SECTION_REPORTS,
    SECTION_ACCOUNTS,
    SECTION_BUSINESS
  ].join("\n")
});

const providerConsoleRoutes: FastifyPluginAsync = async (app) => {
  const serve = async (_req: unknown, reply: import("fastify").FastifyReply) =>
    reply.type("text/html").header("cache-control", "no-store").send(PAGE);
  // Root redirects to the provider console (the operator portal lives at /admin).
  app.get("/", async (_req, reply) => reply.code(302).header("location", "/provider").send());
  app.get("/provider", serve);
};

export default providerConsoleRoutes;
