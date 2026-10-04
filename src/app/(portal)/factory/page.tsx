import Link from "next/link";
import { redirect } from "next/navigation";
import { Attachments } from "@/components/attachments";
import { Empty, Head, Pills, Progress, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { loadFiles } from "@/lib/files";
import { addDays, fmtDay, nf, sampleTitle, sampleTypeLabel, TNA_LABEL } from "@/lib/model";
import { loadFactory } from "@/lib/portal";
import { cells, DueChip, unit } from "./bits";
import { CheckpointControl } from "./checkpoint";
import { SampleReady } from "./samples";

export const metadata = { title: "Factory portal · Sourcingo" };

const FILTERS = [
  { key: "running", label: "Running" }, { key: "review", label: "Coming up" }, { key: "shipped", label: "Completed" }, { key: "all", label: "All" },
];

export default async function FactoryHome({ searchParams }: PageProps<"/factory">) {
  const me = await getMe();
  if (me?.role !== "factory") redirect("/");
  const { factory, orders, samples, error } = await loadFactory();
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
  const making = samples.filter((s) => s.status === "with_vendor");
  const sampleFiles = await loadFiles("sample", making.map((s) => s.id));
  const pastSamples = samples.filter((s) => s.status !== "with_vendor");
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
        {samples.length > 0 && <Tile alarm={making.some((s) => s.vendor_due && s.vendor_due < today)} tone="pink" label="Samples to make" value={making.length} note={making.length ? `Next due ${fmtDay(making.map((s) => s.vendor_due).filter(Boolean).sort()[0] ?? null)}` : "None right now"} />}
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

      {making.length > 0 && (
        <section className="stack">
          <h2 className="text-[17px] font-bold">Samples to make</h2>
          <p className="text-sm text-muted">Buyer samples are urgent. Send each one back to Sourcingo by its date, then tap Sample is ready.</p>
          {making.map((s) => (
            <article key={s.id} className="card stack">
              <div className="row">
                <b className="grow text-[15px]">{sampleTitle(s)}</b>
                {s.vendor_due ? <DueChip date={s.vendor_due} today={today} /> : <span className="chip">No date given</span>}
              </div>
              <div className="meta">
                <span><b className="code">{s.id}</b></span>
                <span>Buyer <b className="code">{s.buyer_code}</b></span>
                {s.fabric && <span>Fabric <b>{s.fabric}</b></span>}
                <span>Pieces <b>{nf(s.qty)}</b></span>
                {s.buyer_ref && <span>Ref <b>{s.buyer_ref}</b></span>}
                {s.sample_type !== "development" && <span>Type <b>{sampleTypeLabel(s.sample_type)}</b></span>}
                <span>Given <b>{fmtDay(s.issued_on)}</b></span>
                <span>Return by <b>{fmtDay(s.vendor_due)}</b></span>
                {s.round > 1 && <span>Round <b>{s.round}</b></span>}
              </div>
              <Attachments target="sample" id={s.id} files={sampleFiles.get(s.id) ?? []} upload={["sample_photo"]} title="Photos"
                empty="No photos yet. Add a photo of the finished sample before sending it." />
              <SampleReady id={s.id} />
            </article>
          ))}
        </section>
      )}
      {pastSamples.length > 0 && (
        <details className="panel">
          <summary>Samples you&apos;ve made ({pastSamples.length})</summary>
          <div className="list-rows mt-2">
            {pastSamples.map((s) => (
              <div key={s.id}>
                <span className="grow"><b>{sampleTitle(s)}</b> <span className="code text-muted">{s.id} · {s.buyer_code}</span></span>
                <span className="text-xs text-muted">Ready {fmtDay(s.ready_on)}</span>
                <span className={`chip ${s.status === "approved" ? "ok" : s.status === "changes" ? "warn" : s.status === "rejected" ? "bad" : ""}`}>
                  {s.status === "approved" ? "Buyer approved" : s.status === "changes" ? "Changes coming" : s.status === "rejected" ? "Not approved" : "With Sourcingo"}
                </span>
                {s.feedback && <span className="w-full text-xs text-warn">Buyer: {s.feedback}</span>}
              </div>
            ))}
          </div>
        </details>
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
