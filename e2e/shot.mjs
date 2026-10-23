// Screenshots of one screen, a phone screen at a time, for reviewing a design by eye.
//   node e2e/shot.mjs <who> <path> <out-prefix> [--desk] [--dark] [--screens 3] [--click "text"]
import { createRequire } from "node:module";
import { cookie } from "./token.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const [who, path, out] = process.argv.slice(2);
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const desk = process.argv.includes("--desk");
const screens = Number(arg("--screens") ?? 3);
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";

const browser = await pw.chromium.launch();
const ctx = await browser.newContext({
  viewport: desk ? { width: 1440, height: 900 } : { width: 390, height: 844 },
  deviceScaleFactor: desk ? 1 : 2, isMobile: !desk, hasTouch: !desk, colorScheme: process.argv.includes("--dark") ? "dark" : "light",
});
await ctx.addCookies([{ ...cookie(who), domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto(BASE + path, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
const click = arg("--click");
if (click) { await page.locator(`text=${click} >> visible=true`).first().click(); await page.waitForTimeout(800); }
const h = await page.evaluate(() => document.documentElement.scrollHeight);
const vh = desk ? 900 : 844;
for (let i = 0; i < screens && i * (vh - 120) < h; i++) {
  await page.evaluate((y) => window.scrollTo(0, y), i * (vh - 120));
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${out}-${i + 1}.png` });
}
console.log(`page height ${h}px`);
await browser.close();
