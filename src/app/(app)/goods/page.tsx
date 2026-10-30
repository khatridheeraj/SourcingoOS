import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { money, nowMs, qty, qtyTotal, todayIST, dayTimeAt } from "@/lib/format";
import { HOLD_HOURS, heldHours, heldText } from "@/lib/goods";
import { dm } from "@/lib/quick";
import { createClient } from "@/lib/supabase/server";

const TABS = [
  { key: "with-us", label: "With us", hint: `Bought from the factory, not shipped yet. Goods should leave within ${HOLD_HOURS} hours.` },
  { key: "on-way", label: "Waiting for GRN", hint: "Shipped to the buyer, waiting for the buyer's goods received note." },
];

type Row = {
  id: string; order_id: string; factory_id: string; purchase_bill_no: string; purchase_taxable: number; purchased_at: string; invoice_due_at: string;
  invoice_no: string | null; invoiced_at: string | null; eway_at: string | null; shipped_at: string | null; cartons: number | null; lr_no: string | null;
  transporter: string | null; grn_due_on: string | null; challan_no: string | null;
};

// Every lot of goods between the factory and the buyer: what is with us and for how long, and what is on its way.
export default async function GoodsPage({ searchParams }: PageProps<"/goods">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  const tab = sp.show === "on-way" ? "on-way" : "with-us";
  const supabase = await createClient();
  const [{ data, error }, buyers, factories] = await Promise.all([
    fetchAll<Row>((a, z) => supabase.from("dispatches")
      .select("id, order_id, factory_id, purchase_bill_no, purchase_taxable, purchased_at, invoice_due_at, invoice_no, invoiced_at, eway_at, shipped_at, cartons, lr_no, transporter, grn_due_on, challan_no")
      .eq("company_id", me.companyId!).is("cancelled_at", null).is("grn_at", null).order("purchased_at").order("id").range(a, z)),
    loadBuyers(),
    loadFactories(),
  ]);
  const all = data ?? [];
  const ids = all.map((d) => d.id);
  const orderIds = [...new Set(all.map((d) => d.order_id))];
  const [{ data: lines }, { data: orders }] = ids.length
    ? await Promise.all([
        supabase.from("dispatch_lines").select("dispatch_id, line_id, qty").in("dispatch_id", ids),
        supabase.from("orders").select("id, order_no, buyer_id, buyer_po, order_lines(id, style, colour, product)").in("id", orderIds),
      ])
    : [{ data: [] }, { data: [] }];
  const orderOf = new Map((orders ?? []).map((o) => [o.id, o]));
  const styleOf = new Map((orders ?? []).flatMap((o) => (o.order_lines ?? []).map((l: { id: string; style: string; colour: string | null; product: string | null }) => [l.id, l])));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryOf = new Map(factories.map((f) => [f.id, f.name]));
  const now = nowMs();
  const today = todayIST();

  const withUs = all.filter((d) => !d.shipped_at).map((d) => ({ ...d, hours: heldHours(d.purchased_at, now) })).sort((a, b) => b.hours - a.hours);
  const onWay = all.filter((d) => d.shipped_at).sort((a, b) => (a.grn_due_on ?? "9").localeCompare(b.grn_due_on ?? "9"));
  // A lot's quantity: pieces for garments, metres for fabric, kept apart when a lot has both.
  const linesOf = (ids: string[]) => (lines ?? []).filter((l) => ids.includes(l.dispatch_id)).map((l) => ({ qty: l.qty, product: styleOf.get(l.line_id)?.product }));
  const qtyOf = (id: string) => qtyTotal(linesOf([id]));
  const withUsLines = linesOf(withUs.map((d) => d.id));
  const metresWithUs = withUsLines.reduce((s, l) => s + (l.product === "fabric" ? l.qty : 0), 0);
  const piecesWithUs = withUsLines.reduce((s, l) => s + (l.product === "fabric" ? 0 : l.qty), 0);
  const allFabric = metresWithUs > 0 && piecesWithUs === 0;
  const lotsText = `${withUs.length} ${withUs.length === 1 ? "lot" : "lots"} not shipped`;
  const over = withUs.filter((d) => d.hours >= HOLD_HOURS);
  const grnLate = onWay.filter((d) => d.grn_due_on && d.grn_due_on < today);
  const t = TABS.find((x) => x.key === tab)!;
  const counts: Record<string, number> = { "with-us": withUs.length, "on-way": onWay.length };

  const kpis = [
    allFabric
      ? { key: "pcs", label: "Metres with us", value: qty(metresWithUs), sev: "", sub: lotsText }
      : { key: "pcs", label: "Pieces with us", value: qty(piecesWithUs), sev: "", sub: metresWithUs ? `Plus ${qty(metresWithUs)} m of fabric` : lotsText },
    { key: "over", label: `Held over ${HOLD_HOURS} hours`, value: String(over.length), sev: over.length ? "bad" : "ok", sub: over.length ? "Ship these today" : "Nothing held too long" },
    { key: "value", label: "Bought, not shipped", value: money(Math.round(withUs.reduce((s, d) => s + Number(d.purchase_taxable), 0))), sev: "", sub: "Factory bills before GST" },
    { key: "grn", label: "Waiting for GRN", value: String(onWay.length), sev: grnLate.length ? "bad" : "", sub: grnLate.length ? `${grnLate.length} past the GRN date` : "None late" },
  ];

  const stepOf = (d: Row) => !d.invoiced_at
    ? { text: Date.parse(d.invoice_due_at) < now ? "Invoice overdue" : `Invoice by ${dayTimeAt(new Date(d.invoice_due_at))}`, cls: Date.parse(d.invoice_due_at) < now ? "bad" : "warn", act: "Make invoice" }
    : !d.eway_at ? { text: "Needs e-way bill", cls: "warn", act: "Add e-way bill" }
      : { text: "Ready to ship", cls: "ok", act: "Add photos and LR" };

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Goods with us</h1>
          <p>Every lot bought from a factory until the buyer&apos;s GRN.</p>
        </div>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <Link key={k.key} href={k.key === "grn" ? "/goods?show=on-way" : "/goods"} className={`kpi ${k.sev}`}>
            <span className="kpi-label"><i aria-hidden />{k.label}</span>
            <b className="num">{k.value}</b>
            <small>{k.sub}</small>
          </Link>
        ))}
      </div>

      <section className="card" aria-labelledby="goods-h">
        <header className="card-h">
          {/* Like Buyer POs: the heading says what the list asks, so it doesn't just repeat the selected tab. */}
          <h2 id="goods-h" className="min-w-0">{tab === "with-us"
            ? (withUs.length ? `${withUs.length} ${withUs.length === 1 ? "lot" : "lots"} to ship` : "Nothing with us")
            : (onWay.length ? `${onWay.length} waiting for GRN` : "Nothing waiting for GRN")}</h2>
          <nav className="seg" aria-label="Show">
            {TABS.map((x) => (
              <Link key={x.key} href={x.key === "with-us" ? "/goods" : `/goods?show=${x.key}`} aria-current={tab === x.key ? "page" : undefined} scroll={false}>
                {x.label} <span>{counts[x.key]}</span>
              </Link>
            ))}
          </nav>
        </header>
        {error && <div className="errbox m-4">{error.message}</div>}

        {(tab === "with-us" ? withUs : onWay).length === 0 ? (
          <p className="card-empty">
            {tab === "with-us" ? "No goods with us. When you record a purchase in an order's Dispatch tab, the lot shows here until it ships."
              : "Nothing waiting for a GRN."}
          </p>
        ) : (
          <ul className="todo">
            {(tab === "with-us" ? withUs : onWay).map((d) => {
              const o = orderOf.get(d.order_id);
              const styles = [...new Set((lines ?? []).filter((l) => l.dispatch_id === d.id).map((l) => styleOf.get(l.line_id)?.style).filter(Boolean))];
              const hours = heldHours(d.purchased_at, now);
              const held = !d.shipped_at;
              const step = stepOf(d);
              const grnLateHere = !!d.grn_due_on && d.grn_due_on < today;
              const sev = held ? (hours >= HOLD_HOURS || step.cls === "bad" ? "bad" : hours >= HOLD_HOURS - 6 ? "warn" : "ok") : grnLateHere ? "bad" : "info";
              return (
                <li key={d.id}>
                  <span className={`sev ${sev}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/orders/${d.order_id}#dispatch`} className="todo-title">
                      <span className="code">{o?.order_no}</span>{o ? buyerOf.get(o.buyer_id) : ""}{o?.buyer_po ? ` · PO ${o.buyer_po}` : ""}
                    </Link>
                    <div className="todo-detail">
                      {[factoryOf.get(d.factory_id), `bill ${d.purchase_bill_no}`, qtyOf(d.id), styles.join(", "),
                        d.cartons ? `${d.cartons} cartons` : "", d.invoice_no ? `invoice ${d.invoice_no}` : ""].filter(Boolean).join(" · ")}
                    </div>
                    {d.shipped_at && (
                      <div className="todo-detail">
                        Shipped {dayTimeAt(new Date(d.shipped_at))}{d.transporter ? ` by ${d.transporter}` : ""}{d.lr_no ? `, LR ${d.lr_no}` : ""}
                        {d.grn_due_on && !grnLateHere ? ` · GRN due ${dm(d.grn_due_on)}` : ""}
                      </div>
                    )}
                    {held && hours < HOLD_HOURS - 6 && <div className="todo-detail">{heldText(hours)}</div>}
                    <div className="todo-links">
                      {held ? (
                        <>
                          {hours >= HOLD_HOURS - 6 && <span className={`chip ${hours >= HOLD_HOURS ? "bad" : "warn"}`}>{heldText(hours)}</span>}
                          {step.cls !== "ok" && <span className={`chip ${step.cls}`}>{step.text}</span>}
                        </>
                      ) : (
                        grnLateHere && <span className="chip bad">GRN was due {dm(d.grn_due_on!)}</span>
                      )}
                      <Link href={`/goods/${d.id}/challan`} prefetch={false} className="link text-[13px]">{d.challan_no ? `Challan ${d.challan_no}` : "Delivery challan"}</Link>
                    </div>
                  </div>
                  <div className="todo-chip" />
                  {/* Like Home's To do: only red rows (held too long, invoice overdue, GRN late) get the primary button. */}
                  <div className="todo-acts">
                    <Link href={`/orders/${d.order_id}#dispatch`} className={`btn sm todo-act ${sev === "bad" ? "primary" : ""}`}>{held ? step.act : "Add GRN"}</Link>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <details className="howto border-t border-line px-4 py-3">
          <summary>How this list works</summary>
          <p>{t.hint}</p>
        </details>
      </section>
    </>
  );
}
