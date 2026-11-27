import type { Metadata } from "next";
import { Eyebrow } from "../parts";

export const metadata: Metadata = {
  title: "Privacy",
  description: "What Sourcingo does with the details you send through this website.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <>
      <section className="site-page-head">
        <div className="site-wrap">
          <Eyebrow>Privacy</Eyebrow>
          <h1>What we do with your details.</h1>
        </div>
      </section>
      <section className="site-section" style={{ paddingTop: 48 }}>
        <div className="site-wrap site-prose">
          <h2>What we keep</h2>
          <p>When you ask for a costing or ask to join as a factory, we keep what you type in the form: your name, company, email or phone,
            country and what you would like made or what you make.</p>
          <h2>Why</h2>
          <p>Only to reply to you, prepare a costing, and, if we work together, run your orders. We do not sell or share your details with anyone
            outside Sourcingo, and we do not send newsletters you did not ask for.</p>
          <h2>Cookies</h2>
          <p>This website sets no tracking or advertising cookies. A cookie is used only when you sign in to Sourcingo.</p>
          <h2>Removing your details</h2>
          <p>Ask your Sourcingo contact, or reply to any email from us, and we will remove what we hold that is not needed for an order or for the law.</p>
        </div>
      </section>
    </>
  );
}
