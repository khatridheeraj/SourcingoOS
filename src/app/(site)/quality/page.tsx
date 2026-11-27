import type { Metadata } from "next";
import { siteFacts } from "@/lib/site-data";
import { Check, CtaBand, Eyebrow, Photo, PrintPattern } from "../parts";

export const metadata: Metadata = {
  title: "Quality and checks",
  description: "How Sourcingo keeps garment quality: factories that earn their record on real orders, photos checked before buyers see them, and our own inline, mid-line and final inspections.",
  alternates: { canonical: "/quality" },
};

// The Guarantee shows only once the owner has switched it on in the app.
export const revalidate = 300;

const RECORD = [
  "Steps finished on the date they promised",
  "Final inspections passed the first time",
  "Defects found per hundred pieces checked",
  "Claims raised after delivery",
  "A Sourcingo visit to the unit, with its papers checked",
];

const CHECKS = [
  { title: "Inline", text: "Early in stitching, we check the first pieces against the approved sample and the spec, so a fault is fixed before it repeats." },
  { title: "Mid-line", text: "Halfway through, we check workmanship, measurements and finishing on pieces pulled from the line." },
  { title: "Final", text: "Before packing, we inspect a sample of finished pieces, count defects by type and photograph them. A fail stops the shipment." },
];

export default async function Quality() {
  // The page reads fine without it; the Guarantee just stays hidden.
  const facts = await siteFacts();
  return (
    <>
      <section className="site-page-head">
        <PrintPattern id="q-print" className="site-hero-print" />
        <div className="site-wrap" style={{ position: "relative" }}>
          <Eyebrow>Quality and checks</Eyebrow>
          <h1>Quality you can see while it is being made, not after it lands.</h1>
          <p className="site-lede">Three things keep an order right: the right factory, honest pictures from the floor, and our own inspectors.</p>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap site-split site-split-top">
          <div>
            <Eyebrow>Factory record</Eyebrow>
            <h2>Every factory earns its place, order by order.</h2>
            <p className="site-lede-sm">
              We keep a record for each factory we work with, built only from real orders with us. It decides who gets the next
              order, and a factory on a weak record is not offered new work until it improves.
            </p>
          </div>
          <ul className="site-list" style={{ marginTop: 0 }}>
            {RECORD.map((r) => <li key={r}><Check />{r}</li>)}
          </ul>
        </div>
      </section>

      <section className="site-section site-section-alt">
        <div className="site-wrap site-split site-split-top">
          <div>
            <Eyebrow>Verified photos</Eyebrow>
            <h2>Every photo you see has been checked by us first.</h2>
          </div>
          <div className="site-prose">
            <p>The factory posts a photo when it finishes a step: fabric in, cutting, stitching, finishing, packing. Our team looks at each one
              against your approved sample before it appears on your order page.</p>
            <p>So the pictures you see are current, from your order, and already looked at by someone who answers to you.</p>
            <Photo name="finishing" className="site-photo-wide" caption="Printed shirts checked piece by piece on the finishing line." />
          </div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap">
          <div className="site-head-block">
            <Eyebrow>Our inspections</Eyebrow>
            <h2>Our own quality team, on the floor three times.</h2>
          </div>
          <div className="site-cards-3">
            {CHECKS.map((c, i) => (
              <article key={c.title} className="site-card">
                <span className="site-card-no num">{i + 1}</span>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {facts.guarantee ? (
        <section className="site-section site-section-alt">
          <div className="site-wrap">
            <div className="site-head-block">
              <Eyebrow>The Sourcingo Guarantee</Eyebrow>
              <h2>If it is not right, we put it right.</h2>
              <p>Our promise on every order placed under the Guarantee.</p>
            </div>
            <div className="site-promise">
              <article className="site-card"><b className="num">{facts.deposit_pct ?? 30}%</b><p>Deposit to start. The balance is due only after our final inspection passes.</p></article>
              <article className="site-card"><b className="num">7 days</b><p>To decide any claim you raise after delivery: a remake or a refund for the pieces affected.</p></article>
              <article className="site-card"><b className="num">{facts.pay_days ?? 15} days</b><p>Factories are paid soon after a pass, so the best ones keep choosing your orders.</p></article>
            </div>
          </div>
        </section>
      ) : null}

      <CtaBand title="Want to see it on your own order?" />
    </>
  );
}
