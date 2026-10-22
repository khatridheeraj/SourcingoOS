// Reads a buyer's ask, pasted from WhatsApp or email or typed in a line ("Uptownie 1200 satin co-ords @450"),
// into the fields of an inquiry. No AI and no cost: plain patterns, and the buyer names the app already knows.
// It only suggests; the person sees every field before it saves.

export type ParseBuyer = { id: string; names: string[] };
export type ParsedInquiry = {
  buyer_id: string;
  prospect: string;
  contact_name: string;
  contact: string;
  source: string;
  product: string;
  est_qty: string;
  unit: "pcs" | "m";
  target_price: string;
  notes: string;
};

// "[21/10/26, 10:32:11 AM] Sana: …" (copied messages) and "21/10/26, 10:32 - Sana: …" (exported chats).
const WA_LINE = /^\s*\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}[:.]\d{2}(?:[:.]\d{2})?\s*(?:[ap]\.?m\.?)?\]?\s*(?:-\s*)?([^:\n]{1,60}):\s?/i;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /(?:\+?91[\s-]?)?\b[6-9]\d{4}[\s-]?\d{5}\b/;
const QTY = /(\d[\d,]*(?:\.\d+)?)\s*(k)?\s*(pcs?|pieces?|nos?|units?|sets?|mtrs?|meters?|metres?|m)\b/i;
const QTY_WORD = /\b(?:qty|quantity|moq)\s*[:\-]?\s*(\d[\d,]*)(\s*k\b)?/i;
const PRICE = /(?:₹|rs\.?|inr|@|target(?:\s+price)?|price|rate|fob|cost)\s*[:\-]?\s*(?:₹|rs\.?)?\s*(\d[\d,]*(?:\.\d{1,2})?)(?:\s*\/-)?|(\d[\d,]*(?:\.\d{1,2})?)\s*(?:\/-|\/\s*pcs?\b|per\s+(?:pc|piece|pcs)\b|rs\b|rupees\b)/i;
const GREETING = /^(?:hi+|hello|hey|dear\b[^,\n]*|good\s+(?:morning|afternoon|evening)|greetings|namaste|hope you[^.\n]*)[\s,!.]*/i;
const COMPANY_WORDS = /\b(?:pvt|private|ltd|limited|llp|inc|co|company|india|retail|fashions?|apparels?|clothing|studio|the|and|&)\b\.?/gi;
const GARMENT = /\b(?:co-?ords?|sets?|kurtas?|kurtis?|dress(?:es)?|tops?|tunics?|shirts?|t-?shirts?|tees?|trousers?|pants?|jeans|skirts?|shorts?|jackets?|blazers?|suits?|sarees?|dupattas?|night\s*suits?|pyjamas?|kaftans?|gowns?|fabric|lehengas?|palazzos?|joggers?|hoodies?|sweatshirts?|polos?)\b/i;

const num = (s: string) => s.replace(/,/g, "");
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The names a buyer is known by, from the longest down: "Salt Attire (Mimoto Technologies)" also answers to
// "Salt Attire", "Mimoto Technologies" and "Mimoto"; a code like BYR-SA-0006 counts too.
export function buyerAliases(names: string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const n = raw.trim();
    if (!n) continue;
    out.add(n);
    const parts = [n.replace(/\(.*?\)/g, ""), ...Array.from(n.matchAll(/\(([^)]+)\)/g), (m) => m[1])];
    for (const p of parts) {
      const t = p.trim();
      if (t.length >= 3) out.add(t);
      const core = t.replace(COMPANY_WORDS, " ").replace(/\s+/g, " ").trim();
      if (core.length >= 4) out.add(core);
    }
  }
  return [...out].sort((a, b) => b.length - a.length);
}

export function findBuyer(text: string, buyers: ParseBuyer[]): { id: string; alias: string } | null {
  let best: { id: string; alias: string } | null = null;
  for (const b of buyers) {
    for (const a of buyerAliases(b.names)) {
      if (best && a.length <= best.alias.length) break;
      if (new RegExp(`(^|[^\\p{L}\\p{N}])${esc(a)}($|[^\\p{L}\\p{N}])`, "iu").test(text)) {
        best = { id: b.id, alias: a };
        break;
      }
    }
  }
  return best;
}

// A buyer whose name is the email's domain: kavya@lumenstudio.in is Lumen Studio.
export function buyerByDomain(email: string, buyers: ParseBuyer[]): string {
  const host = (email.split("@")[1] ?? "").split(".")[0]?.toLowerCase() ?? "";
  if (host.length < 4) return "";
  const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  return buyers.find((b) => buyerAliases(b.names).some((a) => flat(a).length >= 4 && (flat(a) === host || host.startsWith(flat(a)))))?.id ?? "";
}

export function parseInquiry(input: string, buyers: ParseBuyer[]): ParsedInquiry {
  const out: ParsedInquiry = { buyer_id: "", prospect: "", contact_name: "", contact: "", source: "", product: "", est_qty: "", unit: "pcs", target_price: "", notes: "" };
  const text = input.replace(/\r/g, "").trim();
  if (!text) return out;

  // WhatsApp lines: who sent them, and the messages without their time stamps.
  const lines = text.split("\n");
  let fromWa = false;
  const body = lines.map((l) => {
    const m = l.match(WA_LINE);
    if (!m) return l;
    fromWa = true;
    const sender = m[1].trim();
    if (!out.contact_name && !/^(you|me)$/i.test(sender) && !/^\+?[\d\s-]+$/.test(sender)) out.contact_name = sender;
    if (!out.contact && /^\+?[\d\s-]{10,}$/.test(sender)) out.contact = sender.replace(/\s+/g, " ");
    return l.slice(m[0].length);
  }).join("\n").trim();
  const multi = body.split("\n").filter((l) => l.trim()).length > 1 || body.length > 120;

  const email = body.match(EMAIL)?.[0] ?? "";
  const phone = body.match(PHONE)?.[0] ?? "";
  if (!out.contact) out.contact = email || phone.replace(/\s+/g, " ");
  out.source = fromWa ? "whatsapp" : email ? "email" : "";

  let rest = body.replace(EMAIL, " ").replace(PHONE, " ");
  const q = rest.match(QTY);
  const qw = q ? null : rest.match(QTY_WORD);
  if (q) {
    const n = Number(num(q[1])) * (q[2] ? 1000 : 1);
    if (n > 0 && n < 10_000_000) {
      out.est_qty = String(Math.round(n));
      if (/^m(trs?|eters?|etres?)?$/i.test(q[3])) out.unit = "m";
      rest = rest.replace(q[0], " ");
    }
  } else if (qw) {
    out.est_qty = String(Math.round(Number(num(qw[1])) * (qw[2] ? 1000 : 1)));
    rest = rest.replace(qw[0], " ");
  }
  const p = rest.match(PRICE);
  if (p) {
    const v = Number(num(p[1] ?? p[2]));
    if (v > 0 && v < 100_000) {
      out.target_price = String(v);
      rest = rest.replace(p[0], " ");
    }
  }
  // A typed line often has the quantity bare: "Uptownie 1200 satin co-ords".
  const bare = !out.est_qty && !multi ? rest.match(/(?:^|\s)(\d[\d,]*(?:\.\d+)?)(k)?(?=\s|$)/i) : null;
  if (bare) {
    const n = Number(num(bare[1])) * (bare[2] ? 1000 : 1);
    if (n >= 10 && Number.isInteger(n)) {
      out.est_qty = String(n);
      rest = rest.replace(bare[0], " ");
    }
  }

  const buyer = findBuyer(body, buyers) ?? (out.contact_name ? findBuyer(out.contact_name, buyers) : null);
  if (!buyer && email) out.buyer_id = buyerByDomain(email, buyers);
  if (buyer) {
    out.buyer_id = buyer.id;
    rest = rest.replace(new RegExp(esc(buyer.alias), "i"), " ");
    out.contact_name = out.contact_name.replace(new RegExp(esc(buyer.alias), "i"), "").replace(/\s+/g, " ").trim();
  }

  if (!multi) {
    // A typed line: "<buyer>, <what>" or "<what> for <buyer>".
    let line = rest.replace(/\s+/g, " ").trim();
    if (!buyer) {
      const lead = line.match(/^([A-Za-z][\w&.' ]{1,38}?)\s*[,:\-–]\s+(.+)$/);
      const tail = line.match(/^(.+?)\s+(?:for|from)\s+([A-Z][\w&.' ]{1,38})$/);
      if (lead && !/\d/.test(lead[1])) {
        out.prospect = lead[1].trim();
        line = lead[2];
      } else if (tail) {
        out.prospect = tail[2].trim();
        line = tail[1];
      }
    }
    out.product = tidy(line);
  } else {
    // A message: the line that names a garment, else the first real line.
    const msgLines = rest.split("\n").map((l) => l.replace(GREETING, "").trim()).filter((l) => l.length > 2);
    const pick = msgLines.find((l) => GARMENT.test(l)) ?? msgLines[0] ?? "";
    const clauses = pick.split(/[.;,!?]|\s[-–]\s/).map((c) => c.trim()).filter(Boolean);
    const clause = (clauses.find((c) => GARMENT.test(c)) ?? clauses[0] ?? "")
      .replace(/^.*?\b(?:looking for|need(?:s|ed)?|require[sd]?|want(?:s|ed)?|interested in|enquiry for|inquiry for|(?:costing|price|prices|quote|quotation|rates?)\s+(?:for|of))\s+/i, "")
      .replace(/^(?:a\s+)?(?:vendor|supplier|manufacturer|factory)\s+(?:for|of)\s+/i, "");
    out.product = tidy(clause).slice(0, 90);
    out.notes = body.slice(0, 4000);
  }
  return out;
}

function tidy(s: string): string {
  const t = s.replace(/\b(?:for|of|in|at|qty|quantity|target|price|rate|approx|around|about|need|needs|needed|want|wants|looking for|require[sd]?)\s*$/i, "")
    .replace(/^\s*(?:for|of|need|needs|want|wants|looking for|require[sd]?|enquiry|inquiry)\b\s*/i, "")
    .replace(/\s*[,;:\-–@]+\s*$/g, "").replace(/^[\s,;:\-–@]+/, "").replace(/\s{2,}/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}
