import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Attachments } from "@/components/attachments";
import { Progress } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadFiles } from "@/lib/files";
import { fmtDateTime, todayIST } from "@/lib/format";
import { fmtDay, money, nf, SIZES, TNA_LABEL } from "@/lib/model";
import { loadFactory } from "@/lib/portal";
import { cells, DueChip, unit } from "../bits";
import { CheckpointControl } from "../checkpoint";

export async function generateMetadata({ params }: PageProps<"/factory/[id]">) {
  return { title: `${(await params).id} · Sourcingo` };
}

export default async function FactoryOrder({ params }: PageProps<"/factory/[id]">) {
  const me = await getMe();
  if (me?.role !== "factory") redirect("/");
  const { id } = await params;
  const { orders } = await loadFactory();
  const o = orders.find((x) => x.id === id);
  if (!o) notFound();
  const today = todayIST();
  const live = o.status === "locked";
  const files = await loadFiles("style", o.styles.map((s) => s.id));
  const qty = o.styles.reduce((a, s) => a + Number(s.qty), 0);
  const received = o.styles.reduce((a, s) => a + s.received, 0);
  const rated = o.styles.every((s) => s.factory_rate != null);
  const value = o.styles.reduce((a, s) => a + Number(s.qty) * Number(s.factory_rate ?? 0), 0);

  return (
    <div className="stack">
      <div className="crumbs"><Link className="link" href="/factory">My orders</Link> › {o.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{o.id} {live ? <DueChip date={o.factory_date} today={today} /> : <span className={`chip ${o.status === "shipped" ? "ok" : "info"}`}>{o.status === "shipped" ? "Completed" : "Coming up"}</span>}</h1>
          <p>
            {o.status === "tna_review"
              ? "Sourcingo is finalising this plan. Check the styles and dates; you can update steps once it's confirmed."
              : o.status === "shipped" ? "This order is complete. Thank you." : `Deliver to Sourcingo by ${fmtDay(o.factory_date)}.`}
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="dl">
          <div><span>Order date</span><b>{fmtDay(o.so_date)}</b></div>
          <div><span>Deliver to Sourcingo by</span><b>{fmtDay(o.factory_date)}</b></div>
          <div><span>Total quantity</span><b className="num">{nf(qty)} {unit(o)}</b></div>
          {rated && value > 0 && <div><span>Order value</span><b className="num">{money(value, o.currency)}</b></div>}
          <div><span>Received by Sourcingo</span><b className="num">{nf(received)} {unit(o)}</b></div>
          <div><span>Buyer</span><b className="code">{o.buyer_code}</b></div>
        </div>
        {o.terms && <p className="mt-3 text-[12.5px]"><b>Terms &amp; inspection:</b> {o.terms}</p>}
        <div className="mt-3"><Progress cells={cells(o, today)} /></div>
      </section>

      {o.styles.map((s) => (
        <article key={s.id} className="style-card">
          <div className="style-head">
            <h3>{s.name || "Style"} <span className="font-normal text-muted">({s.colour || "—"})</span></h3>
            <span className="code text-muted">{s.code}</span>
          </div>
          <div className="style-body">
            <div className="meta">
              <span>Fabric <b>{s.fabric || "—"}</b></span>
              <span>
                Qty <b className="num">{nf(s.qty)} {unit(o)}</b>
                {s.use_sizes && ` (${SIZES.filter((z) => Number(s.sizes?.[z])).map((z) => `${z} ${s.sizes[z]}`).join(", ")})`}
              </span>
              {s.factory_rate != null && <span>Rate <b className="num">{money(s.factory_rate, o.currency)}</b></span>}
              {s.received > 0 && <span>Received <b className="num">{nf(s.received)} of {nf(s.qty)}</b></span>}
            </div>
            <Attachments target="style" id={s.id} files={files.get(s.id) ?? []} upload={live ? ["style_photo"] : []}
              title="Tech pack, cutting program & photos" hint="Add production photos so Sourcingo can see progress. Photos are made smaller before upload."
              empty={live ? "No files yet. Add production photos with the button." : "No files from Sourcingo yet."} />
            <div className="stack" style={{ gap: 4 }}>
              <span className="sub">Steps</span>
              {s.checkpoints.length ? (
                <ul className="steplist">
                  {s.checkpoints.map((c) => (
                    <li key={c.id}>
                      <div className="what">
                        <b>{c.name}</b>
                        <small>Due {fmtDay(c.due_date)}{c.status_updated_at && ` · updated ${fmtDateTime(c.status_updated_at)}`}</small>
                        <div className="row mt-1">
                          {live && <DueChip date={c.due_date} today={today} done={c.status === "completed"} />}
                          {!live && <span className="chip">{TNA_LABEL[c.status]}</span>}
                        </div>
                        {c.status_note && <p className={`mt-1 text-[12.5px] ${c.status === "delayed" ? "text-warn" : ""}`}>“{c.status_note}”</p>}
                      </div>
                      {live ? <CheckpointControl id={c.id} name={c.name} status={c.status} note={c.status_note} /> : <span />}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">No steps planned.</p>
              )}
            </div>
          </div>
        </article>
      ))}

      {o.receipts.length > 0 && (
        <section className="panel">
          <h3>Goods received by Sourcingo</h3>
          <div className="list-rows">
            {o.receipts.map((r, i) => {
              const s = o.styles.find((x) => x.id === r.style_id);
              return (
                <div key={i}>
                  <span className="code">{r.grn_id}</span>
                  <span className="grow">{s?.name ?? "Style"} ({s?.colour}) · <b className="num">{nf(r.qty)} {unit(o)}</b>{r.condition !== "good" && <span className="chip warn ml-1.5">{r.condition === "damaged" ? "Damaged" : "Short"}</span>}</span>
                  <span className="text-xs text-muted">{fmtDateTime(r.received_at)}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
