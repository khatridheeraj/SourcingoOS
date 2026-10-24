import Link from "next/link";
import { day, money } from "@/lib/format";
import { styleKey, type PoComparison } from "@/lib/po-match";

export type CompareSide = {
  title: string;
  href?: string;
  po: string;
  poDate: string | null;
  shipDate: string | null;
  lines: { style: string; description: string; qty: number; rate: number | null }[];
};

// A buyer PO beside the order that already has its PO number, so a person decides what they are with both in view.
export function PoCompare({ verdict, left, right, orderId, orderNo }: {
  verdict: PoComparison; left: CompareSide; right: CompareSide; orderId: string; orderNo: string;
}) {
  const shared = new Set(verdict.shared.map(styleKey));
  const fix = `/orders/${orderId}#details`;
  const newStyles = verdict.onlyPo.join(", ");
  return (
    <section className="panel" aria-labelledby="cmp-h">
      <h2 id="cmp-h" className="mb-3 text-[15px] font-semibold">Side by side</h2>
      <div className="po-compare">
        {[left, right].map((side) => (
          <div key={side.title} className="po-compare-side">
            <h3>{side.href ? <Link href={side.href} className="link">{side.title}</Link> : side.title}</h3>
            <dl>
              <dt>PO no.</dt><dd className="num">{side.po || "Not read"}</dd>
              <dt>PO date</dt><dd className="num">{side.poDate ? day(side.poDate) : "Not read"}</dd>
              <dt>Ship by</dt><dd className="num">{side.shipDate ? day(side.shipDate) : "Not read"}</dd>
            </dl>
            <ul>
              {side.lines.length === 0 && <li className="muted">No styles read</li>}
              {side.lines.map((l, i) => (
                <li key={i}>
                  <b className={verdict.verdict === "unknown" || shared.has(styleKey(l.style)) ? "" : "text-bad"}>{l.style}</b>
                  <span className="muted">{l.description}</span>
                  <span className="num">{l.qty ? `${l.qty.toLocaleString("en-IN")} pcs` : ""}{l.rate != null ? ` · ${money(l.rate)}` : ""}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="stack mt-4 text-[13.5px]">
        {verdict.verdict === "same" ? (
          <p>Same style on both, so this is {orderNo} sent again. <Link href={fix} className="link">Open {orderNo}</Link> to update anything that changed, then set this one aside below.</p>
        ) : (
          <>
            <p><b>{orderNo} has the wrong PO number?</b> <Link href={fix} className="link">Correct it on {orderNo}</Link>, then come back here: this PO can then be created as its own order.</p>
            <p><b>The buyer used PO {left.po} for both?</b> <Link href={fix} className="link">Add {newStyles || "the styles"} to {orderNo}</Link>, then set this one aside below.</p>
          </>
        )}
      </div>
    </section>
  );
}
