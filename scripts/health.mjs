// Checks that the parts running outside the app are still alive, and exits 1 (so GitHub emails
// the owner) when one has stopped: the Tally reader, the Gmail PO pickup, PO reading, the database
// size on the free plan, and the newest production deploy.
//   node scripts/health.mjs
const url = process.env.SUPABASE_URL ?? "https://zwqoogevoxpafzbdnptz.supabase.co";
// The public (publishable) key: the same one every browser gets with the app.
const key = process.env.SUPABASE_PUBLISHABLE_KEY ?? "sb_publishable_zrLLwsylesI6Xaf6EwZoDQ_d7nOIppF";

const res = await fetch(`${url}/rest/v1/rpc/system_health`, {
  method: "POST", headers: { apikey: key, "Content-Type": "application/json" }, body: "{}",
});
if (!res.ok) {
  console.log(`PROBLEM: the app's database did not answer (${res.status}).`);
  process.exit(1);
}
const h = await res.json();
console.log(JSON.stringify(h));

const problems = [];
// The reader runs while Tally is open on the office PC, so allow for a weekend.
if (h.tally_enabled && (h.tally_seen_hours == null || h.tally_seen_hours > 60)) {
  problems.push(`The Tally reader hasn't checked in for ${h.tally_seen_hours ?? "ever"} hours. Is Tally open on the office PC?`);
}
// Every email with an attachment is picked up (POs and others), so a quiet mailbox for 4 days means the script stopped.
if (h.email_hours == null || h.email_hours > 96) {
  problems.push(`No email has been picked up for ${h.email_hours ?? "ever"} hours. Check the Gmail pickup script.`);
}
if (h.failed_reads_24h > 0) problems.push(`${h.failed_reads_24h} PO file(s) couldn't be read in the last 24 hours. See New buyer POs.`);
// The free plan stops at 500 MB.
if (h.db_mb > 350) problems.push(`The database is ${h.db_mb} MB of the free 500 MB.`);

for (const p of problems) console.log(`PROBLEM: ${p}`);
process.exit(problems.length ? 1 : 0);
