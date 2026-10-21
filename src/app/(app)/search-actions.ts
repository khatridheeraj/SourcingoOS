"use server";

import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { day, dueDate, todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export type Hit = { kind: "order" | "style" | "buyer" | "factory" | "inquiry" | "po"; href: string; title: string; sub: string; code?: string; state?: string; tone?: "bad" | "ok" | "" };

// Everything a search box can find, by any word the team uses for it: order number, buyer PO, style, colour, buyer,
// factory, inquiry, or an incoming PO. Each word typed must match; the closest matches come first.
export async function searchAll(raw: string): Promise<{ hits: Hit[]; error?: string }> {
  const me = await getMe();
  if (!me?.companyId) return { hits: [] };
  const words = raw.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return { hits: [] };
  const team = canEditOrders(me.role);
  const supabase = await createClient();
  const [{ data: orders, error }, buyers, factories, { data: inqs }, { data: pos }] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, status, order_lines(id, style, colour, qty, factory_id)")
      .eq("company_id", me.companyId!).is("order_lines.removed_at", null).order("created_at", { ascending: false }).order("id").range(a, z)),
    loadBuyers(),
    loadFactories(),
    team
      ? supabase.from("inquiries").select("id, inquiry_no, buyer_id, prospect, product, status").eq("company_id", me.companyId).order("created_at", { ascending: false }).limit(500)
      : Promise.resolve({ data: [] }),
    team
      ? supabase.from("incoming_pos").select("id, buyer_id, buyer_po, email_subject, status, received_at").eq("company_id", me.companyId)
        .in("status", ["to_check", "failed", "held"]).order("received_at", { ascending: false }).limit(200)
      : Promise.resolve({ data: [] }),
  ]);
  if (error) return { hits: [], error: "Search couldn't load. Try again." };
  const today = todayIST();
  const bName = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const fName = new Map(factories.map((f) => [f.id, f.name]));
  const has = (text: string) => { const t = text.toLowerCase(); return words.every((w) => t.includes(w)); };
  // Exact codes first (SO-0012, a PO number), then a word at the start, then anywhere.
  const score = (fields: string[]) => {
    const t = fields.join(" ").toLowerCase();
    const q = words.join(" ");
    return fields.some((f) => f.toLowerCase() === q) ? 0 : fields.some((f) => f.toLowerCase().startsWith(q)) ? 1 : t.includes(q) ? 2 : 3;
  };
  const state = (o: { status: string; ship_date: string | null; revised_ship_date: string | null }): { text: string; tone: Hit["tone"] } => {
    const d = dueDate(o);
    if (o.status !== "open") return { text: o.status === "shipped" ? "Shipped" : o.status === "cancelled" ? "Cancelled" : o.status, tone: o.status === "shipped" ? "ok" : "" };
    return d ? { text: `${d < today ? "Was due" : "Ships"} ${day(d)}`, tone: d < today ? "bad" : "" } : { text: "No ship date", tone: "" };
  };

  const orderHits: (Hit & { s: number })[] = [];
  const styleHits: (Hit & { s: number })[] = [];
  for (const o of orders ?? []) {
    const lines = o.order_lines ?? [];
    const buyer = bName.get(o.buyer_id) ?? "";
    const facs = [...new Set(lines.map((l) => (l.factory_id ? fName.get(l.factory_id) ?? "" : "")).filter(Boolean))];
    const st = state(o);
    const href = `/orders/${o.id}`;
    const head = [o.order_no, o.buyer_po ?? "", buyer, ...facs];
    if (has(head.join(" "))) {
      orderHits.push({ kind: "order", href, code: o.order_no, title: `${buyer}${o.buyer_po ? ` · PO ${o.buyer_po}` : ""}`,
        sub: `${lines.length} ${lines.length === 1 ? "style" : "styles"}${facs.length ? ` · ${facs.join(", ")}` : ""}`, state: st.text, tone: st.tone, s: score(head) + (o.status === "open" ? 0 : 0.5) });
      continue;
    }
    for (const l of lines) {
      const fields = [l.style, l.colour ?? "", o.order_no, buyer, l.factory_id ? fName.get(l.factory_id) ?? "" : ""];
      if (!has(fields.join(" "))) continue;
      styleHits.push({ kind: "style", href: `${href}#tna`, code: o.order_no, title: `${l.style}${l.colour ? ` · ${l.colour}` : ""}`,
        sub: `${buyer} · ${l.qty.toLocaleString("en-IN")} pcs${l.factory_id ? ` · ${fName.get(l.factory_id) ?? ""}` : ""}`, state: st.text, tone: st.tone,
        s: score([l.style, l.colour ?? ""]) + (o.status === "open" ? 0 : 0.5) });
    }
  }
  const openOf = (pick: (o: NonNullable<typeof orders>[number]) => boolean) => (orders ?? []).filter((o) => o.status === "open" && pick(o)).length;
  const buyerHits: (Hit & { s: number })[] = buyers.filter((b) => has(`${buyerName(b)} ${b.code} ${b.city ?? ""}`)).map((b) => {
    const n = openOf((o) => o.buyer_id === b.id);
    return { kind: "buyer", href: `/?status=all&q=${encodeURIComponent(buyerName(b))}`, title: buyerName(b),
      sub: `Buyer${b.city ? ` · ${b.city}` : ""} · ${n} open ${n === 1 ? "order" : "orders"}`, s: score([buyerName(b), b.code]) };
  });
  const factoryHits: (Hit & { s: number })[] = team ? factories.filter((f) => has(`${f.name} ${f.city ?? ""} ${f.contact_name ?? ""}`)).map((f) => {
    const n = openOf((o) => (o.order_lines ?? []).some((l) => l.factory_id === f.id));
    return { kind: "factory", href: `/?q=${encodeURIComponent(f.name)}`, title: f.name,
      sub: `Factory${f.city ? ` · ${f.city}` : ""}${f.contact_name ? ` · ${f.contact_name}` : ""} · ${n} open ${n === 1 ? "order" : "orders"}`, s: score([f.name]) };
  }) : [];
  const inqHits: (Hit & { s: number })[] = (inqs ?? []).filter((i) => has(`${i.inquiry_no} ${i.product} ${i.prospect ?? ""} ${i.buyer_id ? bName.get(i.buyer_id) ?? "" : ""}`)).map((i) => ({
    kind: "inquiry", href: `/inquiries/${i.id}`, code: i.inquiry_no, title: `${(i.buyer_id && bName.get(i.buyer_id)) || i.prospect || ""} · ${i.product}`,
    sub: `Inquiry · ${i.status}`, s: score([i.inquiry_no, i.product]) + 0.2,
  }));
  const poHits: (Hit & { s: number })[] = (pos ?? []).filter((p) => has(`${p.buyer_po ?? ""} ${p.email_subject ?? ""} ${p.buyer_id ? bName.get(p.buyer_id) ?? "" : ""}`)).map((p) => ({
    kind: "po", href: `/pos/${p.id}`, title: `${p.buyer_id ? `${bName.get(p.buyer_id) ?? ""} · ` : ""}PO ${p.buyer_po ?? p.email_subject ?? ""}`,
    sub: `Incoming PO · ${p.status === "held" ? "unknown sender" : "to check"} · ${day(p.received_at.slice(0, 10))}`, tone: "", s: score([p.buyer_po ?? ""]) + 0.2,
  }));
  const top = (xs: (Hit & { s: number })[], n: number) => xs.sort((a, b) => a.s - b.s).slice(0, n).map(({ s, ...h }) => (void s, h));
  return { hits: [...top(orderHits, 8), ...top(styleHits, 8), ...top(buyerHits, 4), ...top(factoryHits, 4), ...top(inqHits, 4), ...top(poHits, 4)] };
}
