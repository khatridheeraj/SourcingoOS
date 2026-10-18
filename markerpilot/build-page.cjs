// Builds public/markerpilot/index.html, the page behind Markers, from MarkerPilot's website build.
// MarkerPilot is built elsewhere (its own web/build.cjs, one page with every library inlined); this swaps its
// website shim for markerpilot/shim.js, so the page talks to the OS instead of Netlify.
// Usage: node markerpilot/build-page.cjs <MarkerPilot web/public/index.html>
const fs = require("fs"), path = require("path");
const [source] = process.argv.slice(2);
if (!source) { console.error("Usage: node markerpilot/build-page.cjs <MarkerPilot web/public/index.html>"); process.exit(1); }
const html = fs.readFileSync(source, "utf8");
const start = html.indexOf("<script>/* Website shim");
const end = html.indexOf("</script>", start);
if (start < 0 || end < 0 || html.indexOf("<script>/* Website shim", start + 1) >= 0) throw new Error("MarkerPilot's website shim was not found exactly once");
const shim = fs.readFileSync(path.join(__dirname, "shim.js"), "utf8").replace(/<\/script/gi, "<\\/script");
const out = html.slice(0, start) + "<script>" + shim + html.slice(end);
if (/\/\.netlify\/|\/api\/jobs|\/api\/styles/.test(out)) throw new Error("The page still calls the Netlify site");
const dest = path.join(__dirname, "..", "public", "markerpilot", "index.html");
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, out);
console.log("wrote", dest, out.length, "bytes");
