import type { Metadata } from "next";
import { SITE_STAGES } from "@/lib/site";
import { CtaBand, Eyebrow, Photo, PrintPattern } from "../parts";

export const metadata: Metadata = {
  title: "How it works",
  description: "From your sample to a shipped order: costing on your exact style, a checked factory, a dated plan, verified photos, our own final QC and shipping papers.",
  alternates: { canonical: "/how-it-works" },
};

const DETAIL: Record<string, string[]> = {
  Costing: ["Send a physical sample, a tech pack, or photos and measurements", "We confirm fabric, trims, sizes and packing with you", "You get a price per piece and a ready date, in writing"],
  Factory: ["Factories we have checked quote on your exact style", "We choose on their record with us, not only on price", "You deal with Sourcingo throughout; we answer for the factory"],
  Plan: ["Every step has a target date that works back from your ship date", "The factory commits to its own dates within a day", "If a date moves, we see it first and tell you what it means for shipping"],
  Make: ["Fabric, cutting, stitching, finishing and packing are tracked one by one", "Daily piece counts from the floor", "Photos at each step, checked by our team before they reach your page"],
  "Final QC": ["Inline and mid-line visits while the order is being made", "Final inspection before packing, with defects counted and photographed", "A failed final check stops the shipment until it is put right"],
  Ship: ["Packed to your carton, label and hanger spec", "Packing list per carton and a commercial invoice", "Handed to your forwarder, or we arrange freight with you"],
};

const FAQ = [
  { q: "What is the smallest order you take?", a: "It depends on the style and the fabric. Tell us your quantity in the costing request; we will say honestly whether a factory can make it well at that size." },
  { q: "Can I send my own sample?", a: "Yes, and it is the best way to start. Once your sample reaches our Jaipur office, a merchandiser costs it with you, piece by piece." },
  { q: "Will I know which factory makes my order?", a: "Sourcingo is your supplier and answers for the order end to end. You see verified photos and our quality reports from the floor, and you deal with one team." },
  { q: "How do I follow my order?", a: "You get a private link to your own order page. It shows every style against your ship date, checked photos, quality reports, samples, shipments and invoices, and has a message box for each order." },
  { q: "How long does an order take?", a: "It depends on fabric, print and quantity. Your costing comes with a ready date, and every step in the plan works back from the ship date you need." },
  { q: "Do you make fabric only?", a: "Yes. We supply printed and dyed fabric by the metre as well as finished garments." },
];

export default function HowItWorks() {
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />
      <section className="site-page-head">
        <PrintPattern id="hiw-print" className="site-hero-print" />
        <div className="site-wrap" style={{ position: "relative" }}>
          <Eyebrow>How it works</Eyebrow>
          <h1>From your sample to your warehouse, with one partner answering for it.</h1>
          <p className="site-lede">Six stages, each one visible on your order page. This is exactly how our team runs every order.</p>
        </div>
      </section>
      <section className="site-section" style={{ paddingTop: 40 }}>
        <div className="site-wrap">
          <ol className="site-steps-long">
            {SITE_STAGES.map((s, i) => (
              <li key={s.key}>
                <span className="site-stage-no num">{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.text}</p>
                  <ul>{DETAIL[s.key].map((d) => <li key={d}>{d}</li>)}</ul>
                </div>
              </li>
            ))}
          </ol>
          <div className="site-photos-3" aria-label="Photos from the floor">
            <Photo name="cuttingTables" caption="Fabric laid up for cutting" sizes="(max-width: 640px) 100vw, 33vw" />
            <Photo name="stitching" caption="Stitching, line by line" sizes="(max-width: 640px) 100vw, 33vw" />
            <Photo name="packingFloor" caption="Folding and checking before packing" sizes="(max-width: 640px) 100vw, 33vw" />
          </div>
        </div>
      </section>
      <section className="site-section site-section-alt">
        <div className="site-wrap">
          <div className="site-head-block">
            <Eyebrow>Questions</Eyebrow>
            <h2>What buyers ask us first.</h2>
          </div>
          <div className="site-faq">
            {FAQ.map((f) => (
              <details key={f.q}>
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </>
  );
}
