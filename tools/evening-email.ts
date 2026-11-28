// The 7 pm evening email, for the scheduled Claude task that sends it.
// Usage: node_modules/.bin/jiti tools/evening-email.ts evening.json > email.json
// evening.json is what evening_data_for_email() returns (skip the person when it is null); email.json is {subject, html, text}.
import { readFileSync } from "node:fs";
import { buildEvening, eveningHtml, eveningText, type EveningData } from "../src/lib/evening";

const data = JSON.parse(readFileSync(process.argv[2], "utf8")) as EveningData;
const e = buildEvening(data);
const app = "https://sourcingo-os.vercel.app";
process.stdout.write(JSON.stringify({ subject: e.subject, html: eveningHtml(e, data, app), text: eveningText(e, data, app) }));
