import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { isPartner, type Role } from "@/lib/auth-roles";
import { ORDER_TABS } from "@/lib/page-groups";
import { PageTabs } from "@/components/page-tabs";
import { rowOf, StyleCounts, StyleRows } from "@/components/style-rows";
import { loadStyleBoard, type BoardStyle } from "@/lib/style-board";
import { styleCounts } from "@/lib/style-track";

const SHOW = [
  { key: "needs", label: "Needs us" },
  { key: "late", label: "Late" },
  { key: "factory", label: "No factory" },
  { key: "qc", label: "In final QC" },
  { key: "all", label: "All" },
] as const;
type Show = (typeof SHOW)[number]["key"];

const pick: Record<Show, (s: BoardStyle) => boolean> = {
  needs: (s) => s.j.next.action.kind !== "none",
  late: (s) => s.j.next.tone === "bad",
  factory: (s) => !s.factoryId,
  qc: (s) => s.j.stage === "qc",
  all: () => true,
};

// The groups a list of styles reads in, most urgent first. A style sits in the first group it fits.
const SECTIONS: { key: string; title: string; fits: (s: BoardStyle) => boolean }[] = [
  { key: "late", title: "Late: the ship date is at risk", fits: (s) => s.j.next.tone === "bad" },
  { key: "factory", title: "Needs a factory", fits: (s) => s.j.stage === "factory" },
  { key: "po", title: "Plan and factory PO", fits: (s) => s.j.stage === "plan" || s.j.stage === "approve" },
  { key: "make", title: "Being made", fits: (s) => s.j.stage === "make" },
  { key: "qc", title: "Final QC", fits: (s) => s.j.stage === "qc" },
  { key: "ship", title: "Bills and shipping", fits: (s) => s.j.stage === "ship" },
];


// Orders > By style: every open style on its own line, the most urgent first, whatever order or factory it is on.
export default async function StylesBoard({ searchParams }: PageProps<"/orders/styles">) {
  const me = await getMe();
  if (!me?.role || isPartner(me.role as Role)) redirect("/");
  const sp = await searchParams;
  const show = (SHOW.some((x) => x.key === sp.show) ? sp.show : "needs") as Show;
  const { styles, error } = await loadStyleBoard();
  const shown = styles.filter(pick[show]);
  const orders = new Set(styles.map((s) => s.orderId)).size;
  const sections = SECTIONS.map((sec, i) => ({ ...sec, rows: shown.filter((s) => sec.fits(s) && !SECTIONS.slice(0, i).some((x) => x.fits(s))) })).filter((x) => x.rows.length);
  const rest = shown.filter((s) => !SECTIONS.some((x) => x.fits(s)));

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Orders</h1>
          <p>{styles.length} open {styles.length === 1 ? "style" : "styles"} in {orders} {orders === 1 ? "order" : "orders"}, each with its own next step.</p>
        </div>
      </div>
      <PageTabs tabs={ORDER_TABS} label="Orders" />
      {error && <div className="errbox">Couldn&apos;t load every style. Reload to try again. ({error})</div>}
      {styles.length > 0 && <StyleCounts c={{ ...styleCounts(styles), total: styles.length }} />}
      <nav className="seg mb-4" aria-label="Show">
        {SHOW.map((x) => (
          <Link key={x.key} href={x.key === "needs" ? "/orders/styles" : `/orders/styles?show=${x.key}`} aria-current={show === x.key ? "page" : undefined}>
            {x.label} <span>{styles.filter(pick[x.key]).length}</span>
          </Link>
        ))}
      </nav>
      {!shown.length ? (
        <p className="card-empty">{styles.length ? "Nothing here right now." : "No open orders yet. A new order's styles show here, each on its own line."}</p>
      ) : (
        <>
          {sections.map((sec) => (
            <section key={sec.key} className="sgroup" aria-labelledby={`sb-${sec.key}`}>
              <div className="sgroup-h"><h3 id={`sb-${sec.key}`}>{sec.title}</h3><small>{sec.rows.length} {sec.rows.length === 1 ? "style" : "styles"}</small></div>
              <StyleRows rows={sec.rows.map((s) => rowOf(s))} />
            </section>
          ))}
          {rest.length > 0 && (
            <section className="sgroup" aria-label="Done">
              <div className="sgroup-h"><h3>Sent</h3><small>{rest.length}</small></div>
              <StyleRows rows={rest.map((s) => rowOf(s))} />
            </section>
          )}
        </>
      )}
      <details className="howto mt-6">
        <summary>How styles are tracked</summary>
        <p>
          Each style has its own stage and next step, worked out from that style alone: its factory, its plan, its photos and
          QC, its bills. A style still waiting for a factory no longer holds back the ones already being made. A style can ship on
          its own date: open the style on its order and set it under fabric and sizes. Red means the style will miss its ship date;
          amber means a step needs an update.
        </p>
      </details>
    </>
  );
}
