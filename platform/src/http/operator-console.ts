import type { FastifyPluginAsync } from "fastify";
import {
  renderConsolePage,
  SECTION_DASHBOARD_OPERATOR,
  SECTION_INSPECTOR,
  SECTION_GAMES,
  SECTION_DISPUTES,
  SECTION_PLAYERS,
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
    { view: "dashboard", label: "Dashboard" },
    { view: "games", label: "My Games" },
    { view: "inspector", label: "Round Inspector" },
    { view: "players", label: "Players" },
    { view: "disputes", label: "Disputes" },
    { view: "reports", label: "Reports" }
  ],
  sections: [
    SECTION_DASHBOARD_OPERATOR,
    SECTION_GAMES,
    SECTION_INSPECTOR,
    SECTION_PLAYERS,
    SECTION_DISPUTES,
    SECTION_REPORTS
  ].join("\n")
});

const operatorConsoleRoutes: FastifyPluginAsync = async (app) => {
  const serve = async (_req: unknown, reply: import("fastify").FastifyReply) =>
    reply.type("text/html").header("cache-control", "no-store").send(PAGE);
  app.get("/admin", serve);
};

export default operatorConsoleRoutes;
