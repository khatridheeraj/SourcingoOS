// The day's messages, built from open orders: one WhatsApp chase per factory that is behind, and one status update per
// buyer. Pure: the pages read the rows, this writes the words.
import { dueDate, TNA_STEPS } from "@/lib/format";
import { addDays, buyerUpdateText, chaseAllText, waLink, type QStyle } from "@/lib/quick";

type Line = { id: string; style: string; colour: string | null; qty: number; factory_id: string | null };
type Order = { id: string; order_no: string; buyer_id: string; buyer_po: string | null; ship_date: string | null; revised_ship_date: string | null; order_lines: Line[] | null };
type Stage = { line_id: string; stage: string; label: string | null; planned_on: string | null; done_on: string | null; not_needed: boolean };
type Po = { order_id: string; factory_id: string; released_at: string | null; buffer_days: number | null };

export type FactoryChase = { factoryId: string; name: string; late: number; orders: { id: string; orderNo: string }[]; href: string; text: string; chased: boolean; hasPhone: boolean };
export type BuyerUpdate = { buyerId: string; name: string; orders: number; styles: number; behind: number; text: string };

// A style's steps in plan order, as the quick sheet reads them.
export function toQStyle(l: Line, stages: Stage[]): QStyle {
  const mine = stages.filter((s) => s.line_id === l.id);
  return {
    id: l.id, style: l.style, colour: l.colour ?? "", qty: l.qty, hasRate: true, factoryId: l.factory_id,
    steps: [
      ...TNA_STEPS.map((t) => { const r = mine.find((s) => s.stage === t.key); return { key: t.key, label: t.label, planned_on: r?.planned_on ?? "", done_on: r?.done_on ?? "", not_needed: !!r?.not_needed, extra: false }; }),
      ...mine.filter((s) => s.stage.startsWith("extra_")).map((s) => ({ key: s.stage, label: s.label ?? "", planned_on: s.planned_on ?? "", done_on: s.done_on ?? "", not_needed: s.not_needed, extra: true })),
    ],
  };
}

const lateIn = (s: QStyle, today: string) => s.steps.filter((x) => !x.not_needed && !x.done_on && x.planned_on && x.planned_on < today).length;

export function buildUpdates({ orders, stages, pos, factories, buyerName, chased, today }: {
  orders: Order[]; stages: Stage[]; pos: Po[]; factories: { id: string; name: string; phone: string | null }[];
  buyerName: (id: string) => string; chased: Set<string>; today: string;
}): { chases: FactoryChase[]; buyers: BuyerUpdate[] } {
  const byLine = new Map<string, Stage[]>();
  for (const s of stages) byLine.set(s.line_id, [...(byLine.get(s.line_id) ?? []), s]);
  const style = (l: Line) => toQStyle(l, byLine.get(l.id) ?? []);
  const po = (o: string, f: string) => pos.find((p) => p.order_id === o && p.factory_id === f);

  // Factories: only production that has started (a released PO) can be behind.
  const chases: FactoryChase[] = [];
  for (const f of factories) {
    const mine = orders.flatMap((o) => {
      const p = po(o.id, f.id);
      if (!p?.released_at) return [];
      const styles = (o.order_lines ?? []).filter((l) => l.factory_id === f.id).map(style);
      const late = styles.reduce((n, s) => n + lateIn(s, today), 0);
      if (!late) return [];
      const due = dueDate(o);
      return [{ o, styles, late, target: due && p.buffer_days != null ? addDays(due, -p.buffer_days) : "" }];
    }).sort((a, b) => b.late - a.late);
    if (!mine.length) continue;
    const text = chaseAllText(f.name, mine.map((m) => ({ orderNo: m.o.order_no, buyerPo: m.o.buyer_po ?? "", target: m.target, styles: m.styles })), today);
    chases.push({
      factoryId: f.id, name: f.name, late: mine.reduce((n, m) => n + m.late, 0), orders: mine.map((m) => ({ id: m.o.id, orderNo: m.o.order_no })),
      href: waLink(f.phone, text), text, chased: chased.has(f.id), hasPhone: !!f.phone,
    });
  }
  chases.sort((a, b) => Number(a.chased) - Number(b.chased) || b.late - a.late || a.name.localeCompare(b.name));

  // Buyers: every open order, soonest ship date first.
  const byBuyer = new Map<string, Order[]>();
  for (const o of orders) byBuyer.set(o.buyer_id, [...(byBuyer.get(o.buyer_id) ?? []), o]);
  const buyers: BuyerUpdate[] = [...byBuyer.entries()].map(([id, os]) => {
    const rows = [...os].sort((a, b) => (dueDate(a) ?? "9999").localeCompare(dueDate(b) ?? "9999")).map((o) => {
      const lines = o.order_lines ?? [];
      const styles = lines.map(style);
      const started = lines.some((l) => l.factory_id && po(o.id, l.factory_id)?.released_at);
      return { orderNo: o.order_no, buyerPo: o.buyer_po ?? "", due: dueDate(o) ?? "", started, late: started && styles.some((s) => lateIn(s, today) > 0), styles };
    });
    const name = buyerName(id);
    return { buyerId: id, name, orders: rows.length, styles: rows.reduce((n, r) => n + r.styles.length, 0),
      behind: rows.filter((r) => r.late || (r.due && r.due < today)).length, text: buyerUpdateText(name, rows, today) };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { chases, buyers };
}
