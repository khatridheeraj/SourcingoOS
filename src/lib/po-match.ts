// Is a buyer PO the same as an order already entered? A PO number alone is not enough: buyers reuse numbers,
// and an order's number can be typed wrong. The styles decide.

// A style with only its letters and digits, lower case: "AV-135", "av 135" and "AV135" match.
export const styleKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// The PO number as the order form compares it (orders_buyer_po_key): spaces at the ends and case don't count.
export const poNoKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

// same: they share at least one style. different: no style in common, so this is another PO.
// unknown: no styles were read from the PO, so only a person comparing the two can tell.
export type PoVerdict = "same" | "different" | "unknown";

export type PoComparison = { verdict: PoVerdict; shared: string[]; onlyPo: string[]; onlyOrder: string[] };

export function comparePo(poStyles: string[], orderStyles: string[]): PoComparison {
  const uniq = (list: string[]) => {
    const seen = new Map<string, string>();
    for (const s of list) {
      const k = styleKey(s);
      if (k && !seen.has(k)) seen.set(k, s.trim());
    }
    return seen;
  };
  const po = uniq(poStyles);
  const order = uniq(orderStyles);
  const shared = [...po].filter(([k]) => order.has(k)).map(([, s]) => s);
  const onlyPo = [...po].filter(([k]) => !order.has(k)).map(([, s]) => s);
  const onlyOrder = [...order].filter(([k]) => !po.has(k)).map(([, s]) => s);
  const verdict: PoVerdict = po.size === 0 || order.size === 0 ? "unknown" : shared.length ? "same" : "different";
  return { verdict, shared, onlyPo, onlyOrder };
}

// Does a file name name this style? "PO CHAVI PRODUCTION - AV135 (2).pdf" names AV-135, but not AV-13 or AV-1350:
// the style must not run on into more letters or digits.
export function fileNamesStyle(fileName: string, style: string): boolean {
  const key = styleKey(style);
  if (key.length < 3) return false;
  const name = fileName.replace(/\.[a-z0-9]{2,5}$/i, "").toLowerCase();
  // Walk the name's letters and digits, remembering where each word starts, so a match can be held to whole words.
  const chars: { c: string; start: boolean }[] = [];
  let gap = true;
  for (const c of name) {
    if (/[a-z0-9]/.test(c)) {
      chars.push({ c, start: gap });
      gap = false;
    } else gap = true;
  }
  const flat = chars.map((x) => x.c).join("");
  for (let i = flat.indexOf(key); i >= 0; i = flat.indexOf(key, i + 1)) {
    const end = i + key.length;
    const startsWord = chars[i].start || /\d/.test(key[0]) !== /\d/.test(flat[i - 1] ?? "");
    const endsWord = end === flat.length || chars[end].start || /\d/.test(key[key.length - 1]) !== /\d/.test(flat[end]);
    if (startsWord && endsWord) return true;
  }
  return false;
}
