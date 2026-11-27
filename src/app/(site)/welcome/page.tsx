import type { Metadata } from "next";
import Link from "next/link";
import { SITE_CATEGORIES, SITE_URL } from "@/lib/site";
import { Check, CtaBand, Eyebrow, OrderTracker, PrintPattern, Stages } from "../parts";

export const metadata: Metadata = {
  title: { absolute: "Sourcingo · Garment sourcing from India, watched every step" },
  alternates: { canonical: "/" },
};

const GAPS = [
  { title: "After you pay, it goes quiet", text: "Marketplaces introduce you to a supplier and step away. You chase on WhatsApp and hope the dates hold." },
  { title: "Quality you only see on arrival", text: "Photos are whatever the supplier chooses to send. Problems show up when the cartons land, when it's too late." },
  { title: "Nobody in the middle to answer", text: "When something slips there is no one accountable for the whole order: fabric, making, checks and shipping." },
];

const SEES = [
  "Where every style is today, step by step, against your ship date",
  "Photos from the factory floor, checked by our team before you see them",
  "Our quality reports: inline, mid-line and final, with defects counted",
  "Samples to approve or send back, with your comments",
  "Shipments, invoices and what is due, in one place",
  "A message box on each order, answered by your merchandiser",
];

export default function Welcome() {
  const org = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Sourcingo",
    url: SITE_URL,
    logo: `${SITE_URL}/icon-512.png`,
    description: "Garment sourcing and production management from Jaipur, India.",
    address: { "@type": "PostalAddress", addressLocality: "Jaipur", addressRegion: "Rajasthan", addressCountry: "IN" },
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(org) }} />
      <section className="site-hero">
        <PrintPattern id="hero-print" className="site-hero-print" />
        <div className="site-wrap site-hero-grid">
          <div className="site-hero-copy">
            <Eyebrow>Garment sourcing from Jaipur, India</Eyebrow>
            <h1>Your order, made in India. <span>Watched at every step.</span></h1>
            <p className="site-lede">
              Sourcingo makes your styles with checked factories, plans every step against your ship date, inspects before
              anything leaves, and shows you verified photos the whole way. One partner, accountable from sample to shipment.
            </p>
            <div className="site-hero-actions">
              <Link href="/costing" className="site-btn site-btn-lg">Request a costing</Link>
              <Link href="/how-it-works" className="site-btn-ghost site-btn-lg">See how it works</Link>
            </div>
            <ul className="site-hero-points">
              <li><Check />Costed on your exact style</li>
              <li><Check />Our own final QC</li>
              <li><Check />Live order page</li>
            </ul>
          </div>
          <div className="site-hero-art"><OrderTracker /></div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap">
          <div className="site-head-block">
            <Eyebrow>Why buyers come to us</Eyebrow>
            <h2>Finding a supplier is easy. Getting the order right is the hard part.</h2>
          </div>
          <div className="site-cards-3">
            {GAPS.map((g, i) => (
              <article key={g.title} className="site-card">
                <span className="site-card-no num">{i + 1}</span>
                <h3>{g.title}</h3>
                <p>{g.text}</p>
              </article>
            ))}
          </div>
          <p className="site-answer">
            <b>Sourcingo stays in the middle and answers for the whole order.</b> We cost it, place it with the right factory,
            plan it, watch it being made, check it, and ship it. You deal with one team that can see everything.
          </p>
        </div>
      </section>

      <section className="site-section site-section-alt">
        <div className="site-wrap">
          <div className="site-head-block">
            <Eyebrow>How an order moves</Eyebrow>
            <h2>Six stages, one ship date, nothing hidden.</h2>
            <p>The same stages our team works to every day. You see each one move on your own order page.</p>
          </div>
          <Stages />
          <div className="site-center"><Link href="/how-it-works" className="site-arrow">The full process, step by step →</Link></div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap site-split">
          <div>
            <Eyebrow>Your order page</Eyebrow>
            <h2>See your order the way we see it.</h2>
            <p className="site-lede-sm">
              Every buyer gets a private page for their orders. No app to install and no password: open the link on a phone or a
              computer, any time.
            </p>
            <ul className="site-list">
              {SEES.map((s) => <li key={s}><Check />{s}</li>)}
            </ul>
          </div>
          <div className="site-phone" aria-hidden>
            <div className="site-phone-screen">
              <div className="site-phone-bar"><span className="site-mark site-mark-sm">S</span>Your orders</div>
              {[
                { po: "PO 2041", style: "Block-print kaftan", days: 18, tone: "ok", note: "Stitching · 53%" },
                { po: "PO 2038", style: "Linen co-ord set", days: 6, tone: "ok", note: "Final QC booked" },
                { po: "PO 2033", style: "Printed cotton fabric", days: 0, tone: "done", note: "Shipped · 4,800 m" },
              ].map((o) => (
                <div key={o.po} className="site-phone-row">
                  <div>
                    <div className="site-phone-po num">{o.po}</div>
                    <div className="site-phone-style">{o.style}</div>
                    <div className="site-phone-note">{o.note}</div>
                  </div>
                  {o.tone === "done" ? <span className="site-chip-ok">Shipped</span> : <div className="site-clock site-clock-sm"><b className="num">{o.days}</b><span>days</span></div>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="site-section site-section-alt">
        <div className="site-wrap">
          <div className="site-head-block">
            <Eyebrow>Quality you can check</Eyebrow>
            <h2>Trust that is earned on real orders.</h2>
          </div>
          <div className="site-cards-3">
            <article className="site-card">
              <h3>Factories earn their record</h3>
              <p>Every factory we use has a record with us, built from real orders: steps on time, final QC passed first time, defects found.
                The best record wins the next order.</p>
            </article>
            <article className="site-card">
              <h3>Photos checked before you see them</h3>
              <p>The factory posts photos at each step. Our team checks every one before it reaches your page, so what you see is real
                and current.</p>
            </article>
            <article className="site-card">
              <h3>Our own inspectors</h3>
              <p>Sourcingo&apos;s quality team visits the floor inline and mid-line, and does the final inspection before packing.
                A failed final check stops the shipment.</p>
            </article>
          </div>
          <div className="site-center"><Link href="/quality" className="site-arrow">How we check quality →</Link></div>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap site-split site-split-top">
          <div>
            <Eyebrow>What we make</Eyebrow>
            <h2>Rajasthan&apos;s craft, made to your spec.</h2>
            <p className="site-lede-sm">
              Jaipur and Sanganer are home to some of the world&apos;s finest hand block printing and garment making. We work with
              factories that do it well, and keep them to your standard.
            </p>
          </div>
          <ul className="site-tags">
            {SITE_CATEGORIES.map((c) => <li key={c}>{c}</li>)}
          </ul>
        </div>
      </section>

      <section className="site-section site-section-alt">
        <div className="site-wrap site-factory-band">
          <div>
            <Eyebrow>For factories</Eyebrow>
            <h2>Good factories deserve steady, fair orders.</h2>
            <p className="site-lede-sm">Quote on exact styles, get clear POs, see every bill and payment date, and let your record win you work.</p>
          </div>
          <Link href="/for-factories" className="site-btn-ghost site-btn-lg">Work with Sourcingo</Link>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
