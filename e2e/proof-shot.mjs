// Screenshots of marking a step done with its photo (the photo is required): node e2e/proof-shot.mjs <order id> <out-prefix> [--dark]
import { createRequire } from "node:module";
import { cookie } from "./token.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }
const [id, out] = process.argv.slice(2);
const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const browser = await pw.chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  colorScheme: process.argv.includes("--dark") ? "dark" : "light" });
await ctx.addCookies([{ ...cookie("merch"), domain: "localhost", path: "/" }]);
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto(`${BASE}/orders/${id}#tna`, { waitUntil: "networkidle" });
await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
await page.locator("text=All steps >> visible=true").first().click();
await page.waitForTimeout(400);
const done = page.locator('input[aria-label$="Finishing done"]').first();
await done.fill("2026-11-27");
await page.waitForTimeout(400);
await page.locator(".step-proof").first().scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -200));
await page.screenshot({ path: `${out}-1.png` });
await page.locator(".savebar").scrollIntoViewIfNeeded();
await page.screenshot({ path: `${out}-2.png` });
// The one-tap button opens the camera on a phone (it shows once nothing is left unsaved).
await page.reload({ waitUntil: "networkidle" });
await page.locator(".done-btn").first().scrollIntoViewIfNeeded();
await page.evaluate(() => window.scrollBy(0, -200));
await page.screenshot({ path: `${out}-3.png` });
await browser.close();
