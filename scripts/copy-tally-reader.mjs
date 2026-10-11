// Copies the Tally reader into public/tally-reader so the office PC can install it
// with one command from Tally > Setup (see tally-bridge/setup.ps1). Runs before every build.
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(root, "tally-bridge");
const to = join(root, "public", "tally-reader");
const files = ["setup.ps1", "install-windows.ps1", "sync.mjs", "lib/sync.mjs", "lib/xml.mjs", "config.example.json", "package.json", "README.md"];

rmSync(to, { recursive: true, force: true });
for (const f of files) {
  mkdirSync(dirname(join(to, f)), { recursive: true });
  cpSync(join(from, f), join(to, f));
}
console.log(`Tally reader: copied ${files.length} files to public/tally-reader`);
