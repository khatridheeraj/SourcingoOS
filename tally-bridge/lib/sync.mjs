// One sync round: check Tally, check in with Sourcingo OS, and when reading is
// switched on and due, read Tally's books and send them to the app.
// This program only reads Tally. It never writes anything into it.
import { companiesRequest, itemsRequest, ledgersRequest, parseCompanies, parseItems, parseLedgers, parseVouchers, vouchersRequest } from "./xml.mjs";

export const VERSION = "2.0.0";

// Indian financial year start for a date: 2026-10-04 -> 2026-04-01.
export function fyStart(iso) {
  const [y, m] = iso.split("-").map(Number);
  return `${m >= 4 ? y : y - 1}-04-01`;
}
const today = (now) => new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10); // India

// Vouchers are read from the "read from" date in the app, or else from the start
// of last financial year, so unpaid invoices from last year are seen too.
export function readRange(s, now) {
  const to = today(now);
  const lastYear = fyStart(`${Number(fyStart(to).slice(0, 4)) - 1}-06-01`);
  const from = s.read_from && /^\d{4}-\d{2}-\d{2}$/.test(s.read_from) ? s.read_from : lastYear;
  return { from: from > to ? to : from, to };
}

export function createSync({ tally, cloud, log = () => {}, now = () => new Date(), readMinutes = 15 }) {
  const state = { lastRead: 0, info: {} };

  async function read(s) {
    const { from, to } = readRange(s, now());
    const ledgers = parseLedgers(await tally(ledgersRequest(s.company)));
    const items = parseItems(await tally(itemsRequest(s.company)));
    const vouchers = parseVouchers(await tally(vouchersRequest(s.company, from, to)));
    const r = await cloud.snapshot({ ledgers, items, vouchers, from, to });
    state.lastRead = now().getTime();
    log(`Read ${ledgers.length} ledgers, ${items.length} stock items and ${vouchers.length} vouchers (${from} to ${to}) from Tally` +
        (r?.linked ? `; linked ${r.linked} buyers and factories to their ledgers.` : "."));
    return { ledgers: ledgers.length, items: items.length, vouchers: vouchers.length };
  }

  async function round() {
    let companies = [];
    try {
      companies = parseCompanies(await tally(companiesRequest()));
      state.info = { tally: "online", companies };
    } catch (e) {
      state.info = { tally: "offline", tally_error: String(e?.message ?? e) };
    }
    const hello = (extra = {}) => cloud.hello({ version: VERSION, ...state.info, ...extra, checked_at: now().toISOString() });
    const s = await hello();
    if (state.info.tally !== "online" || !s.enabled) return { read: false };
    if (!companies.some((c) => c.toLowerCase() === String(s.company ?? "").toLowerCase())) {
      await hello({ tally_error: `Company "${s.company}" isn't open in Tally. Open it in Tally.` });
      return { read: false };
    }
    const due = !state.lastRead || now().getTime() - state.lastRead >= readMinutes * 60e3;
    if (!due) return { read: false };
    return { read: true, ...(await read(s)) };
  }

  return { round, state };
}

// Talks to Tally's built-in server (F1 > Settings > Connectivity).
export function tallyClient(url, timeoutMs = 120000) {
  return async (xml) => {
    const res = await fetch(url, {
      method: "POST", body: xml, headers: { "Content-Type": "text/xml;charset=utf-8" }, signal: AbortSignal.timeout(timeoutMs),
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const utf16 = buf[0] === 0xff && buf[1] === 0xfe;
    return new TextDecoder(utf16 ? "utf-16le" : "utf-8").decode(buf);
  };
}

// Talks to Sourcingo OS through its database functions, using the sync key.
export function cloudClient({ supabaseUrl, supabaseKey, syncKey }) {
  async function rpc(fn, args) {
    const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_key: syncKey, ...args }),
      signal: AbortSignal.timeout(120000),
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message ?? text; } catch {}
      throw new Error(`Sourcingo OS: ${msg}`);
    }
    return text ? JSON.parse(text) : null;
  }
  return {
    hello: (info) => rpc("tally_bridge_hello", { p_info: info }),
    snapshot: (p) => rpc("tally_bridge_snapshot", { p }),
  };
}
