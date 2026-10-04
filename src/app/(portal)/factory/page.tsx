import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head, Pills, Progress, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { addDays, fmtDay, nf, TNA_LABEL } from "@/lib/model";
import { loadFactory } from "@/lib/portal";
import { cells, DueChip, unit } from "./bits";
import { CheckpointControl } from "./checkpoint";

export const metadata = { title: "Factory portal · Sourcingo" };

const FILTERS = [
  { key: "running", label: "Running" }, { key: "review", label: "Coming up" }, { key: "shipped", label: "Completed" }, { key: "all", label: "All" },
];

export default async function FactoryHome({ searchParams }: PageProps<"/factory">) {
  const me = await getMe();
  if (me?.role !== "factory") redirect("/");
  const { factory, orders, error } = await loadFactory();
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.show) ? String(sp.show) : "running";
  const today = todayIST();
  const week = addDays(today, 7);

  const running = orders.filter((o) => o.status === "locked");
  const open = running.flatMap((o) => o.styles.flatMap((s) => s.checkpoints.map((c) => ({ o, s, c })))).filter(({ c }) => c.status !== "completed");
  const late = open.filter(({ c }) => c.due_date && c.due_date < today);
  const soon = open.filter(({ c }) => c.due_date && c.due_date >= today && c.due_date <= week);
  const todo = open.filter(({ c }) => (c.due_date && c.due_date <= week) || c.status === "delayed")
    .sort((a, b) => (a.c.due_date ?? "9999").localeCompare(b.c.due_date ?? "9999"));
  const nextDelivery = running.map((o) => o.factory_date).filter(Boolean).sort()[0] ?? null;
  const shown = orders.filter((o) => filter === "all" || (filter === "running" ? o.status === "locked" : filter === "review" ? o.status === "tna_review" : o.status === "shipped"));

  return (
    <>
      <Head title={factory ? `Hello, ${factory.name}` : "Factory portal"} sub="Your Sourcingo orders. Tap a step when it starts, finishes or gets delayed. Sourcingo sees it at once." />
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      {!factory && !error && <p className="warnbox">Your login isn&apos;t linked to a factory yet. Ask Sourcingo to link it.</p>}
      <div className="tiles">
        <Tile tone="blue" label="Running orders" value={running.length} note={`${orders.filter((o) => o.status === "tna_review").length} coming up`} />
        <Tile tone="yellow" label="Steps due this week" value={soon.length} />
        <Tile alarm={late.length > 0} label="Steps overdue" value={late.length} note={late.length ? "Update or mark delayed" : "All on time"} />
        <Tile tone="green" label="Next delivery to Sourcingo" value={<span className="text-[20px]">{fmtDay(nextDelivery)}</span>} />
      </div>

      {todo.length > 0 && (
        <section className="panel">
          <h3>Needs your update</h3>
          <ul className="steplist">
            {todo.slice(0, 12).map(({ o, s, c }) => (
              <li key={c.id}>
                <div className="what">
                  <b>{c.name}</b>
                  <small>
                    <Link className="link" href={`/factory/${o.id}`}>{o.id}</Link> · {s.name || "Style"} ({s.colour || "—"}) · due {fmtDay(c.due_date)}
                  </small>
                  <div className="row mt-1"><DueChip date={c.due_date} today={today} />{c.status !== "pending" && <span className="chip">{TNA_LABEL[c.status]}</span>}</div>
                </div>
                <CheckpointControl id={c.id} name={c.name} status={c.status} note={c.status_note} />
              </li>
            ))}
          </ul>
          {todo.length > 12 && <p className="mt-2 text-xs text-muted">+{todo.length - 12} more inside each order.</p>}
        </section>
      )}

      <section className="stack">
        <div className="row">
          <h2 className="grow text-[17px] font-bold">Orders</h2>
          <Pills current={filter} items={FILTERS.map((f) => ({ ...f, href: `/factory?show=${f.key}` }))} />
        </div>
        {shown.length ? (
          <div className="cards">
            {shown.map((o) => {
              const qty = o.styles.reduce((a, s) => a + Number(s.qty), 0);
              const done = o.styles.flatMap((s) => s.checkpoints).filter((c) => c.status === "completed").length;
              const total = o.styles.flatMap((s) => s.checkpoints).length;
              return (
                <Link key={o.id} href={`/factory/${o.id}`} className="card portal-card">
                  <div className="row">
                    <b className="code grow text-[14px]">{o.id}</b>
                    {o.status === "tna_review" ? <span className="chip info">Coming up</span> : o.status === "shipped" ? <span className="chip ok">Completed</span> : <DueChip date={o.factory_date} today={today} />}
                  </div>
                  <span className="text-[13px] font-semibold">{o.styles.map((s) => s.name || "Style").filter((n, i, a) => a.indexOf(n) === i).join(", ") || "No styles"}</span>
                  <div className="meta">
                    <span>Qty <b className="num">{nf(qty)} {unit(o)}</b></span>
                    <span>Deliver by <b>{fmtDay(o.factory_date)}</b></span>
                    <span>Steps <b>{done}/{total}</b></span>
                  </div>
                  <Progress cells={cells(o, today)} />
                </Link>
              );
            })}
          </div>
        ) : (
          <Empty title={orders.length ? "Nothing here" : "No orders yet"}>
            {orders.length ? "Try another filter." : "Orders from Sourcingo appear here once they're planned with you."}
          </Empty>
        )}
      </section>
    </>
  );
}
