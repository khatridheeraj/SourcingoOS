import "@/app/trade.css";
import type { MadeBefore as Made } from "@/lib/site-made";
import { Eyebrow } from "../../parts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const n = (x: number) => x.toLocaleString("en-IN");

// What has really shipped through Sourcingo for this product: counts, and photos the owner chose to show.
export function MadeBefore({ made, name }: { made: Made | null; name: string }) {
  if (!made) return null;
  const last = made.lastAt ? `${MONTHS[Number(made.lastAt.slice(5, 7)) - 1]} ${made.lastAt.slice(0, 4)}` : null;
  return (
    <section className="site-section">
      <div className="site-wrap">
        <div className="site-head-block">
          <Eyebrow>Made here before</Eyebrow>
          <h2>Made and shipped through Sourcingo.</h2>
          <p className="site-lede site-lede-sm">Counted from goods that left our office, not estimates. Buyers&apos; and factories&apos; names stay private.</p>
        </div>
        <div className="site-cards-3 site-promise">
          <article className="site-card"><b className="num">{n(made.styles)}</b><p>{made.styles === 1 ? "style" : "styles"} made and shipped</p></article>
          <article className="site-card"><b className="num">{n(made.qty)}</b><p>{made.fabric ? "metres" : "pieces"} delivered{made.orders > 1 ? ` across ${n(made.orders)} orders` : ""}</p></article>
          <article className="site-card"><b>{last ?? "—"}</b><p>last shipment</p></article>
        </div>
        {made.photos.length > 0 && (
          <ul className="site-made-grid">
            {made.photos.map((p) => (
              <li key={p.url}>
                {/* eslint-disable-next-line @next/next/no-img-element -- public photo the owner picked */}
                <img src={p.url} alt={p.caption ?? `A ${name.toLowerCase()} style we made`} loading="lazy" data-zoom />
                {p.caption && <span>{p.caption}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
