// Which factories could make what a buyer asked for, from what they have already made for us. Free and explainable:
// the ask and every past style are reduced to garment-trade words, and a factory scores on the styles it shares the
// most words with (the kind of garment counts double), nudged by its record with us. A factory on a watch record is
// never suggested.

const STOP = new Set(["the", "and", "with", "for", "per", "pcs", "piece", "pieces", "set", "sets", "colour", "colours", "color", "colors",
  "size", "sizes", "new", "style", "styles", "order", "our", "your", "from", "each", "all", "full", "half", "inch", "cm", "metre", "metres",
  "meter", "meters", "qty", "approx", "about", "like", "similar", "same", "sample", "price", "target", "usd", "inr", "eur", "gbp"]);

// What kind of garment or fabric it is: these decide a match more than a colour or a trim does.
const KINDS = new Set(["kurta", "kurti", "coord", "kaftan", "dress", "top", "shirt", "blouse", "tunic", "pant", "trouser", "palazzo",
  "skirt", "jacket", "dupatta", "scarf", "stole", "jumpsuit", "nightwear", "pyjama", "robe", "gown", "lehenga", "saree", "shrug", "fabric",
  "denim", "kimono", "short", "anarkali", "suit"]);

const SAME: Record<string, string> = { caftan: "kaftan", kurti: "kurta", kurtis: "kurta", coords: "coord", trousers: "trouser", pants: "pant",
  pyjamas: "pyjama", pajama: "pyjama", tops: "top", shorts: "short", blockprint: "block", handblock: "block", printed: "print", prints: "print",
  embroidered: "embroidery", dresses: "dress", fabrics: "fabric", cotton: "cotton", viscose: "rayon" };

export function words(text: string | null | undefined): string[] {
  const t = (text ?? "").toLowerCase().replace(/co[\s-]?ord(s|inates?)?/g, "coord").replace(/hand[\s-]?block/g, "block").replace(/block[\s-]?print(ed)?/g, "block print");
  const out = new Set<string>();
  for (let w of t.split(/[^a-z]+/)) {
    if (w.length < 3 || STOP.has(w)) continue;
    w = SAME[w] ?? w;
    if (w.length > 4 && w.endsWith("s") && !w.endsWith("ss")) w = SAME[w.slice(0, -1)] ?? w.slice(0, -1);
    if (!STOP.has(w)) out.add(w);
  }
  return [...out];
}

export type PastLine = { factory_id: string; style: string; description: string | null; fabric: string | null; product: string };
export type FactoryInfo = { id: string; name: string; active: boolean; level?: "new" | "strong" | "steady" | "watch"; line?: string };
export type Match = { factory: FactoryInfo; score: number; styles: string[]; shared: string[] };

export function matchFactories(ask: string, lines: PastLine[], factories: FactoryInfo[], top = 3): Match[] {
  const want = words(ask);
  if (!want.length) return [];
  const wantSet = new Set(want);
  const askKinds = want.filter((w) => KINDS.has(w));
  const byId = new Map(factories.map((f) => [f.id, f]));
  const per = new Map<string, { scores: number[]; styles: Map<string, number>; shared: Set<string> }>();
  for (const l of lines) {
    const f = byId.get(l.factory_id);
    if (!f || !f.active || f.level === "watch") continue;
    const have = words([l.style, l.description, l.fabric, l.product === "fabric" ? "fabric" : ""].join(" "));
    const shared = have.filter((w) => wantSet.has(w));
    // A different kind of garment is not a match, however many trims it shares.
    if (askKinds.length && !shared.some((w) => KINDS.has(w))) continue;
    const score = shared.reduce((s, w) => s + (KINDS.has(w) ? 2 : 1), 0);
    if (!score) continue;
    const p = per.get(f.id) ?? { scores: [] as number[], styles: new Map<string, number>(), shared: new Set<string>() };
    p.scores.push(score);
    p.styles.set(l.style, Math.max(score, p.styles.get(l.style) ?? 0));
    shared.forEach((w) => p.shared.add(w));
    per.set(f.id, p);
  }
  const out: Match[] = [];
  for (const [id, p] of per) {
    const f = byId.get(id)!;
    const best = p.scores.sort((a, b) => b - a).slice(0, 3).reduce((s, x) => s + x, 0);
    const score = best + (f.level === "strong" ? 2 : f.level === "steady" ? 1 : 0);
    const styles = [...p.styles].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s).slice(0, 3);
    out.push({ factory: f, score, styles, shared: [...p.shared].sort((a, b) => Number(KINDS.has(b)) - Number(KINDS.has(a)) || a.localeCompare(b)) });
  }
  return out.sort((a, b) => b.score - a.score || a.factory.name.localeCompare(b.factory.name)).slice(0, top);
}
