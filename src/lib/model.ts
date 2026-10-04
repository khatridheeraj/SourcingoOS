// Business rules and sums shared by every screen. Pure functions only, so
// they run the same on the server and in the browser.

export type SoStatus = "draft" | "tna_review" | "locked" | "shipped";
export type TnaStatus = "pending" | "in_progress" | "completed" | "delayed";
export type GrnStatus = "draft" | "pending_approval" | "approved" | "rejected";
export type DcStatus = "draft" | "dispatched";
export type Condition = "good" | "damaged" | "short";
export type OrderType = "garment" | "fabric";

export const SIZES = ["S", "M", "L", "XL", "XXL", "3XL"] as const;
export const DEFAULT_CHECKPOINTS = ["Fabric Sourcing", "Cutting", "Sewing", "QC", "Packing", "Ready for Dispatch"];
export const CURRENCIES = ["INR", "USD", "EUR", "GBP"] as const;
export const SOURCES = ["Email", "PDF", "Buyer portal", "WhatsApp", "Phone", "Other"];
export const STAGES = ["Order confirmed", "Production", "QC", "Packing", "Ready to ship", "Shipped"];

export const SO_LABEL: Record<SoStatus, string> = { draft: "Draft", tna_review: "TNA review", locked: "Locked", shipped: "Shipped" };
export const TNA_LABEL: Record<TnaStatus, string> = { pending: "Pending", in_progress: "In progress", completed: "Completed", delayed: "Delayed" };
export const GRN_LABEL: Record<GrnStatus, string> = { draft: "Draft", pending_approval: "Pending approval", approved: "Approved", rejected: "Rejected" };
export const DC_LABEL: Record<DcStatus, string> = { draft: "Draft", dispatched: "Dispatched" };
export const CONDITION_LABEL: Record<Condition, string> = { good: "Good", damaged: "Damaged", short: "Short" };

export type Checkpoint = {
  id: string; style_id: string; position: number; name: string; due_date: string | null; status: TnaStatus;
  status_updated_at: string | null; status_updated_by: string | null;
};
export type Style = {
  id: string; so_id: string; position: number; name: string; code: string; fabric: string; colour: string; use_sizes: boolean;
  sizes: Record<string, number | string | null>; qty: number; buyer_rate: number; factory_rate: number | null;
  internal_note: string | null; checkpoints: Checkpoint[];
};
export type Order = {
  id: string; inquiry_id: string | null; buyer_id: string; buyer_po_number: string; order_type: OrderType; currency: string;
  so_date: string; order_source: string | null; tags: string[]; factory_id: string | null; payment_terms: string | null;
  delivery_address: string | null; merchandiser_id: string | null; manager_id: string | null; fabric_poc_id: string | null;
  quality_poc_id: string | null; buyer_date: string | null; factory_date: string | null; merch_date: string | null;
  remarks: string | null; terms: string | null; status: SoStatus; locked_at: string | null; locked_by: string | null;
  created_at: string; styles: Style[];
};
export type GrnLine = { id: string; grn_id: string; style_id: string; qty: number; condition: Condition };
export type Grn = {
  id: string; so_id: string; received_at: string; received_by: string | null; qc_checked: boolean; qc_note: string | null;
  notes: string | null; status: GrnStatus; approved_by: string | null; approved_at: string | null; created_by: string | null;
  created_at: string; lines: GrnLine[];
};
export type DcLine = { id: string; dc_id: string; style_id: string; qty: number };
export type Dc = {
  id: string; grn_id: string; so_id: string; courier: string | null; tracking: string | null; address: string | null;
  invoice_no: string | null; invoice_date: string | null; status: DcStatus; dispatched_at: string | null;
  created_by: string | null; created_at: string; lines: DcLine[];
};
export type Inquiry = {
  id: string; buyer_id: string; product_type: string; status: "new" | "quoted" | "converted" | "lost";
  next_follow_up: string | null; merchandiser_id: string | null; created_at: string; unit: string; so_id: string | null;
};
export type Buyer = { id: string; code: string; default_payment_terms: string | null; default_address: string | null; real_name?: string };
export type Factory = { id: string; name: string; city: string | null; active: boolean };
export type Person = { id: string; full_name: string | null; email: string; role: string | null; active: boolean };

// ───────── numbers and money ─────────
export const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const nf = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const SYM: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", GBP: "£" };
export function money(n: number, cur = "INR") {
  return (SYM[cur] ?? cur + " ") + num(n).toLocaleString(cur === "INR" ? "en-IN" : "en-US", { maximumFractionDigits: 2 });
}
// "₹1,20,000 + $3,000": totals never add different currencies together.
export function sumByCur(items: [number, string][]) {
  const m: Record<string, number> = {};
  for (const [v, c] of items) m[c || "INR"] = (m[c || "INR"] ?? 0) + num(v);
  const keys = Object.keys(m).filter((c) => m[c] || c === "INR");
  return (keys.length ? keys : ["INR"]).map((c) => money(m[c] ?? 0, c)).join(" + ");
}

// ───────── dates (business dates are Indian dates) ─────────
export const isoIST = (d: Date | string | number) => new Date(d).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
export function addDays(iso: string, n: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);

// ───────── orders ─────────
export const unitOf = (o: { order_type: OrderType }) => (o.order_type === "fabric" ? "m" : "pcs");
export const isLocked = (o: { status: SoStatus }) => o.status === "locked" || o.status === "shipped";
export const orderQty = (o: Order) => o.styles.reduce((a, s) => a + num(s.qty), 0);
export const orderValue = (o: Order) => o.styles.reduce((a, s) => a + num(s.qty) * num(s.buyer_rate), 0);
export const overdue = (cp: Checkpoint, today: string) => cp.status !== "completed" && !!cp.due_date && cp.due_date < today;
export const allCheckpoints = (o: Order) => o.styles.flatMap((s) => s.checkpoints.map((cp) => ({ style: s, cp })));

function stageOf(name: string) {
  const n = name.toLowerCase();
  if (/qc|inspect|quality/.test(n)) return 2;
  if (/pack/.test(n)) return 3;
  if (/dispatch|ship/.test(n)) return 4;
  return 1;
}
// Index into STAGES, the same milestone the buyer portal shows.
export function buyerStage(o: Order) {
  if (o.status === "shipped") return 5;
  if (o.status !== "locked") return 0;
  let first: Checkpoint | undefined;
  for (const { cp } of allCheckpoints(o)) {
    if (cp.status === "completed") continue;
    if (!first || (cp.due_date ?? "9999") < (first.due_date ?? "9999")) first = cp;
  }
  return first ? stageOf(first.name) : 4;
}

// Coloured bar segments for a TNA: c=completed, o=overdue, d=delayed, p=in progress.
export function progressCells(o: Order, today: string) {
  return allCheckpoints(o).map(({ cp }) =>
    cp.status === "completed" ? "c" : overdue(cp, today) ? "o" : cp.status === "delayed" ? "d" : cp.status === "in_progress" ? "p" : "",
  );
}

// ───────── warehouse ─────────
export const grnQty = (g: Grn) => g.lines.reduce((a, l) => a + num(l.qty), 0);
export const dcQty = (d: Dc) => d.lines.reduce((a, l) => a + num(l.qty), 0);
export const heldHours = (g: Grn, now: number) => (now - Date.parse(g.received_at)) / 36e5;

// Everything the screens need, indexed once.
export type World = ReturnType<typeof makeWorld>;
export function makeWorld(raw: {
  orders: Order[]; grns: Grn[]; dcs: Dc[]; inquiries: Inquiry[]; buyers: Buyer[]; factories: Factory[]; people: Person[];
  today: string; now: number; meId: string; isOwner: boolean;
}) {
  const orderById = new Map(raw.orders.map((o) => [o.id, o]));
  const styleById = new Map(raw.orders.flatMap((o) => o.styles.map((s) => [s.id, s] as const)));
  const buyerById = new Map(raw.buyers.map((b) => [b.id, b]));
  const factoryById = new Map(raw.factories.map((f) => [f.id, f]));
  const personById = new Map(raw.people.map((p) => [p.id, p]));
  const grnById = new Map(raw.grns.map((g) => [g.id, g]));

  const rate = (styleId: string) => num(styleById.get(styleId)?.buyer_rate);
  const currencyOf = (soId: string) => orderById.get(soId)?.currency ?? "INR";
  const grnValue = (g: Grn) => g.lines.reduce((a, l) => a + num(l.qty) * rate(l.style_id), 0);
  const dcValue = (d: Dc) => d.lines.reduce((a, l) => a + num(l.qty) * rate(l.style_id), 0);

  // Units of a style on a GRN that are on any DC (draft too) or only dispatched ones.
  const dcQtyFor = (grnId: string, styleId: string, excludeDc: string | null, onlyDispatched: boolean) =>
    raw.dcs
      .filter((d) => d.grn_id === grnId && d.id !== excludeDc && (!onlyDispatched || d.status === "dispatched"))
      .reduce((a, d) => a + d.lines.filter((l) => l.style_id === styleId).reduce((b, l) => b + num(l.qty), 0), 0);
  const grnHeld = (g: Grn) =>
    g.status === "rejected" ? 0 : g.lines.reduce((a, l) => a + Math.max(0, num(l.qty) - dcQtyFor(g.id, l.style_id, null, true)), 0);
  const grnAvail = (g: Grn, excludeDc: string | null = null) =>
    g.status === "rejected" || g.status === "draft"
      ? 0
      : g.lines.reduce((a, l) => a + Math.max(0, num(l.qty) - dcQtyFor(g.id, l.style_id, excludeDc, false)), 0);
  const receivedFor = (styleId: string, excludeGrn: string | null) =>
    raw.grns
      .filter((g) => g.status !== "rejected" && g.id !== excludeGrn)
      .reduce((a, g) => a + g.lines.filter((l) => l.style_id === styleId).reduce((b, l) => b + num(l.qty), 0), 0);
  const dispatchedFor = (soId: string) =>
    raw.dcs.filter((d) => d.so_id === soId && d.status === "dispatched").reduce((a, d) => a + dcQty(d), 0);
  const lateGrns = () => raw.grns.filter((g) => grnHeld(g) > 0 && heldHours(g, raw.now) >= 24);

  const buyerCode = (id: string | null | undefined) => (id ? buyerById.get(id)?.code ?? "Unknown buyer" : "—");
  const factoryName = (id: string | null | undefined) => (id ? factoryById.get(id)?.name ?? "Unknown factory" : "—");
  const personName = (id: string | null | undefined) => {
    if (!id) return "—";
    if (id === raw.meId) return "You";
    const p = personById.get(id);
    return p ? p.full_name || p.email : "Someone";
  };

  return {
    ...raw, orderById, styleById, buyerById, factoryById, personById, grnById,
    rate, currencyOf, grnValue, dcValue, dcQtyFor, grnHeld, grnAvail, receivedFor, dispatchedFor, lateGrns,
    buyerCode, factoryName, personName,
  };
}

// ───────── alerts ─────────
export type Alert = { sev: "bad" | "warn" | "info" | "note"; t: string; d: string; href: string; k?: string };

export function computeAlerts(w: World): Alert[] {
  const out: Alert[] = [];
  const t = w.today;
  if (!w.factories.some((f) => f.active)) {
    out.push({ sev: "info", t: "Add your factories", d: "Sales orders need a factory. Add them in Buyers & factories.", href: "/setup" });
  }
  if (w.isOwner && !w.people.some((p) => p.active && p.role === "merchandiser")) {
    out.push({ sev: "info", t: "Add your merchandiser", d: "Ask them to sign in, then give them the Merchandiser role in People & roles.", href: "/team" });
  }
  for (const g of w.grns) {
    const held = w.grnHeld(g);
    const so = w.orderById.get(g.so_id);
    const tag = `${g.so_id} · ${w.buyerCode(so?.buyer_id)}`;
    if (held > 0) {
      const h = heldHours(g, w.now);
      if (h >= 24) {
        out.push({ sev: "bad", t: `Zero-inventory breach: ${g.id} held ${Math.floor(h)} hours`, d: `${nf(held)} units still at Sourcingo · ${tag}. Invoice and dispatch now.`, href: `/grn/${g.id}`, k: "0" });
      } else if (h >= 12) {
        out.push({ sev: "warn", t: `Dispatch window closing: ${g.id}`, d: `${Math.ceil(24 - h)} hours left · ${nf(held)} units · ${tag}`, href: `/grn/${g.id}`, k: "1" });
      }
    }
    if (g.status === "pending_approval") {
      out.push({
        sev: w.isOwner ? "warn" : "info",
        t: w.isOwner ? `Approve ${g.id}` : `${g.id} waiting for approval`,
        d: `${nf(grnQty(g))} units from ${w.factoryName(so?.factory_id)}${g.qc_checked ? "" : " · QC not confirmed"}`,
        href: `/grn/${g.id}`,
      });
    }
    if (g.status === "draft") {
      out.push({ sev: "note", t: `${g.id} is still a draft`, d: `${tag} · submit it so the goods can be dispatched`, href: `/grn/${g.id}` });
    }
  }
  for (const o of w.orders) {
    const tag = `${o.id} · ${w.buyerCode(o.buyer_id)}`;
    if (o.status === "locked") {
      let allDone = true;
      for (const { style, cp } of allCheckpoints(o)) {
        if (cp.status !== "completed") allDone = false;
        const what = `${cp.name} for ${style.name} (${style.colour})`;
        if (overdue(cp, t)) {
          out.push({ sev: "bad", t: `Overdue: ${what}`, d: `${tag} · due ${fmtDay(cp.due_date)} · ${TNA_LABEL[cp.status]} · ${w.factoryName(o.factory_id)}`, href: `/orders/${o.id}`, k: cp.due_date ?? "" });
        } else if (cp.status === "delayed") {
          out.push({ sev: "warn", t: `Delayed: ${what}`, d: `${tag} · due ${fmtDay(cp.due_date)} · ${w.factoryName(o.factory_id)}`, href: `/orders/${o.id}`, k: cp.due_date ?? "" });
        }
      }
      const bd = o.buyer_date;
      if (!allDone && bd && bd >= t && bd <= addDays(t, 7)) {
        const n = daysBetween(t, bd);
        out.push({ sev: "warn", t: n === 0 ? "Buyer deadline today" : `Buyer deadline in ${n} day${n === 1 ? "" : "s"}`, d: `${tag} · delivery ${fmtDay(bd)} and production isn't complete`, href: `/orders/${o.id}`, k: bd });
      }
    } else if (o.status === "tna_review") {
      out.push({
        sev: w.isOwner ? "bad" : "info",
        t: w.isOwner ? "Waiting for your TNA lock" : "Waiting for the owner to lock the TNA",
        d: `${tag} · the factory gets the final PO only after the lock`,
        href: `/orders/${o.id}`,
      });
    }
  }
  for (const i of w.inquiries) {
    const open = i.status === "new" || i.status === "quoted";
    if (open && i.next_follow_up && i.next_follow_up <= t) {
      out.push({ sev: "warn", t: `Follow-up due: ${i.product_type} for ${w.buyerCode(i.buyer_id)}`, d: `${i.id} · ${i.merchandiser_id ? w.personName(i.merchandiser_id) : "unassigned"} · due ${fmtDay(i.next_follow_up)}`, href: `/inquiries?status=due`, k: i.next_follow_up });
    }
    if (i.status === "new" && !i.merchandiser_id) {
      out.push({ sev: "info", t: `Assign a merchandiser: ${i.id}`, d: `${i.product_type} for ${w.buyerCode(i.buyer_id)}`, href: `/inquiries?status=new` });
    }
  }
  const rank = { bad: 0, warn: 1, info: 2, note: 3 };
  return out.sort((a, b) => rank[a.sev] - rank[b.sev] || (a.k ?? "").localeCompare(b.k ?? ""));
}

export function fmtDay(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// ───────── sales order editor ─────────
export type DraftCheckpoint = { id: string; name: string; due_date: string };
export type DraftStyle = {
  id: string; name: string; code: string; fabric: string; colour: string; use_sizes: boolean; sizes: Record<string, string>;
  qty: string; buyer_rate: string; factory_rate: string; internal_note: string; checkpoints: DraftCheckpoint[];
};
export type Draft = {
  id: string; status: SoStatus; inquiry_id: string | null; buyer_id: string; buyer_po_number: string; order_type: OrderType;
  currency: string; so_date: string; order_source: string; tags: string; factory_id: string; payment_terms: string;
  delivery_address: string; merchandiser_id: string; manager_id: string; fabric_poc_id: string; quality_poc_id: string;
  buyer_date: string; factory_date: string; merch_date: string; remarks: string; terms: string; styles: DraftStyle[];
};

const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
export function toDraft(o: Order): Draft {
  return {
    id: o.id, status: o.status, inquiry_id: o.inquiry_id, buyer_id: o.buyer_id, buyer_po_number: o.buyer_po_number,
    order_type: o.order_type, currency: o.currency, so_date: s(o.so_date), order_source: s(o.order_source), tags: o.tags.join(", "),
    factory_id: s(o.factory_id), payment_terms: s(o.payment_terms), delivery_address: s(o.delivery_address),
    merchandiser_id: s(o.merchandiser_id), manager_id: s(o.manager_id), fabric_poc_id: s(o.fabric_poc_id),
    quality_poc_id: s(o.quality_poc_id), buyer_date: s(o.buyer_date), factory_date: s(o.factory_date), merch_date: s(o.merch_date),
    remarks: s(o.remarks), terms: s(o.terms),
    styles: o.styles.map((st) => ({
      id: st.id, name: st.name, code: st.code, fabric: st.fabric, colour: st.colour, use_sizes: st.use_sizes,
      sizes: Object.fromEntries(SIZES.map((z) => [z, s(st.sizes?.[z])])),
      qty: st.qty ? String(st.qty) : "", buyer_rate: st.buyer_rate ? String(st.buyer_rate) : "", factory_rate: s(st.factory_rate),
      internal_note: s(st.internal_note),
      checkpoints: st.checkpoints.map((c) => ({ id: c.id, name: c.name, due_date: s(c.due_date) })),
    })),
  };
}

export const draftQty = (st: DraftStyle, type: OrderType) =>
  type === "garment" && st.use_sizes ? SIZES.reduce((a, z) => a + num(st.sizes[z]), 0) : num(st.qty);

export function toPayload(d: Draft) {
  return {
    ...d,
    tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
    styles: d.styles.map((st) => ({ ...st, use_sizes: d.order_type === "garment" && st.use_sizes })),
  };
}

export function validateDraft(p: Draft, today: string) {
  const E: string[] = [];
  const W: string[] = [];
  if (!p.buyer_id) E.push("Choose the customer (buyer code).");
  if (!p.buyer_po_number.trim()) E.push("Enter the buyer PO / reference number.");
  if (!p.so_date) E.push("Set the sales order date.");
  if (!p.factory_id) E.push("Choose a factory.");
  if (!p.payment_terms.trim()) E.push('Enter the payment terms, for example "45 days post-receipt".');
  if (!p.merchandiser_id) E.push("Choose the demand POC (merchandiser).");
  if (!p.manager_id) E.push("Choose the merchandiser manager (escalation point).");
  if (!p.buyer_date) E.push("Set the buyer delivery date.");
  else if (p.buyer_date <= today) E.push(`Buyer delivery date (${fmtDay(p.buyer_date)}) must be in the future.`);
  if (!p.factory_date) E.push("Set the factory delivery date.");
  else if (p.buyer_date && p.factory_date > p.buyer_date) E.push(`Factory delivery date (${fmtDay(p.factory_date)}) is after the buyer's deadline (${fmtDay(p.buyer_date)}).`);
  if (!p.merch_date) E.push("Set the merchandiser predicted date.");
  else if (p.factory_date && p.merch_date > p.factory_date) W.push(`Merchandiser predicted date (${fmtDay(p.merch_date)}) is later than the factory's commitment (${fmtDay(p.factory_date)}).`);
  if (!p.delivery_address.trim()) W.push("No delivery address. You'll need it for the delivery challan.");
  if (!p.styles.length) E.push("Add at least one style.");
  p.styles.forEach((st, i) => {
    const n = `Style ${i + 1}${st.name ? ` "${st.name}"` : ""}`;
    ([["name", "style name"], ["code", "style code"], ["fabric", "fabric type"], ["colour", "colour"]] as const).forEach(([k, l]) => {
      if (!st[k].trim()) E.push(`${n}: enter the ${l}.`);
    });
    if (draftQty(st, p.order_type) <= 0) E.push(`${n}: quantity must be more than 0.`);
    if (num(st.buyer_rate) <= 0) E.push(`${n}: rate must be more than 0.`);
    if (st.factory_rate && num(st.factory_rate) >= num(st.buyer_rate) && num(st.buyer_rate) > 0) {
      W.push(`${n}: factory rate is not below the buyer rate, so there's no margin.`);
    }
    if (!st.checkpoints.length) E.push(`${n}: add at least one TNA checkpoint.`);
    let prev: DraftCheckpoint | null = null;
    st.checkpoints.forEach((cp, j) => {
      if (!cp.name.trim()) E.push(`${n}: checkpoint ${j + 1} needs a name.`);
      if (!cp.due_date) E.push(`${n}: set a date for ${cp.name || "checkpoint " + (j + 1)}.`);
      else if (prev && cp.due_date < prev.due_date) E.push(`${n}: ${cp.name} (${fmtDay(cp.due_date)}) is before ${prev.name} (${fmtDay(prev.due_date)}).`);
      if (cp.due_date) prev = cp;
    });
    const last = st.checkpoints[st.checkpoints.length - 1];
    if (last?.due_date && p.factory_date && last.due_date > p.factory_date) W.push(`${n}: last checkpoint (${fmtDay(last.due_date)}) is after the factory delivery date.`);
  });
  return { E, W };
}

// <input type="datetime-local"> values, always in India time.
export function toLocalInput(iso: string | number) {
  const d = new Date(iso);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(`${v}:00+05:30`).toISOString() : "");
