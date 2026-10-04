import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Attachments } from "@/components/attachments";
import { Progress } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadFiles } from "@/lib/files";
import { fmtDateTime, todayIST } from "@/lib/format";
import { DELAY_HI, stepName, tr } from "@/lib/i18n";
import { delayLabel, fmtDay, money, nf, QC_KIND_LABEL, SIZES } from "@/lib/model";
import { loadFactory } from "@/lib/portal";
import { cells, DueChip, unit } from "../bits";
import { CheckpointControl } from "../checkpoint";

export async function generateMetadata({ params }: PageProps<"/factory/[id]">) {
  return { title: `${(await params).id} · Sourcingo` };
}

const PO_TONE = { issued: "warn", accepted: "ok", declined: "bad", superseded: "", cancelled: "" } as const;
const PO_LABEL = { issued: "Waiting for you", accepted: "Accepted", declined: "Declined", superseded: "Replaced", cancelled: "Withdrawn" } as const;
const QC_TONE = { pass: "ok", fail: "bad", hold: "warn" } as const;
const QC_LABEL = { pass: "Pass", fail: "Fail", hold: "On hold" } as const;

export default async function FactoryOrder({ params }: PageProps<"/factory/[id]">) {
  const me = await getMe();
  if (me?.role !== "factory") redirect("/");
  const lang = me.language;
  const t = tr(lang);
  const { id } = await params;
  const { orders, pos, qcs } = await loadFactory();
  const o = orders.find((x) => x.id === id);
  if (!o) notFound();
  const today = todayIST();
  const live = o.status === "locked";
  const myQc = qcs.filter((q) => q.so_id === o.id);
  const [files, qcFiles] = await Promise.all([loadFiles("style", o.styles.map((s) => s.id)), loadFiles("qc", myQc.map((q) => q.id))]);
  const qty = o.styles.reduce((a, s) => a + Number(s.qty), 0);
  const received = o.styles.reduce((a, s) => a + s.received, 0);
  const rated = o.styles.every((s) => s.factory_rate != null);
  const value = o.styles.reduce((a, s) => a + Number(s.qty) * Number(s.factory_rate ?? 0), 0);
  const po = pos.find((p) => p.so_id === o.id && (p.status === "issued" || p.status === "accepted")) ?? pos.find((p) => p.so_id === o.id);

  return (
    <div className="stack">
      <div className="crumbs"><Link className="link" href="/factory">{t("My orders")}</Link> › {o.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{o.id} {live ? <DueChip date={o.factory_date} today={today} lang={lang} /> : <span className={`chip ${o.status === "shipped" ? "ok" : "info"}`}>{t(o.status === "shipped" ? "Completed" : "Coming up")}</span>}</h1>
          <p>{o.status === "tna_review" ? t("order.review") : o.status === "shipped" ? t("order.done") : `${t("Deliver to Sourcingo by")} ${fmtDay(o.factory_date)}.`}</p>
        </div>
      </div>
      {po && (
        <Link href={`/factory/po/${po.id}`} className={po.status === "issued" ? "warnbox font-semibold" : "card row"}>
          <span className="grow">{t("Purchase order")} <b className="code">{po.id}</b>{po.revision > 1 && ` · rev ${po.revision}`}</span>
          <span className={`chip ${PO_TONE[po.status]}`}>{t(PO_LABEL[po.status])}</span> →
        </Link>
      )}
      <section className="panel">
        <div className="dl">
          <div><span>{t("Order date")}</span><b>{fmtDay(o.so_date)}</b></div>
          <div><span>{t("Deliver to Sourcingo by")}</span><b>{fmtDay(o.factory_date)}</b></div>
          <div><span>{t("Total quantity")}</span><b className="num">{nf(qty)} {unit(o)}</b></div>
          {rated && value > 0 && <div><span>{t("Order value")}</span><b className="num">{money(value, o.currency)}</b></div>}
          <div><span>{t("Received by Sourcingo")}</span><b className="num">{nf(received)} {unit(o)}</b></div>
          <div><span>{t("Buyer")}</span><b className="code">{o.buyer_code}</b></div>
        </div>
        {o.terms && <p className="mt-3 text-[12.5px]"><b>{t("Terms & inspection")}:</b> {o.terms}</p>}
        <div className="mt-3"><Progress cells={cells(o, today)} /></div>
      </section>

      {o.styles.map((s) => (
        <article key={s.id} className="style-card">
          <div className="style-head">
            <h3>{s.name || t("Style")} <span className="font-normal text-muted">({s.colour || "—"})</span></h3>
            <span className="code text-muted">{s.code}</span>
          </div>
          <div className="style-body">
            <div className="meta">
              <span>{t("Fabric")} <b>{s.fabric || "—"}</b></span>
              <span>
                {t("Qty")} <b className="num">{nf(s.qty)} {unit(o)}</b>
                {s.use_sizes && ` (${SIZES.filter((z) => Number(s.sizes?.[z])).map((z) => `${z} ${s.sizes[z]}`).join(", ")})`}
              </span>
              {s.factory_rate != null && <span>{t("Rate")} <b className="num">{money(s.factory_rate, o.currency)}</b></span>}
              {s.received > 0 && <span>{t("Received")} <b className="num">{nf(s.received)} {t("of")} {nf(s.qty)}</b></span>}
            </div>
            <Attachments target="style" id={s.id} files={files.get(s.id) ?? []} upload={live ? ["style_photo"] : []}
              title={t("Tech pack, cutting program & photos")} hint={t("filesHint")} empty={live ? t("filesEmptyLive") : t("filesEmpty")} />
            <div className="stack" style={{ gap: 4 }}>
              <span className="sub">{t("Steps")}</span>
              {s.checkpoints.length ? (
                <ul className="steplist">
                  {s.checkpoints.map((c) => (
                    <li key={c.id}>
                      <div className="what">
                        <b>{stepName(c.name, lang)}</b>
                        <small>{t("Due")} {fmtDay(c.due_date)}{c.status_updated_at && ` · ${t("updated")} ${fmtDateTime(c.status_updated_at)}`}</small>
                        <div className="row mt-1">
                          {live && <DueChip date={c.due_date} today={today} done={c.status === "completed"} lang={lang} />}
                          {!live && <span className="chip">{t({ pending: "Pending", in_progress: "In progress", completed: "Done", delayed: "Delayed" }[c.status])}</span>}
                          {c.status === "delayed" && c.delay_reason && <span className="chip warn">{lang === "hi" ? DELAY_HI[c.delay_reason] : delayLabel(c.delay_reason)}</span>}
                        </div>
                        {c.status_note && <p className={`mt-1 text-[12.5px] ${c.status === "delayed" ? "text-warn" : ""}`}>“{c.status_note}”</p>}
                      </div>
                      {live ? <CheckpointControl id={c.id} name={stepName(c.name, lang)} status={c.status} note={c.status_note} reason={c.delay_reason} lang={lang} /> : <span />}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">{t("No steps planned.")}</p>
              )}
            </div>
          </div>
        </article>
      ))}

      {myQc.length > 0 && (
        <section className="panel">
          <h3>{t("Quality checks")}</h3>
          <div className="stack">
            {myQc.map((q) => {
              const s = o.styles.find((x) => x.id === q.style_id);
              return (
                <div key={q.id} className="card stack" style={{ gap: 6 }}>
                  <div className="row">
                    <b className="grow">{QC_KIND_LABEL[q.kind]} · {s?.name} ({s?.colour})</b>
                    <span className={`chip ${QC_TONE[q.result]}`}>{t(QC_LABEL[q.result])}</span>
                  </div>
                  <span className="text-[12.5px] text-muted">{fmtDay(q.inspected_on)} · {nf(q.sample_size)} / {nf(q.lot_qty)} · {t("critical")} {q.critical} · {t("major")} {q.major} · {t("minor")} {q.minor}</span>
                  {q.defects.length > 0 && <div className="row" style={{ gap: 4 }}>{q.defects.map((d, i) => <span key={i} className="chip">{d.name} × {d.count}</span>)}</div>}
                  {q.notes && <p className="text-[13px]">“{q.notes}”</p>}
                  {(qcFiles.get(q.id) ?? []).length > 0 && <Attachments target="qc" id={q.id} files={qcFiles.get(q.id) ?? []} title={t("Defect photos")} />}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {o.receipts.length > 0 && (
        <section className="panel">
          <h3>{t("Goods received by Sourcingo")}</h3>
          <div className="list-rows">
            {o.receipts.map((r, i) => {
              const s = o.styles.find((x) => x.id === r.style_id);
              return (
                <div key={i}>
                  <span className="code">{r.grn_id}</span>
                  <span className="grow">{s?.name ?? t("Style")} ({s?.colour}) · <b className="num">{nf(r.qty)} {unit(o)}</b>{r.condition !== "good" && <span className="chip warn ml-1.5">{t(r.condition === "damaged" ? "Damaged" : "Short")}</span>}</span>
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
