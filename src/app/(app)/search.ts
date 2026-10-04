"use server";

import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { isInternal, isOps } from "@/lib/roles";

export type SearchItem = { k: string; l: string; s: string; href: string; hay: string };

// Everything the top search box can jump to, loaded when it's first focused.
export async function searchIndex(): Promise<SearchItem[]> {
  const me = await getMe();
  if (!isInternal(me?.role)) return [];
  const { world: w } = await loadWorld();
  const out: SearchItem[] = [];
  const name = (id: string) => {
    const b = w.buyerById.get(id);
    return b?.real_name && w.isOwner ? `${b.code} ${b.real_name}` : b?.code ?? "";
  };
  for (const o of w.orders) {
    out.push({ k: "Order", l: `${o.id} · #${o.buyer_po_number}`, s: `${w.buyerCode(o.buyer_id)} · ${w.factoryName(o.factory_id)}`, href: `/orders/${o.id}`, hay: [o.id, o.buyer_po_number, name(o.buyer_id), o.tags.join(" "), w.factoryName(o.factory_id)].join(" ") });
    for (const st of o.styles) {
      out.push({ k: "Style", l: `${st.name || "Unnamed"} (${st.colour || "—"})`, s: `${st.code} · ${o.id}`, href: `/orders/${o.id}`, hay: [st.name, st.code, st.colour, st.fabric].join(" ") });
    }
  }
  if (isOps(me?.role)) {
    for (const i of w.inquiries) {
      out.push({ k: "Inquiry", l: `${i.id} · ${i.product_type}`, s: w.buyerCode(i.buyer_id), href: `/inquiries?status=all&q=${encodeURIComponent(i.id)}`, hay: [i.id, i.product_type, name(i.buyer_id)].join(" ") });
    }
  }
  for (const s of w.samples) {
    out.push({ k: "Sample", l: `${s.id} · ${s.description || s.fabric || "Sample"}`, s: `${w.buyerCode(s.buyer_id)}${s.factory_id ? ` · ${w.factoryName(s.factory_id)}` : ""}`, href: `/samples/${s.id}`, hay: [s.id, s.description, s.fabric, s.buyer_ref, name(s.buyer_id), w.factoryName(s.factory_id), s.tracking].join(" ") });
  }
  for (const g of w.grns) out.push({ k: "GRN", l: g.id, s: `${g.so_id} · ${g.status.replace("_", " ")}`, href: `/grn/${g.id}`, hay: [g.id, g.so_id].join(" ") });
  for (const d of w.dcs) out.push({ k: "DC", l: d.id, s: [d.invoice_no, d.tracking].filter(Boolean).join(" · "), href: `/dc/${d.id}`, hay: [d.id, d.invoice_no, d.tracking, d.so_id, d.grn_id].join(" ") });
  return out;
}
