import type { Metadata } from "next";
import Link from "next/link";
import { SITE_NAV, SITE_URL } from "@/lib/site";
import { SITE_PRODUCTS } from "@/lib/site-products";
import { SiteMenu } from "./site-menu";
import "./site.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Sourcingo · Garment sourcing from India, watched every step", template: "%s · Sourcingo" },
  description:
    "Sourcingo makes your garments with checked factories in Jaipur, India: costing on your exact style, dated production plans, verified photos at every step and our own final QC before anything ships.",
  applicationName: "Sourcingo",
  keywords: ["garment sourcing India", "clothing manufacturer Jaipur", "kurta manufacturer", "co-ord set manufacturer", "kaftan manufacturer",
    "block print fabric supplier", "private label clothing India", "apparel sourcing agent India", "garment quality inspection"],
  openGraph: { type: "website", siteName: "Sourcingo", locale: "en_GB" },
  twitter: { card: "summary_large_image" },
  robots: { index: false, follow: false },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="site">
      <a href="#main" className="site-skip">Skip to content</a>
      <header className="site-head">
        <div className="site-wrap site-head-row">
          <Link href="/" className="site-brand" aria-label="Sourcingo home">
            <span className="site-mark" aria-hidden>S</span>Sourcingo
          </Link>
          <nav className="site-nav" aria-label="Main">
            {SITE_NAV.map((n) => <Link key={n.href} href={n.href}>{n.label}</Link>)}
          </nav>
          <div className="site-head-end">
            <Link href="/login" className="site-signin">Sign in</Link>
            <Link href="/costing" className="site-btn site-btn-sm">Request a costing</Link>
            <SiteMenu />
          </div>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="site-foot">
        <div className="site-wrap site-foot-grid">
          <div>
            <Link href="/" className="site-brand"><span className="site-mark" aria-hidden>S</span>Sourcingo</Link>
            <p className="site-foot-note">Garments made in India, with one partner accountable from sample to shipment. Based in Jaipur, Rajasthan.</p>
          </div>
          <div>
            <h2>Buyers</h2>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/quality">Quality and checks</Link>
            <Link href="/costing">Request a costing</Link>
          </div>
          <div>
            <h2>What we make</h2>
            {SITE_PRODUCTS.map((p) => <Link key={p.slug} href={`/make/${p.slug}`}>{p.name}</Link>)}
          </div>
          <div>
            <h2>Factories</h2>
            <Link href="/for-factories">Work with us</Link>
            <Link href="/for-factories#join">Ask to join</Link>
          </div>
          <div>
            <h2>Sourcingo</h2>
            <Link href="/login">Sign in</Link>
            <Link href="/privacy">Privacy</Link>
          </div>
        </div>
        <div className="site-wrap site-foot-base">© {new Date().getFullYear()} Sourcingo · Jaipur, India</div>
      </footer>
    </div>
  );
}
