import { nf, type World } from "@/lib/model";
import type { DcGrnOption } from "./dc-form";

// Submitted GRNs with goods not yet on a challan (this challan's own lines count as free).
export function dcGrnOptions(w: World, dcId: string | null, keep?: string): DcGrnOption[] {
  return w.grns
    .filter((g) => g.id === keep || w.grnAvail(g, dcId) > 0)
    .map((g) => {
      const o = w.orderById.get(g.so_id);
      const b = w.buyerById.get(o?.buyer_id ?? "");
      return {
        id: g.id,
        label: `${g.id} · ${g.so_id} · ${b?.code ?? ""} · ${nf(w.grnAvail(g, dcId))} units`,
        receivedAt: g.received_at,
        address: o?.delivery_address || b?.default_address || "",
        currency: o?.currency ?? "INR",
        lines: g.lines
          .map((l) => {
            const s = w.styleById.get(l.style_id);
            return {
              style_id: l.style_id, name: s?.name ?? "Style", code: s?.code ?? "", colour: s?.colour ?? "",
              avail: Math.max(0, Number(l.qty) - w.dcQtyFor(g.id, l.style_id, dcId, false)), rate: w.rate(l.style_id),
            };
          })
          .filter((l) => l.avail > 0),
      };
    });
}
