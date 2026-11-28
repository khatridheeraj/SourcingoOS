import Link from "next/link";
import type { Clock, StageKey } from "@/lib/journey";
import { ShipClock, StageMeter } from "./order-ui";
import { qtyU } from "@/lib/format";
import type { BoardStyle } from "@/lib/style-board";

// One style as one line: its photo, name, where it is (stage bars), its own next step, and one small button.
// The order page, Orders > By style and a factory's styles all draw a style this way.
export type StyleRow = {
  key: string;
  href: string;
  style: string;
  photoUrl?: string | null;
  // Buyer · PO · factory, or pieces: whatever the list doesn't already say above it.
  sub?: string;
  stage: StageKey;
  tone: "bad" | "warn" | "info" | "ok";
  next: string;
  // The button's words; empty when the style waits on someone else.
  label: string;
  clock?: Clock;
};

export function StyleRows({ rows }: { rows: StyleRow[] }) {
  return (
    <ul className="srows">
      {rows.map((r) => (
        <li key={r.key}>
          <Link href={r.href} className={`srow tone-${r.tone}`}>
            <span className="srow-ph" aria-hidden>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.photoUrl ? <img src={r.photoUrl} alt="" loading="lazy" /> : r.style.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase()}
            </span>
            <span className="srow-main">
              <b>{r.style}</b>
              {r.sub && <small>{r.sub}</small>}
              <span className="srow-next"><StageMeter stage={r.stage} tone={r.tone} label={false} /><span>{r.next}</span></span>
            </span>
            <span className="srow-end">
              {r.clock && <ShipClock c={r.clock} size="sm" />}
              <span className="btn sm">{r.label || "Open"}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

// How many styles are late, waiting on a factory, need attention, and have passed final QC: the top of a list.
export function StyleCounts({ c }: { c: { late: number; noFactory: number; attention: number; passed: number; total: number } }) {
  const cells = [
    { n: c.late, label: "Late", tone: "bad" },
    { n: c.noFactory, label: "No factory", tone: "warn" },
    { n: c.attention, label: "To update", tone: "warn" },
    { n: c.passed, label: "Passed QC", tone: "ok" },
  ];
  return (
    <dl className="scounts" aria-label={`${c.total} styles`}>
      {cells.map((x) => (
        <div key={x.label} className={x.n ? `tone-${x.tone}` : ""}>
          <dt>{x.label}</dt>
          <dd className="num">{x.n}</dd>
        </div>
      ))}
    </dl>
  );
}

// A style from Orders > By style or By factory as a row; withFactory false on a factory's own list, which names it above.
export const rowOf = (s: BoardStyle, withFactory = true): StyleRow => ({
  key: s.id, href: `/orders/${s.orderId}#style-${s.id}`, style: s.style + (s.colour ? ` · ${s.colour}` : ""), photoUrl: s.photoUrl,
  sub: [s.buyer, `PO ${s.buyerPo}`, withFactory ? s.factory || "No factory" : qtyU(s.qty, s.product)].join(" · "),
  stage: s.j.stage, tone: s.j.next.tone, next: s.j.next.title, label: s.j.next.action.kind === "none" ? "" : "Open", clock: s.clock,
});
