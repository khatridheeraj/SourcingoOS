#!/usr/bin/env node
// Reads TallyPrime into Sourcingo OS. Runs on the PC where Tally runs, and only reads Tally.
//   node sync.mjs           keep syncing (what the startup task runs)
//   node sync.mjs --once    one round, then exit (for testing)
import { appendFileSync, existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cloudClient, createSync, tallyClient, VERSION } from "./lib/sync.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const configPath = join(here, "config.json");
const logPath = join(here, "sync.log");

function log(msg) {
  const line = `${new Date().toISOString()}  ${msg}\n`;
  process.stdout.write(line);
  try {
    if (existsSync(logPath) && statSync(logPath).size > 5 * 1024 * 1024) renameSync(logPath, `${logPath}.old`);
    appendFileSync(logPath, line);
  } catch {}
}

if (!existsSync(configPath)) {
  log("config.json is missing. Copy config.example.json to config.json and fill in the sync key from the Tally page in Sourcingo OS.");
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
for (const k of ["supabaseUrl", "supabaseKey", "syncKey"]) {
  if (!config[k] || String(config[k]).includes("PASTE")) {
    log(`config.json needs "${k}".`);
    process.exit(1);
  }
}

const sync = createSync({
  tally: tallyClient(config.tallyUrl ?? "http://localhost:9000"),
  cloud: cloudClient(config),
  log,
  readMinutes: config.readMinutes ?? config.snapshotMinutes ?? 15,
});
const pollSeconds = Math.max(15, Number(config.pollSeconds ?? 60));

log(`Sourcingo Tally reader ${VERSION} started.`);
let lastError = "";
for (;;) {
  try {
    await sync.round();
    if (lastError) log("Working again.");
    lastError = "";
  } catch (e) {
    const msg = String(e?.message ?? e);
    if (msg !== lastError) log(`Problem: ${msg}`);
    lastError = msg;
  }
  if (process.argv.includes("--once")) break;
  await new Promise((r) => setTimeout(r, pollSeconds * 1000));
}
