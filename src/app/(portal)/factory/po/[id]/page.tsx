import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FpoLines } from "@/components/fpo-view";
import { getMe } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { stepName, tr } from "@/lib/i18n";
import { fmtDay, money, nf } from "@/lib/model";
import { loadFactory } from "@/lib/portal";
import { PoAnswer } from "../../po-answer";

export async function generateMetadata({ params }: PageProps<"/factory/po/[id]">) {
  return { title: `${(await params).id} · Sourcingo` };
}

const TONE = { issued: "warn", accepted: "ok", declined: "bad", superseded: "", cancelled: "" } as const;
const LABEL = { issued: "Waiting for you", accepted: "Accepted", declined: "Declined", superseded: "Replaced", cancelled: "Withdrawn" } as const;

export default async function FactoryPoPage({ params }: PageProps<"/factory/po/[id]">) {
  const me = await getMe();
  if (me?.role !== "factory") redirect("/");
  const lang = me.language;
  const t = tr(lang);
  const { id } = await params;
  const { pos, orders } = await loadFactory();
  const p = pos.find((x) => x.id === id);
  if (!p) notFound();
  const o = orders.find((x) => x.id === p.so_id);
  const unit = o?.order_type === "fabric" ? "m" : "pcs";
  const same = p.lines.every((l) => JSON.stringify(l.steps) === JSON.stringify(p.lines[0]?.steps));

  return (
    <div className="stack">
      <div className="crumbs"><Link className="link" href="/factory">{t("My orders")}</Link> › {p.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{t("Purchase order")} {p.id}{p.revision > 1 && ` · rev ${p.revision}`} <span className={`chip ${TONE[p.status]}`}>{t(LABEL[p.status])}</span></h1>
          <p>{t("po.sub")}</p>
        </div>
        <a className="btn" href={`/print/fpo/${p.id}`} target="_blank" rel="noreferrer">{t("Print / PDF")}</a>
      </div>
      {p.status === "issued" && <section className="panel"><PoAnswer id={p.id} lang={lang} /></section>}
      {p.responded_at && <p className={p.status === "declined" ? "warnbox" : "okbox"}>{t(LABEL[p.status])} {fmtDateTime(p.responded_at)}{p.response_note && ` · “${p.response_note}”`}</p>}
      <section className="panel">
        <div className="dl">
          <div><span>{t("Deliver to Sourcingo by")}</span><b>{fmtDay(p.delivery_date)}</b></div>
          <div><span>{t("Total quantity")}</span><b className="num">{nf(p.total_qty)} {unit}</b></div>
          <div><span>{t("Total value")}</span><b className="num">{p.total_value != null ? money(p.total_value, p.currency) : "—"}</b></div>
          <div><span>{t("Payment terms")}</span><b>{p.payment_terms || "—"}</b></div>
          <div><span>{t("Buyer")}</span><b className="code">{p.buyer_code}</b></div>
          {o && <div><span>{t("Orders")}</span><b><Link className="link" href={`/factory/${o.id}`}>{o.id}</Link></b></div>}
        </div>
      </section>
      <FpoLines lines={p.lines} currency={p.currency} unit={unit} />
      <section className="panel">
        <h3>{t("Step dates")}</h3>
        <div className="stack" style={{ gap: 8 }}>
          {(same ? p.lines.slice(0, 1) : p.lines).map((l) => (
            <div key={l.style_id}>
              {!same && <div className="sub mb-1">{l.name} ({l.colour})</div>}
              <div className="row" style={{ gap: 6 }}>{l.steps.map((s, i) => <span key={i} className="chip">{stepName(s.name, lang)} · {fmtDay(s.due_date)}</span>)}</div>
            </div>
          ))}
        </div>
      </section>
      {p.terms && <section className="panel"><h3>{t("Terms")}</h3><p className="whitespace-pre-line text-[13px]">{p.terms}</p></section>}
    </div>
  );
}
