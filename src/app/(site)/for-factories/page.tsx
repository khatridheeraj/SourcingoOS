import type { Metadata } from "next";
import { Check, Eyebrow, PrintPattern } from "../parts";
import { JoinForm } from "../forms";

export const metadata: Metadata = {
  title: "For factories",
  description: "Garment and fabric factories in Rajasthan: quote on exact styles, get clear POs, see bills and payment dates, and let your record with Sourcingo win you orders.",
  alternates: { canonical: "/for-factories" },
};

const WHY = [
  { title: "Quote on exact styles", text: "Open orders come with the style, photos, quantity and date. You quote your price and ready date; no guessing." },
  { title: "Clear POs, on paper", text: "Every PO has the styles, photos, rates and terms. Accept it by email, by link or on your page." },
  { title: "Bills and payment dates", text: "See every bill you sent us and when it will be paid, at any time, on your phone." },
  { title: "Your record wins work", text: "On-time steps and first-time QC passes build your record with us. A strong record brings the next order." },
];

const HOW = [
  "Your own page, opened from a WhatsApp link, in English or Hindi",
  "Your plan dates and each step, marked done with a photo",
  "Daily piece counts: cut, stitched, packed",
  "Ask for a new date with a reason, and get an answer",
  "Tell us goods are ready, with cartons and photos, to book final QC and pickup",
];

export default function ForFactories() {
  return (
    <>
      <section className="site-page-head">
        <PrintPattern id="ff-print" className="site-hero-print" />
        <div className="site-wrap" style={{ position: "relative" }}>
          <Eyebrow>For factories</Eyebrow>
          <h1>Steady orders, clear POs, and payments you can see.</h1>
          <p className="site-lede">We work with garment and fabric units across Jaipur and Rajasthan. If you make well and keep your dates, we want to hear from you.</p>
        </div>
      </section>
      <section className="site-section">
        <div className="site-wrap">
          <div className="site-cards-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            {WHY.map((w) => (
              <article key={w.title} className="site-card">
                <h3>{w.title}</h3>
                <p>{w.text}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <section className="site-section site-section-alt">
        <div className="site-wrap site-split site-split-top">
          <div>
            <Eyebrow>Your factory page</Eyebrow>
            <h2>Everything for your orders, on your phone.</h2>
            <p className="site-lede-sm">No app to install and no password. One link opens your page.</p>
          </div>
          <ul className="site-list" style={{ marginTop: 0 }}>
            {HOW.map((h) => <li key={h}><Check />{h}</li>)}
          </ul>
        </div>
      </section>
      <section className="site-section" id="join">
        <div className="site-wrap site-form-layout">
          <div>
            <div className="site-head-block" style={{ marginBottom: 32 }}>
              <Eyebrow>Ask to join</Eyebrow>
              <h2>Tell us about your unit.</h2>
            </div>
            <JoinForm />
          </div>
          <aside className="site-aside" style={{ marginTop: 8 }}>
            <div className="site-card">
              <h3>What we look for</h3>
              <ol>
                <li>Good, consistent stitching and finishing</li>
                <li>Dates that hold, and honest word when they can&apos;t</li>
                <li>Your GST and Udyam papers in order</li>
                <li>A visit to your unit by our team</li>
              </ol>
            </div>
          </aside>
        </div>
      </section>
    </>
  );
}
