import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_PRODUCTS, siteProduct } from "@/lib/site-products";
import { Check, CtaBand, Eyebrow, PrintPattern, Stages } from "../../parts";

export const dynamicParams = false;
export function generateStaticParams() {
  return SITE_PRODUCTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: PageProps<"/make/[slug]">): Promise<Metadata> {
  const p = siteProduct((await params).slug);
  if (!p) return {};
  return { title: { absolute: `${p.title} · Sourcingo` }, description: p.description, alternates: { canonical: `/make/${p.slug}` } };
}

export default async function MakePage({ params }: PageProps<"/make/[slug]">) {
  const p = siteProduct((await params).slug);
  if (!p) notFound();
  const others = SITE_PRODUCTS.filter((o) => o.slug !== p.slug);
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: p.faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faq) }} />
      <section className="site-page-head">
        <PrintPattern id="mk-print" className="site-hero-print" />
        <div className="site-wrap" style={{ position: "relative" }}>
          <Eyebrow>What we make · {p.name}</Eyebrow>
          <h1>{p.name}, made in Jaipur and watched at every step.</h1>
          <p className="site-lede">{p.lede}</p>
          <div className="site-hero-actions">
            <Link href={`/costing?product=${encodeURIComponent(p.ask)}`} className="site-btn site-btn-lg">Request a costing</Link>
          </div>
        </div>
      </section>
      <section className="site-section">
        <div className="site-wrap site-cards-3">
          <article className="site-card"><h3>What we make</h3><ul className="site-list site-list-tight">{p.makes.map((m) => <li key={m}><Check />{m}</li>)}</ul></article>
          <article className="site-card"><h3>Fabrics and craft</h3><ul className="site-list site-list-tight">{p.craft.map((m) => <li key={m}><Check />{m}</li>)}</ul></article>
          <article className="site-card"><h3>What to send us</h3><ul className="site-list site-list-tight">{p.send.map((m) => <li key={m}><Check />{m}</li>)}</ul></article>
        </div>
      </section>
      <section className="site-section site-section-alt">
        <div className="site-wrap">
          <div className="site-head-block">
            <Eyebrow>How your order moves</Eyebrow>
            <h2>The same six stages for every order.</h2>
          </div>
          <Stages />
        </div>
      </section>
      <section className="site-section">
        <div className="site-wrap">
          <div className="site-head-block"><Eyebrow>Questions</Eyebrow><h2>Before you ask.</h2></div>
          <div className="site-faq">
            {p.faq.map((f) => <details key={f.q}><summary>{f.q}</summary><p>{f.a}</p></details>)}
          </div>
          <div className="site-head-block" style={{ marginTop: 64, marginBottom: 20 }}><h2 style={{ fontSize: 24 }}>We also make</h2></div>
          <ul className="site-tags">
            {others.map((o) => <li key={o.slug}><Link href={`/make/${o.slug}`}>{o.name}</Link></li>)}
          </ul>
        </div>
      </section>
      <CtaBand title={`Have a ${p.ask.toLowerCase()} in mind?`} />
    </>
  );
}
