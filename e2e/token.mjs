// Prints a test login's session for curl checks: node e2e/token.mjs merch
import crypto from "node:crypto";
const SECRET = process.env.E2E_JWT_SECRET ?? "local-e2e-secret-local-e2e-secret-0123456789";
export const USERS = {
  owner: ["00000000-0000-0000-0000-0000000000a1", "owner@test.local"],
  manager: ["00000000-0000-0000-0000-0000000000a2", "manager@test.local"],
  merch: ["00000000-0000-0000-0000-0000000000a3", "merch@test.local"],
  quality: ["00000000-0000-0000-0000-0000000000a4", "qc@test.local"],
  accounts: ["00000000-0000-0000-0000-0000000000a5", "accounts@test.local"],
  factory: ["00000000-0000-0000-0000-0000000000a6", "factory@test.local"],
  buyer: ["00000000-0000-0000-0000-0000000000a7", "buyer@test.local"],
};
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
export const sign = (c) => { const h = b64({ alg: "HS256", typ: "JWT" }), b = b64(c); return `${h}.${b}.${crypto.createHmac("sha256", SECRET).update(`${h}.${b}`).digest("base64url")}`; };
export const anonKey = () => sign({ role: "anon", iss: "supabase", iat: 1700000000, exp: 4100000000 });
export function session(who) {
  const [id, email] = USERS[who];
  const now = Math.floor(Date.now() / 1000);
  const user = { id, aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const access_token = sign({ sub: id, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 7 * 86400, session_id: id });
  return { access_token, refresh_token: `r-${id}-${email}`, token_type: "bearer", expires_in: 7 * 86400, expires_at: now + 7 * 86400, user };
}
// The cookie @supabase/ssr reads, for an app whose Supabase URL is http://localhost:54321.
export const cookie = (who) => ({ name: "sb-localhost-auth-token", value: "base64-" + Buffer.from(JSON.stringify(session(who))).toString("base64url") });
if (process.argv[1]?.endsWith("token.mjs")) console.log(process.argv[2] === "anon" ? anonKey() : session(process.argv[2] ?? "owner").access_token);
