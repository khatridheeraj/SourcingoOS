// Is Sourcingo up? Opens the website, the sign-in page, a factory's public page path and the database, the way a
// visitor would, and exits 1 (so GitHub emails the owner) when one doesn't answer. Each check gets three tries,
// 20 seconds apart, so a single slow answer is not an alarm.
//   node scripts/uptime.mjs
const APP = process.env.APP_URL ?? "https://sourcingo-os.vercel.app";
const DB = process.env.SUPABASE_URL ?? "https://zwqoogevoxpafzbdnptz.supabase.co";
const KEY = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_zrLLwsylesI6Xaf6EwZoDQ_d7nOIppF";

const CHECKS = [
  { name: "The website", url: `${APP}/`, expect: (r, t) => r.ok && /Sourcingo/i.test(t) },
  { name: "Sign-in page", url: `${APP}/login`, expect: (r, t) => r.ok && /sign in|email/i.test(t) },
  { name: "Costing request page", url: `${APP}/costing`, expect: (r) => r.ok },
  { name: "The database", url: `${DB}/rest/v1/rpc/site_facts`, init: { method: "POST", headers: { apikey: KEY, "Content-Type": "application/json" }, body: "{}" },
    expect: (r) => r.ok },
  { name: "Sign-in service", url: `${DB}/auth/v1/health`, init: { headers: { apikey: KEY } }, expect: (r) => r.ok },
];

async function once(c) {
  const started = Date.now();
  try {
    const r = await fetch(c.url, { ...c.init, redirect: "follow", signal: AbortSignal.timeout(20_000) });
    const t = await r.text();
    return { ok: c.expect(r, t), detail: `${r.status} in ${Date.now() - started} ms` };
  } catch (e) {
    return { ok: false, detail: `${e.name === "TimeoutError" ? "no answer in 20 s" : e.message}` };
  }
}

const problems = [];
await Promise.all(CHECKS.map(async (c) => {
  let res;
  for (let i = 0; i < 3; i++) {
    res = await once(c);
    if (res.ok) break;
    if (i < 2) await new Promise((r) => setTimeout(r, 20_000));
  }
  console.log(`${res.ok ? "ok " : "DOWN"} ${c.name}: ${res.detail}`);
  if (!res.ok) problems.push(`${c.name} is not answering (${res.detail}). ${c.url}`);
}));
for (const p of problems) console.log(`PROBLEM: ${p}`);
process.exit(problems.length ? 1 : 0);
