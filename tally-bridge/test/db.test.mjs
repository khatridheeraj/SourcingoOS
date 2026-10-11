// End to end: the real database functions, the reader and a stand-in Tally.
// Needs Postgres (PGHOST/PGUSER, as for supabase/tests/run.sh); skipped without it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createSync } from "../lib/sync.mjs";
import { fakeTally } from "./fake-tally.mjs";

const supa = join(dirname(fileURLToPath(import.meta.url)), "../../supabase");
const db = `tally_e2e_${process.pid}`;
const OWNER = "00000000-0000-0000-0000-00000000000a";
const ACCOUNTS = "00000000-0000-0000-0000-0000000000ac";
const psql = (sql, database = db) =>
  execFileSync("psql", ["-q", "-At", "-v", "ON_ERROR_STOP=1", "-d", database, "-c", sql], { encoding: "utf8" }).trim();
const psqlFile = (f) => execFileSync("psql", ["-q", "-v", "ON_ERROR_STOP=1", "-d", db, "-f", f], { encoding: "utf8" });
const lit = (v) => `$v$${typeof v === "string" ? v : JSON.stringify(v)}$v$`;
const as = (user, sql) => psql(`select set_config('request.jwt.claim.sub', '${user}', false); set role authenticated; ${sql}`).split("\n").at(-1);

// The reader's view of Sourcingo OS: signed out, with only the key.
function sqlCloud(key) {
  const call = (fn, p) => JSON.parse(psql(`set role anon; select public.${fn}(${lit(key)}, ${lit(p)}::jsonb)::text`));
  return { hello: async (info) => call("tally_bridge_hello", info), snapshot: async (p) => call("tally_bridge_snapshot", p) };
}

const hasPg = (() => {
  if (!process.env.PGHOST) return false;
  try { psql("select 1", "postgres"); return true; } catch { return false; }
})();

test("Tally's books reach the app, and Accounts brings in what's missing", { skip: !hasPg && "no Postgres" }, async (t) => {
  psql(`create database ${db}`, "postgres");
  t.after(() => psql(`drop database if exists ${db}`, "postgres"));
  psqlFile(join(supa, "tests/stub_auth.sql"));
  for (const f of readdirSync(join(supa, "migrations")).filter((f) => f.endsWith(".sql")).sort()) psqlFile(join(supa, "migrations", f));
  psql(`
    insert into auth.users (id, email) values ('${OWNER}', 'o@t'), ('${ACCOUNTS}', 'a@t');
    insert into public.members (company_id, user_id, role)
      select c.id, u.id, u.role from public.companies c, (values ('${OWNER}'::uuid, 'owner'), ('${ACCOUNTS}'::uuid, 'accounts')) u (id, role);
    update public.profiles set current_company_id = (select id from public.companies);`);
  as(OWNER, `select public.save_buyer('{"code":"BYR-OZ","real_name":"Ozia Retail"}'); insert into public.factories (name) values ('Okhla Stitchers');`);
  as(OWNER, `select public.save_invoice(jsonb_build_object('invoice_no', 'SPL/26-27/146', 'buyer_id', (select id from public.buyers), 'invoice_date', '2026-10-01', 'amount', 10000))`);
  const key = as(OWNER, "select public.tally_new_key()");
  as(OWNER, `select public.tally_save_settings('{"enabled":true,"tally_company":"Sourcingo Test","read_from":"2026-04-01"}')`);

  const tally = fakeTally({
    ledgers: [{ name: "M/s Ozia Retail Pvt Ltd", parent: "Sundry Debtors", balance: -35000 }, { name: "Okhla Stitchers", parent: "Sundry Creditors", balance: 42000 }],
    items: [{ name: "K-22 Kurta", unit: "Pcs", qty: 120, value: 30000 }],
    vouchers: [
      { guid: "g0", vtype: "Sales", number: "SPL/26-27/146", date: "2026-10-01", party: "M/s Ozia Retail Pvt Ltd", amount: 10000 },
      { guid: "g1", vtype: "Sales", number: "SPL/26-27/147", date: "2026-10-04", party: "M/s Ozia Retail Pvt Ltd", amount: 26250 },
      { guid: "g2", vtype: "Credit Note", number: "CN/3", date: "2026-10-05", party: "M/s Ozia Retail Pvt Ltd", amount: 1250, bills: [{ name: "SPL/26-27/147", amount: 1250 }] },
    ],
  });
  const sync = createSync({ tally: tally.handle, cloud: sqlCloud(key), now: () => new Date("2026-10-10T08:00:00Z") });
  const r = await sync.round();
  assert.equal(r.read, true);
  assert.equal(tally.books.writes.length, 0);

  // Ledgers linked by name, balances as "owed to us".
  assert.equal(psql("select tally_ledger from public.buyers"), "M/s Ozia Retail Pvt Ltd");
  assert.equal(psql("select tally_ledger from public.factories"), "Okhla Stitchers");
  assert.equal(psql("select balance from public.tally_ledgers where name like 'M/s%'"), "35000.00");
  assert.equal(psql("select agent_info->>'tally' from public.tally_settings"), "online");

  // Accounts brings in the invoice and credit note that are only in Tally.
  const out = JSON.parse(as(ACCOUNTS, "select public.tally_import(array['g0', 'g1', 'g2'])::text"));
  assert.deepEqual([out.invoices, out.credit_notes, out.skipped], [1, 1, ["Invoice SPL/26-27/146 is already in Payments."]]);
  assert.equal(psql("select public.invoice_net(id) from public.invoices where invoice_no = 'SPL/26-27/147'"), "25000.00");
});
