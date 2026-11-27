import { redirect } from "next/navigation";
import { PageTabs } from "@/components/page-tabs";
import { canEditOrders, getMe } from "@/lib/auth";
import { dayAt } from "@/lib/format";
import { reportTabs } from "@/lib/page-groups";
import { kitStats, MIN, PROUD, recordGaps, recordLine, recordStats } from "@/lib/record";
import { loadRecord } from "@/lib/record-data";
import { SITE_URL } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { CopyLink, PublicSwitch } from "./record-actions";

// The sales kit: our true record to send a lead, as a PDF or a WhatsApp line, and (once the owner says so) a page on
// the website. Every number is counted from our orders; rates we can't stand behind yet stay on this page only.
export default async function RecordPage() {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const record = await loadRecord(await createClient());
  if (!record) {
    return (
      <>
        <PageTabs tabs={reportTabs(me.role)} label="Reports" />
        <div className="head"><div className="grow"><h1>Our record</h1></div></div>
        <div className="errbox" role="alert">Couldn&apos;t count our record just now. Refresh in a minute.</div>
      </>
    );
  }
  const kit = kitStats(record);
  const held = recordStats(record).filter((s) => s.held);
  const gaps = recordGaps(record);
  const link = `${SITE_URL}/record`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`Sourcingo's record so far: ${recordLine(record)}.${record.public ? `\n\nAll of it, counted from our orders: ${link}` : ""}\n\nAsk for a costing: ${SITE_URL}/costing`)}`;

  return (
    <>
      <PageTabs tabs={reportTabs(me.role)} label="Reports" />
      <div className="head">
        <div className="grow">
          <h1>Our record</h1>
          <p>The true numbers to send a lead, counted live from our orders, shipments and checks. Attach the PDF to an email or WhatsApp.</p>
        </div>
        <div className="row rec-acts">
          <a href="/record/pdf" target="_blank" rel="noopener" className="btn primary">Download PDF</a>
          <a href={wa} target="_blank" rel="noopener" className="btn">Send on WhatsApp</a>
          {record.public && <CopyLink url={link} />}
        </div>
      </div>

      <section className="card" aria-labelledby="kit-h">
        <header className="card-h"><div className="min-w-0"><h2 id="kit-h">What a lead sees</h2><p>On the PDF{record.public ? " and the website" : ""}, as of {dayAt(record.as_of)}.</p></div></header>
        {kit.length === 0 ? <p className="card-empty">Nothing to show yet. The record fills in as orders ship and checks are saved.</p> : (
          <ul className="rec-grid">
            {kit.map((s) => (
              <li key={s.key}>
                <b className="num">{s.value}</b>
                <span>{s.label}</span>
                <small>{s.note}</small>
              </li>
            ))}
          </ul>
        )}
      </section>

      {(held.length > 0 || gaps.length > 0) && (
        <section className="card" aria-labelledby="held-h">
          <header className="card-h"><div className="min-w-0"><h2 id="held-h">Kept off the kit for now</h2><p>True numbers that aren&apos;t strong or big enough to send yet. They join the kit by themselves once they are.</p></div></header>
          <ul className="rec-held">
            {held.map((s) => (
              <li key={s.key}>
                <b className="num text-warn">{s.value}</b>
                <span><b>{s.label}</b><small>{s.note} Joins the kit at {s.key === "defects" ? `${PROUD.defects} or fewer` : s.key === "steps" ? `${PROUD.steps}%` : s.key === "firstpass" ? `${PROUD.firstPass}%` : `${PROUD.onTime}%`}.</small></span>
              </li>
            ))}
            {gaps.map((g) => <li key={g}><b className="num muted">–</b><span><small>{g}</small></span></li>)}
          </ul>
        </section>
      )}

      <section className="card" aria-labelledby="web-h">
        <header className="card-h">
          <div className="min-w-0">
            <h2 id="web-h">On the website</h2>
            <p>{record.public ? <>Live at <a className="link" href="/record" target="_blank" rel="noopener">{link.replace(/^https?:\/\//, "")}</a>, linked from the Quality page and the sitemap.</> : "Off. Only the team can open the record and its PDF."}</p>
          </div>
          {me.role === "owner" ? <PublicSwitch on={record.public} /> : <span className="muted text-[13px]">The owner switches this.</span>}
        </header>
      </section>

      <details className="howto">
        <summary>How these numbers are counted</summary>
        <p>Pieces shipped counts every dispatch marked as sent, fabric in metres kept apart. Steps on time counts each dated TNA step finished by its target; a step still open past its target on an open order counts as late.</p>
        <p>First-time QC is the first Final QC check of each style. Shipments on time compares the day each lot left with the order&apos;s ship date. Factories verified counts a Sourcingo visit recorded in the last year.</p>
        <p>A rate shows only after {MIN.steps} dated steps, {MIN.finals} final checks or {MIN.shipments} shipments, so a lucky start can&apos;t mislead. Cancelled and removed orders never count. Factory and buyer names never appear.</p>
      </details>
    </>
  );
}
