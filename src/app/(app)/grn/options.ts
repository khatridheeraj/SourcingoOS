import type { World } from "@/lib/model";
import type { GrnOrderOption } from "./grn-form";

// Locked orders that can still receive goods, with what's already in.
export function grnOrderOptions(w: World, grnId: string | null, keep?: string): GrnOrderOption[] {
  return w.orders
    .filter((o) => o.status === "locked" || o.id === keep)
    .map((o) => ({
      id: o.id,
      label: `${o.id} · #${o.buyer_po_number} · ${w.buyerCode(o.buyer_id)} · ${w.factoryName(o.factory_id)}`,
      factory: w.factoryName(o.factory_id),
      currency: o.currency,
      styles: o.styles.map((s) => ({
        id: s.id, name: s.name, code: s.code, colour: s.colour, ordered: Number(s.qty), received: w.receivedFor(s.id, grnId), rate: Number(s.buyer_rate),
      })),
    }));
}

export const receiverOptions = (w: World) =>
  w.people.filter((p) => p.active && ["owner", "merchandiser", "manager", "qc", "accounts"].includes(p.role ?? "")).map((p) => ({ id: p.id, label: p.full_name || p.email }));
