import type { FastifyPluginAsync } from "fastify";
import {
  renderConsolePage,
  SECTION_DASHBOARD_PROVIDER,
  SECTION_INSPECTOR,
  SECTION_GAMES,
  SECTION_DISPUTES,
  SECTION_PLAYERS,
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
    { view: "dashboard", label: "Dashboard" },
    { view: "inspector", label: "Round Inspector" },
    { view: "games", label: "Games" },
    { view: "disputes", label: "Disputes" },
    { view: "players", label: "Players" },
    { view: "onboarding", label: "Onboarding" },
    { view: "reports", label: "Reports" },
    { view: "accounts", label: "Admin Accounts" }
  ],
  sections: [
    SECTION_DASHBOARD_PROVIDER,
    SECTION_INSPECTOR,
    SECTION_GAMES,
    SECTION_DISPUTES,
    SECTION_PLAYERS,
    SECTION_ONBOARDING,
    SECTION_REPORTS,
    SECTION_ACCOUNTS
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
