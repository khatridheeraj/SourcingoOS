// The 9 am brief as an email, for the scheduled Claude task that sends it (no Gmail script needed).
// Usage: node_modules/.bin/jiti tools/brief-email.ts brief.json > email.json
// brief.json is what brief_data_for_email() returns; email.json is {subject, html, text}, the same email /api/brief makes.
import { readFileSync } from "node:fs";
import { briefHtml, briefText, buildBrief, type BriefData } from "../src/lib/brief";

const data = JSON.parse(readFileSync(process.argv[2], "utf8")) as BriefData;
const b = buildBrief(data);
process.stdout.write(JSON.stringify({
  subject: `Sourcingo brief, ${b.title}: ${b.headline}`,
  html: briefHtml(b, data.company, "https://sourcingo-os.vercel.app"),
  text: briefText(b, data.company),
}));
