import Link from "next/link";
import { SITE_STAGES } from "@/lib/site";

// A hand block-print motif (a buti), drawn as a repeating pattern in the accent colour. Jaipur's own craft, as texture.
export function PrintPattern({ id, className, opacity = 0.14 }: { id: string; className?: string; opacity?: number }) {
  return (
    <svg className={className} aria-hidden width="100%" height="100%">
      <defs>
        <pattern id={id} width="56" height="56" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeWidth="1.2" opacity={opacity}>
            <circle cx="28" cy="28" r="3.2" />
            <path d="M28 18c3 3.4 3 6.6 0 10-3-3.4-3-6.6 0-10zM28 38c3-3.4 3-6.6 0-10-3 3.4-3 6.6 0 10zM18 28c3.4-3 6.6-3 10 0-3.4 3-6.6 3-10 0zM38 28c-3.4-3-6.6-3-10 0 3.4 3 6.6 3 10 0z" />
            <circle cx="0" cy="0" r="1.6" /><circle cx="56" cy="0" r="1.6" /><circle cx="0" cy="56" r="1.6" /><circle cx="56" cy="56" r="1.6" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

// A swatch standing in for a verified step photo: fabric, print or a stitched piece.
function Swatch({ kind, id }: { kind: "fabric" | "print" | "stitch"; id: string }) {
  return (
    <div className={`site-swatch site-swatch-${kind}`}>
      {kind === "print" ? <PrintPattern id={id} opacity={0.5} /> : null}
      <span className="site-verified" title="Checked by the Sourcingo team">
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden><path d="M2 5.2l2 2 4-4.4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        Verified
      </span>
    </div>
  );
}

// What a buyer sees for one order: the hero picture, drawn from the real buyer page.
export function OrderTracker() {
  const done = 3;
  return (
    <div className="site-tracker" role="img" aria-label="Example of a buyer's order page: 18 days to ship, stitching 640 of 1,200 pieces, verified photos, inline QC passed.">
      <div className="site-tracker-top">
        <span className="site-tracker-po num">PO 2041 · 1,200 pcs</span>
        <span className="site-chip-ok">On track</span>
      </div>
      <div className="site-tracker-main">
        <div>
          <div className="site-tracker-style">Block-print cotton kaftan</div>
          <div className="site-tracker-sub">3 colours · ships to London</div>
        </div>
        <div className="site-clock"><b className="num">18</b><span>days to ship</span></div>
      </div>
      <div className="site-meter" aria-hidden>
        {SITE_STAGES.map((s, i) => (
          <div key={s.key} className="site-meter-step">
            <i className={i < done ? "is-done" : i === done ? "is-now" : ""} />
            <span>{s.key}</span>
          </div>
        ))}
      </div>
      <div className="site-tracker-now">
        <div className="site-tracker-now-row"><span>Stitching</span><span className="num">640 of 1,200</span></div>
        <div className="site-bar"><i style={{ width: "53%" }} /></div>
      </div>
      <div className="site-swatches">
        <Swatch kind="fabric" id="sw1" />
        <Swatch kind="print" id="sw2" />
        <Swatch kind="stitch" id="sw3" />
      </div>
      <div className="site-tracker-foot"><i className="site-dot-ok" />Inline QC passed · 24 Nov</div>
    </div>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="site-eyebrow">{children}</p>;
}

// The six stages, numbered, as cards.
export function Stages({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={`site-stages${compact ? " is-compact" : ""}`}>
      {SITE_STAGES.map((s, i) => (
        <li key={s.key}>
          <span className="site-stage-no num">{String(i + 1).padStart(2, "0")}</span>
          <span className="site-stage-key">{s.key}</span>
          <h3>{s.title}</h3>
          <p>{s.text}</p>
        </li>
      ))}
    </ol>
  );
}

// The closing band on every page: one clear next step.
export function CtaBand({ title = "Have a style in mind?", text = "Send us your sample, tech pack or a few photos. A merchandiser replies with questions or a price, usually within a working day." }: { title?: string; text?: string }) {
  return (
    <section className="site-cta">
      <PrintPattern id="cta-print" className="site-cta-print" opacity={0.22} />
      <div className="site-wrap site-cta-inner">
        <div>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>
        <div className="site-cta-actions">
          <Link href="/costing" className="site-btn site-btn-lg">Request a costing</Link>
          <Link href="/how-it-works" className="site-arrow">How it works →</Link>
        </div>
      </div>
    </section>
  );
}

export function Check() {
  return (
    <svg className="site-check" width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <circle cx="9" cy="9" r="9" fill="currentColor" opacity="0.12" />
      <path d="M5.2 9.3l2.5 2.4 5-5.3" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
