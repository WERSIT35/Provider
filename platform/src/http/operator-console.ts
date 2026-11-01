import type { FastifyPluginAsync } from "fastify";
import { SECTION_BUSINESS } from "./admin-console-business";
import {
  renderConsolePage,
  SECTION_DASHBOARD_OPERATOR,
  SECTION_INSPECTOR,
  SECTION_GAMES,
  SECTION_DISPUTES,
  SECTION_PLAYERS,
  SECTION_PLAYER_REPORTS,
  SECTION_CAMPAIGNS,
  SECTION_REPORTS
} from "./admin-console-sections";

/**
 * Provider Games — the CLIENT (operator/casino) portal, served at /admin. Shows
 * only this operator's own data: their assigned games (turn on/off), their rounds
 * + reports, player lookup, round inspector, and raising disputes to the provider.
 * Operator-scoped login only. Multi-game, provider-neutral branding — NOT tied to
 * any single game.
 */
const PAGE = renderConsolePage({
  title: "Provider Games · Operator Portal",
  brandtag: "Operator · casino admin",
  consoleKind: "operator",
  expectedScope: "operator",
  nav: [
    // Round Inspector leads the nav: "a player says spin X was wrong" is the
    // operator's most frequent support task. Dashboard stays the landing view.
    { group: "Players", items: [
      { view: "inspector", label: "Round Inspector" },
      { view: "gameHistory", label: "Game History" },
      { view: "players", label: "Player Lookup" },
      { view: "playerReports", label: "Player Reports" },
      { view: "disputes", label: "Disputes" }
    ] },
    { group: "Lobby", items: [{ view: "dashboard", label: "Dashboard" }] },
    { group: "Intelligence", items: [
      { view: "bizSummary", label: "Business Summary" },
      { view: "gamesProfit", label: "Games Profit Summary" },
      { view: "memberBiz", label: "Member Business Summary" },
      { view: "reports", label: "RTP & Reconciliation" }
    ] },
    { group: "Administration", items: [{ view: "games", label: "My Games" }] },
    { group: "Promotions", items: [{ view: "campaigns", label: "Free Rounds" }] }
  ],
  sections: [
    SECTION_DASHBOARD_OPERATOR,
    SECTION_GAMES,
    SECTION_INSPECTOR,
    SECTION_PLAYERS,
    SECTION_PLAYER_REPORTS,
    SECTION_CAMPAIGNS,
    SECTION_DISPUTES,
    SECTION_REPORTS,
    SECTION_BUSINESS
  ].join("\n")
});

const operatorConsoleRoutes: FastifyPluginAsync = async (app) => {
  const serve = async (_req: unknown, reply: import("fastify").FastifyReply) =>
    reply.type("text/html").header("cache-control", "no-store").send(PAGE);
  app.get("/admin", serve);
};

export default operatorConsoleRoutes;
