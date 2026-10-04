"use server";

import { getMe } from "@/lib/auth";
import { loadBooks, loadWorld } from "@/lib/data";
import { fmtDay, money } from "@/lib/model";
import { isFinance, isInternal, isOps } from "@/lib/roles";

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
  for (const g of w.grns) out.push({ k: "GRN", l: g.id, s: `${g.so_id} · ${g.status.replace("_", " ")}`, href: `/grn/${g.id}`, hay: [g.id, g.so_id].join(" ") });
  for (const d of w.dcs) out.push({ k: "DC", l: d.id, s: [d.invoice_no, d.tracking].filter(Boolean).join(" · "), href: `/dc/${d.id}`, hay: [d.id, d.invoice_no, d.tracking, d.so_id, d.grn_id].join(" ") });
  if (isFinance(me?.role)) {
    const { books: b } = await loadBooks();
    for (const i of b.invoices) out.push({ k: "Invoice", l: i.invoice_no, s: `${w.buyerCode(i.buyer_id)} · ${i.net == null ? "amount needed" : money(i.net)}`, href: `/payments/invoices/${i.id}`, hay: [i.invoice_no, name(i.buyer_id), i.so_id, i.dc_id].join(" ") });
    for (const c of b.cheques) out.push({ k: "Cheque", l: `Cheque ${c.cheque_no}`, s: `${w.buyerCode(c.buyer_id)} · ${money(c.amount)} · ${fmtDay(c.cheque_date)}`, href: `/payments/cheques/${c.id}`, hay: [c.cheque_no, c.bank, name(c.buyer_id)].join(" ") });
  }
  return out;
}
