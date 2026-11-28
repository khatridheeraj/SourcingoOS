import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { isPartner, type Role } from "@/lib/auth-roles";
import { ORDER_TABS } from "@/lib/page-groups";
import { PageTabs } from "@/components/page-tabs";
import { rowOf, StyleRows } from "@/components/style-rows";
import { loadStyleBoard } from "@/lib/style-board";
import { waLink } from "@/lib/whatsapp";
import { qty, todayIST, day } from "@/lib/format";

// Orders > By factory: every open style each factory holds for us, across every buyer and PO, to chase in one go.
export default async function FactoriesBoard({ searchParams }: PageProps<"/orders/factories">) {
  const me = await getMe();
  if (!me?.role || isPartner(me.role as Role)) redirect("/");
  const sp = await searchParams;
  const only = typeof sp.f === "string" && /^[0-9a-f-]{36}$/i.test(sp.f) ? sp.f : "";
  const { styles, factories, error } = await loadStyleBoard();
  const today = todayIST();
  const groups = [...new Set(styles.map((s) => s.factoryId ?? ""))]
    .map((fid) => {
      const rows = styles.filter((s) => (s.factoryId ?? "") === fid);
      const f = factories.find((x) => x.id === fid);
      return { fid, name: f?.name ?? "No factory yet", phone: f?.phone ?? null, rows, late: rows.filter((s) => s.j.next.tone === "bad").length,
        pieces: rows.reduce((n, s) => n + (s.product === "fabric" ? 0 : s.qty), 0), orders: new Set(rows.map((s) => s.orderId)).size };
    })
    .filter((g) => !only || g.fid === only)
    // Factories with late styles first, then the most work; "No factory yet" last.
    .sort((a, b) => Number(!a.fid) - Number(!b.fid) || b.late - a.late || b.rows.length - a.rows.length || a.name.localeCompare(b.name));
  // The status ask a factory gets on WhatsApp: its styles, their order numbers and where each should be. No buyers, no prices.
  const ask = (g: (typeof groups)[number]) => [
    `*${g.name}: status for ${day(today)}*`,
    "Please send today's status and photos for these styles:",
    "",
    ...g.rows.filter((s) => s.j.stage === "make" || s.j.stage === "qc").map((s) => `• ${s.orderNo} · ${s.style}${s.colour ? ` (${s.colour})` : ""}: ${s.j.nextStep ? `${s.j.nextStep.label}${s.j.nextStep.planned ? ` (target ${day(s.j.nextStep.planned)})` : ""}` : s.j.next.title}`),
    "",
    "Sourcingo",
  ].join("\n");

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Orders</h1>
          <p>What each factory is making for us, across every buyer and PO.</p>
        </div>
      </div>
      <PageTabs tabs={ORDER_TABS} label="Orders" />
      {error && <div className="errbox">Couldn&apos;t load every style. Reload to try again. ({error})</div>}
      {only && <p className="mb-3 text-[13px]"><Link href="/orders/factories" className="link">All factories</Link></p>}
      {!groups.length ? <p className="card-empty">No open styles yet.</p> : groups.map((g) => {
        const making = g.rows.some((s) => s.j.stage === "make" || s.j.stage === "qc");
        return (
          <section key={g.fid || "none"} className="sgroup" aria-labelledby={`fb-${g.fid || "none"}`}>
            <div className="sgroup-h">
              <h3 id={`fb-${g.fid || "none"}`}>{g.fid && !only ? <Link href={`/orders/factories?f=${g.fid}`}>{g.name}</Link> : g.name}</h3>
              <small>
                {g.rows.length} {g.rows.length === 1 ? "style" : "styles"} · {g.orders} {g.orders === 1 ? "order" : "orders"}{g.pieces ? ` · ${qty(g.pieces)} pcs` : ""}
                {g.late > 0 && <b className="text-bad"> · {g.late} late</b>}
              </small>
            </div>
            <StyleRows rows={g.rows.map((s) => rowOf(s, false))} />
            {g.fid && making && canEditOrders(me.role) && (
              <a className="link mt-2 inline-block text-[13px] font-semibold" href={waLink(ask(g), g.phone)} target="_blank" rel="noreferrer">
                Ask {g.name} for today&apos;s status on WhatsApp
              </a>
            )}
          </section>
        );
      })}
    </>
  );
}
