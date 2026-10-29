// Help never shows anything nobody asked for, and what it shows fits the role (team note #15, 29 Oct 2026).
// For every role, on a phone and a computer, light and dark: Help opens quiet (the greeting and the question list),
// a typed "why can't I" question on an order never starts the live check by itself, a tapped check keeps the
// person's own question, finishes, and for Quality talks about visits and QC only.
//   node e2e/help.mjs [--shots dir] [--roles quality,merch]
import { createRequire } from "node:module";
import fs from "node:fs";
import { cookie } from "./token.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const shots = arg("--shots");
const roles = (arg("--roles") ?? "owner,manager,merch,quality,accounts,factory,buyer").split(",");
if (shots) fs.mkdirSync(shots, { recursive: true });
const VIEWS = [["phone", false], ["desk", false], ["phone", true]];
// The orders team's actions, which Quality can't take.
const NOT_FOR_QUALITY = /Done date|Fill the Done|move the target|Targets are locked|Locked · Ask|Send PO|approv|Start production/i;
const UNASKED = /Live check of|Checking this order|ऑर्डर देख रहे हैं/;

const browser = await pw.chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
const problems = [];
const bad = (who, form, dark, url, text) => problems.push(`PROBLEM help at ${url}: ${text} [${who}/${form}${dark ? "/dark" : ""}]`);

for (const who of roles) {
  for (const [form, dark] of VIEWS) {
    const ctx = await browser.newContext({
      viewport: form === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: form === "phone" ? 2 : 1, isMobile: form === "phone", hasTouch: form === "phone", colorScheme: dark ? "dark" : "light",
    });
    await ctx.addCookies([{ ...cookie(who), domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => bad(who, form, dark, page.url(), `page error ${e.message}`));
    const sheet = page.locator("dialog.help-sheet");
    const open = async () => {
      // A tap before the page has hydrated does nothing, so tap again until the sheet is up.
      for (let i = 0; i < 10 && !(await sheet.isVisible()); i++) {
        await page.locator(".help-btn[aria-label^=\"Help\"]:visible, .side-help:visible, .help-pill:visible").first().click();
        await sheet.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
      }
      await sheet.waitFor({ state: "visible", timeout: 3000 });
      await page.waitForTimeout(2500);
    };
    const shot = async (name) => { if (shots) await sheet.screenshot({ path: `${shots}/${who}-${form}${dark ? "-dark" : ""}-${name}.png` }); };

    const start = who === "factory" ? "/factory" : who === "buyer" ? "/buyer" : "/today";
    await page.goto(BASE + start, { waitUntil: "networkidle", timeout: 60000 });
    await open();
    if (UNASKED.test(await sheet.innerText())) bad(who, form, dark, start, "something ran before anyone asked");
    if (await sheet.locator(".compose").count()) bad(who, form, dark, start, "a note form opened by itself");
    await shot("home");
    if (who === "factory" || who === "buyer") { await ctx.close(); continue; }

    // An order page: open Help, then ask a stuck question in the words QC used.
    await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 60000 });
    const href = await page.$$eval("a[href^='/orders/']", (as) => as.map((a) => a.getAttribute("href")).find((h) => /^\/orders\/[0-9a-f-]{36}$/.test(h ?? "")));
    if (!href) { bad(who, form, dark, "/", "no order to open"); await ctx.close(); continue; }
    await page.goto(BASE + href, { waitUntil: "networkidle", timeout: 60000 });
    await open();
    if (UNASKED.test(await sheet.innerText())) bad(who, form, dark, "/orders/ID", "something ran before anyone asked");
    await shot("order");
    const question = "Inline mid-line nahi aa raha, why can't I enter the done date";
    await sheet.locator("textarea").fill(question);
    await sheet.locator("textarea").press("Enter");
    await page.waitForTimeout(2500);
    if (UNASKED.test(await sheet.innerText())) bad(who, form, dark, "/orders/ID", "a typed question started the live check without a tap");
    const run = sheet.getByRole("button", { name: "Check this order" });
    if (!(await run.count())) bad(who, form, dark, "/orders/ID", "no Check this order button under a stuck question");
    else {
      await run.click();
      await sheet.locator(".help-check").waitFor({ timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(1500);
      const text = await sheet.innerText();
      if (/Checking this order/.test(text)) bad(who, form, dark, "/orders/ID", "the check never finished");
      if (!(await sheet.locator(".bub.me", { hasText: question }).count())) bad(who, form, dark, "/orders/ID", "the person's own question disappeared");
      const check = await sheet.locator(".help-check").innerText().catch(() => "");
      if (!check) bad(who, form, dark, "/orders/ID", "no check shown after the tap");
      if (who === "quality" && NOT_FOR_QUALITY.test(check)) bad(who, form, dark, "/orders/ID", `Quality was told the orders team's work: ${check.match(NOT_FOR_QUALITY)[0]}`);
      await sheet.locator(".help-log").evaluate((el) => el.scrollTo(0, el.scrollHeight));
      await page.waitForTimeout(600);
      await shot("order-check");
    }
    // Back on Home the old order's check is gone.
    await sheet.getByRole("button", { name: "Close" }).click();
    await page.locator(`a[href="/today"]:visible`).first().click();
    await page.waitForURL(/\/today/);
    await page.waitForLoadState("networkidle");
    await open();
    if (UNASKED.test(await sheet.innerText())) bad(who, form, dark, "/today", "an order's check followed the person to another page");
    await ctx.close();
  }
}
await browser.close();
for (const p of problems) console.log(p);
console.log(problems.length ? `${problems.length} Help problems.` : "Help: nothing shows unasked, and every role gets its own answers.");
process.exit(problems.length ? 1 : 0);
