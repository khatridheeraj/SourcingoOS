import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { kitStats, MIN, monthYear } from "@/lib/record";
import { loadRecord } from "@/lib/record-data";
import { siteClient } from "@/lib/site-data";
import { CtaBand, Eyebrow, PrintPattern } from "../parts";

export const metadata: Metadata = {
  title: "Our record",
  description: "Sourcingo's record in numbers, counted from real orders: pieces shipped, quality inspections, first-time final QC passes and the factories on our orders.",
  alternates: { canonical: "/record" },
};

// Counted fresh every few minutes; shown only once the owner has switched it on in the app.
export const revalidate = 300;

export default async function RecordPage() {
  const record = await loadRecord(siteClient());
  if (!record?.public) notFound();
  const stats = kitStats(record);
  const asOf = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(record.as_of));
  return (
    <>
      <section className="site-page-head">
        <PrintPattern id="rec-print" className="site-hero-print" />
        <div className="site-wrap" style={{ position: "relative" }}>
          <Eyebrow>Our record</Eyebrow>
          <h1>Proof, counted from our own orders.</h1>
          <p className="site-lede">
            Every number here comes straight from the records our team keeps on each order{record.since ? ` since ${monthYear(record.since)}` : ""}:
            shipments, production steps and inspections. Nothing is typed in by hand.
          </p>
          <div className="site-hero-actions">
            <a href="/record/pdf" className="site-btn-ghost site-btn-lg" target="_blank" rel="noopener">Download as PDF</a>
          </div>
        </div>
      </section>
      <section className="site-section" style={{ paddingTop: 48 }}>
        <div className="site-wrap">
          <ul className="site-rec">
            {stats.map((s) => (
              <li key={s.key}>
                <b className="num">{s.value}</b>
                <span>{s.label}</span>
                <p>{s.note}</p>
              </li>
            ))}
          </ul>
          <p className="site-note site-rec-note">
            Counted on {asOf}. A rate appears only once it rests on enough cases ({MIN.steps} dated steps, {MIN.finals} final inspections,
            {" "}{MIN.shipments} shipments), so it reflects how we work rather than a lucky start. Factory names stay private: you deal with
            Sourcingo, and follow your order with photos our team has checked.
          </p>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
