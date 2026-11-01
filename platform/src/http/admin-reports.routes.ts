import type { FastifyPluginAsync } from "fastify";
import { envelope } from "./errors";
import { adminAuthPreHandler } from "./admin.routes";
import { can, resolveOperatorScope, type AdminClaims } from "../modules/admin/admin-auth";
import { BUSINESS_PERIODS, type BusinessPeriod } from "../modules/reporting/business-report";

const ISO = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Business reports (both consoles, tenant-scoped like every report):
 *   GET /admin/v1/reports/business
 *     period = day | week | month | year | total   (default day)
 *     by     = game, player (comma list; empty = one row per period and currency)
 *     tz     = minutes east of UTC the periods are cut in (default 0)
 *     from, to (ISO), game (code), player (operator player id), limit, operator_id (provider)
 * Business Summary = by period; Games Profit Summary = by=game; Member Business
 * Summary = by=player (with period=total, or period=day for "group by day per player").
 */
const adminReportsRoutes: FastifyPluginAsync = async (app) => {
  const auth = adminAuthPreHandler(app.container);

  app.get("/admin/v1/reports/business", { preHandler: auth }, async (req, reply) => {
    const claims = req.adminClaims as AdminClaims;
    if (!can(claims, "reports.read")) return reply.code(403).send(envelope("FORBIDDEN", "missing permission: reports.read", req.id));
    const q = req.query as { operator_id?: string; period?: string; by?: string; tz?: string; from?: string; to?: string; game?: string; player?: string; limit?: string };
    const bad = (msg: string) => reply.code(422).send(envelope("VALIDATION", msg, req.id));
    const period = (q.period || "day") as BusinessPeriod;
    if (!(BUSINESS_PERIODS as readonly string[]).includes(period)) return bad(`period must be one of: ${BUSINESS_PERIODS.join(", ")}`);
    const by = (q.by || "").split(",").map((s) => s.trim()).filter(Boolean);
    if (by.some((b) => b !== "game" && b !== "player")) return bad("by takes game and/or player");
    const tz = q.tz === undefined || q.tz === "" ? 0 : Number(q.tz);
    if (!Number.isInteger(tz) || tz < -720 || tz > 840) return bad("tz must be whole minutes between -720 and 840");
    for (const [k, v] of [["from", q.from], ["to", q.to]] as const) if (v && !(ISO.test(v) && Number.isFinite(Date.parse(v)))) return bad(`${k} must be an ISO date or date-time`);
    const limit = q.limit === undefined ? undefined : Number(q.limit);
    if (limit !== undefined && !(Number.isFinite(limit) && limit >= 1)) return bad("limit must be a positive number");
    const operatorId = resolveOperatorScope(claims, q.operator_id);
    const report = await app.container.history.businessReport(operatorId, {
      period,
      tz_offset_min: tz,
      by_game: by.includes("game"),
      by_player: by.includes("player"),
      from: q.from ? new Date(q.from).toISOString() : undefined,
      to: q.to ? new Date(q.to).toISOString() : undefined,
      game_code: q.game || undefined,
      operator_player_id: q.player || undefined,
      limit
    });
    return { operator_id: operatorId ?? null, period, tz_offset_min: tz, by, generated_at: new Date().toISOString(), ...report };
  });
};

export default adminReportsRoutes;
