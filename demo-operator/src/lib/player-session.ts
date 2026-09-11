// Reuse the platform's own dependency-free signed-token util (HMAC-SHA256 over a
// base64url JSON payload) instead of adding a JWT library — the same reasoning
// the admin console already applies to its own bearer tokens.
import { signToken, verifyToken } from "../../../platform/src/lib/tokens";

const TTL_SECONDS = 60 * 60 * 24 * 7; // a week — this is a demo, not a bank.

export function issuePlayerToken(secret: string, playerId: string): string {
  return signToken(secret, { player_id: playerId }, TTL_SECONDS);
}

export function verifyPlayerToken(secret: string, token: string): string {
  const claims = verifyToken<{ player_id: string } & { exp: number }>(secret, token);
  return claims.player_id;
}
