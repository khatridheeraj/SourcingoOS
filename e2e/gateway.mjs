// A small stand-in for Supabase's front door, so the app runs against a local database:
// /rest/v1 goes to PostgREST, /auth/v1 answers for test logins signed with the local secret,
// /storage/v1 keeps uploads in memory, and /functions/v1 answers "ok".
//   node e2e/gateway.mjs            (listens on 54321, PostgREST on 54322)
import http from "node:http";
import crypto from "node:crypto";

export const SECRET = process.env.E2E_JWT_SECRET ?? "local-e2e-secret-local-e2e-secret-0123456789";
const PORT = Number(process.env.E2E_GATEWAY_PORT ?? 54321);
const REST = process.env.E2E_REST ?? "http://127.0.0.1:54322";

const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64url");
export function sign(claims) {
  const head = b64({ alg: "HS256", typ: "JWT" });
  const body = b64(claims);
  const sig = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
}
function verify(token) {
  const [head, body, sig] = String(token ?? "").split(".");
  if (!sig) return null;
  const good = crypto.createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  if (good !== sig) return null;
  const claims = JSON.parse(Buffer.from(body, "base64url").toString());
  return claims.exp && claims.exp * 1000 < Date.now() ? null : claims;
}
export const anonKey = () => sign({ role: "anon", iss: "supabase", iat: 1700000000, exp: 4100000000 });
export function session(id, email) {
  const now = Math.floor(Date.now() / 1000);
  const user = { id, aud: "authenticated", role: "authenticated", email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" };
  const access_token = sign({ sub: id, email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 7 * 86400, session_id: id });
  return { access_token, refresh_token: `r-${id}-${email}`, token_type: "bearer", expires_in: 7 * 86400, expires_at: now + 7 * 86400, user };
}

const files = new Map();
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((ok) => { const c = []; req.on("data", (d) => c.push(d)); req.on("end", () => ok(Buffer.concat(c))); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
    return res.end();
  }
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /i, "");
  try {
    if (p.startsWith("/rest/v1/")) {
      const body = ["GET", "HEAD"].includes(req.method) ? undefined : await readBody(req);
      const headers = { ...req.headers };
      delete headers.host; delete headers["content-length"]; delete headers.connection;
      if (!verify(bearer)) headers.authorization = `Bearer ${anonKey()}`;
      const r = await fetch(REST + p.slice(8) + url.search, { method: req.method, headers, body });
      const out = Buffer.from(await r.arrayBuffer());
      const h = Object.fromEntries([...r.headers].filter(([k]) => !["content-encoding", "transfer-encoding", "content-length", "connection"].includes(k)));
      res.writeHead(r.status, { ...h, "access-control-allow-origin": "*" });
      return res.end(out);
    }
    if (p === "/auth/v1/user") {
      const c = verify(bearer);
      if (!c?.sub) return json(res, 401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      return json(res, 200, session(c.sub, c.email).user);
    }
    if (p.startsWith("/auth/v1/.well-known")) return json(res, 200, { keys: [] });
    if (p === "/auth/v1/token") {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const m = /^r-([0-9a-f-]{36})-(.*)$/.exec(body.refresh_token ?? "");
      if (!m) return json(res, 400, { error: "invalid_grant", error_description: "Invalid Refresh Token" });
      return json(res, 200, session(m[1], m[2]));
    }
    if (p === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
    if (p.startsWith("/auth/v1/")) return json(res, 200, {});
    if (p.startsWith("/storage/v1/object/sign/")) {
      const body = JSON.parse((await readBody(req)).toString() || "{}");
      const key = p.slice("/storage/v1/object/sign/".length);
      if (Array.isArray(body.paths)) return json(res, 200, body.paths.map((x) => ({ path: x, signedURL: `/object/public/${x}`, error: null })));
      return json(res, 200, { signedURL: `/object/public/${key}` });
    }
    if (p.startsWith("/storage/v1/object/upload/sign/")) return json(res, 200, { url: p.replace("/storage/v1", ""), token: "t" });
    if (p.startsWith("/storage/v1/object/public/") || (p.startsWith("/storage/v1/object/") && req.method === "GET")) {
      const key = p.replace(/^\/storage\/v1\/object\/(public\/|authenticated\/)?/, "");
      const f = files.get(key);
      res.writeHead(200, { "content-type": f?.type ?? "image/png", "access-control-allow-origin": "*" });
      return res.end(f?.data ?? PNG);
    }
    if (p.startsWith("/storage/v1/object/")) {
      const key = p.replace(/^\/storage\/v1\/object\//, "");
      if (req.method === "DELETE") return json(res, 200, []);
      files.set(key, { data: await readBody(req), type: req.headers["content-type"] });
      return json(res, 200, { Key: key, Id: crypto.randomUUID() });
    }
    if (p.startsWith("/storage/v1/")) return json(res, 200, []);
    if (p.startsWith("/functions/v1/")) return json(res, 200, { ok: true });
    json(res, 404, { msg: `gateway: nothing at ${p}` });
  } catch (e) {
    json(res, 502, { msg: `gateway: ${e.message}` });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`gateway on ${PORT}`));
