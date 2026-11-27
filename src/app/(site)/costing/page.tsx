import type { Metadata } from "next";
import { Eyebrow } from "../parts";
import { CostingForm } from "../forms";

export const metadata: Metadata = {
  title: "Request a costing",
  description: "Tell us what you would like made: kurtas, co-ord sets, kaftans, dresses or printed fabric. A Sourcingo merchandiser replies with questions or a price.",
  alternates: { canonical: "/costing" },
};

export default async function Costing({ searchParams }: PageProps<"/costing">) {
  const ask = (await searchParams).product;
  const product = typeof ask === "string" ? ask.slice(0, 200) : "";
  return (
    <>
      <section className="site-page-head">
        <div className="site-wrap">
          <Eyebrow>Request a costing</Eyebrow>
          <h1>Tell us what you would like made.</h1>
          <p className="site-lede">No sign-up and no obligation. The more you tell us, the closer the first price will be.</p>
        </div>
      </section>
      <section className="site-section" style={{ paddingTop: 48 }}>
        <div className="site-wrap site-form-layout">
          <CostingForm product={product} />
          <aside className="site-aside">
            <div className="site-card">
              <h3>What happens next</h3>
              <ol>
                <li>A merchandiser reads your request and replies by email, usually within a working day.</li>
                <li>If you have a sample, send it to our Jaipur office. We cost it piece by piece.</li>
                <li>You get a price per piece and a ready date, in writing.</li>
                <li>Say yes, and your order page goes live with every step dated.</li>
              </ol>
            </div>
            <p className="site-note">Already a Sourcingo buyer? Use <b>Get a costing</b> on your own order page, and your merchandiser sees it at once.</p>
          </aside>
        </div>
      </section>
    </>
  );
}
