// Opens every screen as every role, on a phone and a computer, in light and dark, and reports
// anything wrong: page errors, console errors, failed requests, error boxes, pages wider than
// the phone, slow pages and stray "undefined"/"NaN"/"null" text.
//   node e2e/crawl.mjs [--shots dir] [--roles merch,owner] [--quick]
// Exits 1 when it finds a problem, so the hourly check knows to look.
import { createRequire } from "node:module";
import fs from "node:fs";
import { cookie } from "./token.mjs";

const require = createRequire(import.meta.url);
let pw;
try { pw = require("playwright"); } catch { pw = require("/opt/node22/lib/node_modules/playwright"); }

const BASE = process.env.E2E_BASE ?? "http://localhost:3100";
const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const shots = arg("--shots");
const quick = process.argv.includes("--quick");
const roles = (arg("--roles") ?? "owner,manager,merch,quality,accounts,factory,buyer").split(",");
if (shots) fs.mkdirSync(shots, { recursive: true });

const STAFF = ["/today", "/", "/?status=late", "/orders/new", "/inquiries", "/inquiries/new", "/pos", "/goods", "/updates", "/samples", "/brief",
  "/buyers", "/factories", "/styles", "/reports", "/payments", "/payables", "/tally", "/team", "/activity", "/feedback"];
const VIEWS = quick ? [["phone", false]] : [["phone", false], ["desk", false], ["phone", true], ["desk", true]];

const browser = await pw.chromium.launch({ executablePath: process.env.E2E_CHROMIUM || undefined });
const problems = [];
let opened = 0;

// Order pages and other detail pages come from links on the lists, so new records get checked too.
async function detailLinks(page) {
  const hrefs = await page.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
  const keep = new Set();
  for (const h of hrefs) {
    if (!h || !h.startsWith("/")) continue;
    const m = /^\/(orders|inquiries|pos|payments\/(cheques|invoices))\/[0-9a-f-]{36}(\/[a-z-]+)?$/.exec(h.split("#")[0].split("?")[0]);
    if (m) keep.add(h.split("#")[0]);
  }
  return [...keep];
}

for (const who of roles) {
  for (const [form, dark] of VIEWS) {
    const ctx = await browser.newContext({
      viewport: form === "phone" ? { width: 390, height: 844 } : { width: 1440, height: 900 },
      deviceScaleFactor: form === "phone" ? 2 : 1, isMobile: form === "phone", hasTouch: form === "phone",
      colorScheme: dark ? "dark" : "light",
    });
    const c = cookie(who);
    await ctx.addCookies([{ ...c, domain: "localhost", path: "/" }]);
    const page = await ctx.newPage();
    let current = "";
    page.on("pageerror", (e) => problems.push({ who, form, dark, url: current, kind: "page error", text: e.message }));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      if (/Download the React DevTools|favicon|\[HMR\]|webpack-hmr|__nextjs_original-stack-frame/.test(t)) return;
      problems.push({ who, form, dark, url: current, kind: "console error", text: t.slice(0, 300) });
    });
    page.on("response", (r) => {
      if (r.status() >= 500 || (r.status() >= 400 && r.url().includes("/rest/v1/")))
        problems.push({ who, form, dark, url: current, kind: `HTTP ${r.status()}`, text: r.url().replace(/^https?:\/\/[^/]+/, "").slice(0, 200) });
    });
    const start = who === "factory" ? ["/factory"] : who === "buyer" ? ["/buyer"] : STAFF;
    const queue = [...start];
    const seen = new Set();
    while (queue.length) {
      const path = queue.shift();
      if (seen.has(path)) continue;
      seen.add(path);
      current = path;
      const t0 = Date.now();
      try {
        // A dev server sometimes aborts a navigation while it recompiles; one retry tells that apart from a real failure.
        await page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 })
          .catch((e) => (/ERR_ABORTED/.test(e.message) ? page.goto(BASE + path, { waitUntil: "networkidle", timeout: 45000 }) : Promise.reject(e)));
      } catch (e) {
        problems.push({ who, form, dark, url: path, kind: "did not load", text: e.message.split("\n")[0] });
        continue;
      }
      opened++;
      const ms = Date.now() - t0;
      const info = await page.evaluate(() => {
        const main = document.querySelector("main") ?? document.body;
        const text = main.innerText;
        const odd = (text.match(/\b(undefined|NaN|null|\[object Object\])\b/g) ?? []).slice(0, 3);
        const err = [...document.querySelectorAll(".errbox")].map((e) => e.textContent.trim().slice(0, 200));
        const wide = document.documentElement.scrollWidth > window.innerWidth + 1;
        const notFound = /This page could not be found|404/.test(document.title) || !!document.querySelector("[data-next-error]");
        return { odd, err, wide, notFound, title: document.title };
      });
      if (info.odd.length) problems.push({ who, form, dark, url: path, kind: "odd text", text: info.odd.join(", ") });
      for (const e of info.err) problems.push({ who, form, dark, url: path, kind: "error box", text: e });
      if (info.wide && form === "phone") problems.push({ who, form, dark, url: path, kind: "wider than phone", text: "" });
      if (ms > 8000 && !quick) problems.push({ who, form, dark, url: path, kind: "slow", text: `${ms} ms` });
      if (shots) await page.screenshot({ path: `${shots}/${who}-${form}${dark ? "-dark" : ""}-${path.replace(/[^a-z0-9]+/gi, "_").slice(0, 60) || "root"}.png`, fullPage: true });
      // Follow detail pages from the main lists once per role and view.
      if (["/", "/inquiries", "/pos", "/payments", "/?status=late"].includes(path)) {
        for (const h of (await detailLinks(page)).slice(0, quick ? 3 : 12)) if (!seen.has(h)) queue.push(h);
      }
      if (/^\/orders\/[0-9a-f-]{36}$/.test(path)) {
        for (const h of ["#tna", "#qc", "#dispatch", "#details", "#history"]) queue.push(path + h);
      }
    }
    await ctx.close();
  }
}
await browser.close();

console.log(`Opened ${opened} pages for ${roles.length} roles.`);
const uniq = new Map();
for (const p of problems) {
  const k = `${p.kind}|${p.url}|${p.text}`;
  const v = uniq.get(k) ?? { ...p, where: [] };
  v.where.push(`${p.who}/${p.form}${p.dark ? "/dark" : ""}`);
  uniq.set(k, v);
}
for (const p of uniq.values()) console.log(`PROBLEM ${p.kind} at ${p.url}: ${p.text} [${p.where.slice(0, 4).join(", ")}${p.where.length > 4 ? ` +${p.where.length - 4}` : ""}]`);
if (!uniq.size) console.log("No problems found.");
process.exit(uniq.size ? 1 : 0);
