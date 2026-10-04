import Link from "next/link";
import { redirect } from "next/navigation";
import { Attachments } from "@/components/attachments";
import { Empty, Head, Pills, Progress, Tile } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { loadFiles } from "@/lib/files";
import { stepName, tr } from "@/lib/i18n";
import { addDays, fmtDay, money, nf, sampleTitle, sampleTypeLabel } from "@/lib/model";
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
  const lang = me.language;
  const t = tr(lang);
  const { factory, orders, samples, pos, error } = await loadFactory();
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
  const toAccept = pos.filter((p) => p.status === "issued");

  return (
    <>
      <Head title={factory ? `${t("Hello")}, ${factory.name}` : t("Factory portal")} sub={t("portal.sub")} />
      {error && <p className="errbox">{t("Couldn't load everything")}: {error.message}</p>}
      {!factory && !error && <p className="warnbox">{t("notLinked")}</p>}

      {toAccept.length > 0 && (
        <section className="panel" style={{ borderColor: "var(--warn)" }}>
          <h3>{t("Purchase orders to accept")} ({toAccept.length})</h3>
          <div className="list-rows">
            {toAccept.map((p) => (
              <div key={p.id}>
                <span className="grow"><b className="code">{p.id}</b>{p.revision > 1 && <span className="text-muted"> rev {p.revision}</span>}
                  <span className="block text-[12.5px] text-muted">{nf(p.total_qty)} pcs · {p.total_value != null ? money(p.total_value, p.currency) : ""} · {t("Deliver by")} {fmtDay(p.delivery_date)}</span>
                </span>
                <Link className="btn primary" href={`/factory/po/${p.id}`}>{t("Open")}</Link>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="tiles">
        <Tile tone="blue" label={t("Running orders")} value={running.length} note={`${orders.filter((o) => o.status === "tna_review").length} ${t("coming up")}`} />
        <Tile tone="yellow" label={t("Steps due this week")} value={soon.length} />
        <Tile alarm={late.length > 0} label={t("Steps overdue")} value={late.length} note={late.length ? t("Update or mark delayed") : t("All on time")} />
        {samples.length > 0 && <Tile alarm={making.some((s) => s.vendor_due && s.vendor_due < today)} tone="pink" label={t("Samples to make")} value={making.length} note={making.length ? `${t("Next due")} ${fmtDay(making.map((s) => s.vendor_due).filter(Boolean).sort()[0] ?? null)}` : t("None right now")} />}
        <Tile tone="green" label={t("Next delivery to Sourcingo")} value={<span className="text-[20px]">{fmtDay(nextDelivery)}</span>} />
      </div>

      {todo.length > 0 && (
        <section className="panel">
          <h3>{t("Needs your update")}</h3>
          <ul className="steplist">
            {todo.slice(0, 12).map(({ o, s, c }) => (
              <li key={c.id}>
                <div className="what">
                  <b>{stepName(c.name, lang)}</b>
                  <small>
                    <Link className="link" href={`/factory/${o.id}`}>{o.id}</Link> · {s.name || t("Style")} ({s.colour || "—"}) · {t("due")} {fmtDay(c.due_date)}
                  </small>
                  <div className="row mt-1"><DueChip date={c.due_date} today={today} lang={lang} />{c.status !== "pending" && <span className="chip">{t({ in_progress: "In progress", delayed: "Delayed", completed: "Done", pending: "Pending" }[c.status])}</span>}</div>
                </div>
                <CheckpointControl id={c.id} name={stepName(c.name, lang)} status={c.status} note={c.status_note} reason={c.delay_reason} lang={lang} />
              </li>
            ))}
          </ul>
          {todo.length > 12 && <p className="mt-2 text-xs text-muted">+{todo.length - 12} {t("more inside each order")}.</p>}
        </section>
      )}

      {making.length > 0 && (
        <section className="stack">
          <h2 className="text-[17px] font-bold">{t("Samples to make")}</h2>
          <p className="text-sm text-muted">{t("samples.sub")}</p>
          {making.map((s) => (
            <article key={s.id} className="card stack">
              <div className="row">
                <b className="grow text-[15px]">{sampleTitle(s)}</b>
                {s.vendor_due ? <DueChip date={s.vendor_due} today={today} lang={lang} /> : <span className="chip">{t("No date given")}</span>}
              </div>
              <div className="meta">
                <span><b className="code">{s.id}</b></span>
                <span>{t("Buyer")} <b className="code">{s.buyer_code}</b></span>
                {s.fabric && <span>{t("Fabric")} <b>{s.fabric}</b></span>}
                <span>{t("Pieces")} <b>{nf(s.qty)}</b></span>
                {s.buyer_ref && <span>{t("Ref")} <b>{s.buyer_ref}</b></span>}
                {s.sample_type !== "development" && <span>{t("Type")} <b>{sampleTypeLabel(s.sample_type)}</b></span>}
                <span>{t("Given")} <b>{fmtDay(s.issued_on)}</b></span>
                <span>{t("Return by")} <b>{fmtDay(s.vendor_due)}</b></span>
                {s.round > 1 && <span>{t("Round")} <b>{s.round}</b></span>}
              </div>
              <Attachments target="sample" id={s.id} files={sampleFiles.get(s.id) ?? []} upload={["sample_photo"]} title={t("Photos")} empty={t("samplePhotosEmpty")} />
              <SampleReady id={s.id} lang={lang} />
            </article>
          ))}
        </section>
      )}
      {pastSamples.length > 0 && (
        <details className="panel">
          <summary>{t("Samples you've made")} ({pastSamples.length})</summary>
          <div className="list-rows mt-2">
            {pastSamples.map((s) => (
              <div key={s.id}>
                <span className="grow"><b>{sampleTitle(s)}</b> <span className="code text-muted">{s.id} · {s.buyer_code}</span></span>
                <span className="text-xs text-muted">{t("Ready")} {fmtDay(s.ready_on)}</span>
                <span className={`chip ${s.status === "approved" ? "ok" : s.status === "changes" ? "warn" : s.status === "rejected" ? "bad" : ""}`}>
                  {t(s.status === "approved" ? "Buyer approved" : s.status === "changes" ? "Changes coming" : s.status === "rejected" ? "Not approved" : "With Sourcingo")}
                </span>
                {s.feedback && <span className="w-full text-xs text-warn">{t("Buyer")}: {s.feedback}</span>}
              </div>
            ))}
          </div>
        </details>
      )}

      <section className="stack">
        <div className="row">
          <h2 className="grow text-[17px] font-bold">{t("Orders")}</h2>
          <Pills current={filter} items={FILTERS.map((f) => ({ ...f, label: t(f.label), href: `/factory?show=${f.key}` }))} />
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
                    {o.status === "tna_review" ? <span className="chip info">{t("Coming up")}</span> : o.status === "shipped" ? <span className="chip ok">{t("Completed")}</span> : <DueChip date={o.factory_date} today={today} lang={lang} />}
                  </div>
                  <span className="text-[13px] font-semibold">{o.styles.map((s) => s.name || t("Style")).filter((n, i, a) => a.indexOf(n) === i).join(", ") || t("No styles")}</span>
                  <div className="meta">
                    <span>{t("Qty")} <b className="num">{nf(qty)} {unit(o)}</b></span>
                    <span>{t("Deliver by")} <b>{fmtDay(o.factory_date)}</b></span>
                    <span>{t("Steps")} <b>{done}/{total}</b></span>
                  </div>
                  <Progress cells={cells(o, today)} />
                </Link>
              );
            })}
          </div>
        ) : (
          <Empty title={orders.length ? t("Nothing here") : t("No orders yet")}>
            {orders.length ? t("Try another filter.") : t("ordersEmpty")}
          </Empty>
        )}
      </section>
    </>
  );
}
