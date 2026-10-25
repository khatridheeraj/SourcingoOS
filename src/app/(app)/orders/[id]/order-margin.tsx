import { money, qty, unitOfAll } from "@/lib/format";
import { marginCls, pct, planMargin, THIN_MARGIN_PCT } from "@/lib/margin";

export type MarginStyle = { id: string; style: string; colour: string; qty: number; product?: string; buyerRate: number | null; factoryRate: number | null };
export type MarginDispatch = { invoiceTaxable: number | null; purchaseTaxable: number; lines: { qty: number }[] };

// What the order earns: planned from the rates, and actual from what has been bought and invoiced so far.
export function OrderMargin({ styles, dispatches }: { styles: MarginStyle[]; dispatches: MarginDispatch[] }) {
  const plan = planMargin(styles.map((s) => ({ qty: s.qty, buyer_rate: s.buyerRate, factory_rate: s.factoryRate })));
  const invoiced = dispatches.filter((d) => d.invoiceTaxable != null);
  const sold = invoiced.reduce((t, d) => t + (d.invoiceTaxable ?? 0), 0);
  const bought = invoiced.reduce((t, d) => t + d.purchaseTaxable, 0);
  const actualPct = sold > 0 ? ((sold - bought) / sold) * 100 : null;
  // An order sent in parts earns part by part.
  const pcsInvoiced = invoiced.reduce((t, d) => t + d.lines.reduce((u, l) => u + l.qty, 0), 0);
  const pcsOrdered = styles.reduce((t, s) => t + s.qty, 0);
  const thin = styles.filter((s) => {
    if (s.buyerRate == null || s.factoryRate == null || s.buyerRate === 0) return false;
    return ((s.buyerRate - s.factoryRate) / s.buyerRate) * 100 < THIN_MARGIN_PCT;
  });

  return (
    <section className="panel scroll-mt-20" id="money">
      <h2>Margin</h2>
      <div className="tiles">
        <div className="tile"><span>Buyer pays</span><b>{money(plan.sale)}</b></div>
        <div className="tile"><span>Factory cost</span><b>{money(plan.cost)}</b></div>
        <div className="tile">
          <span>Margin</span>
          <b className={marginCls(plan.pct)}>{money(plan.margin)}</b>
          <span className={`mt-1 ${marginCls(plan.pct)}`}>{pct(plan.pct)}</span>
        </div>
        {invoiced.length > 0 && (
          <div className="tile">
            <span>Earned on invoiced goods</span>
            <b className={marginCls(actualPct)}>{money(sold - bought)}</b>
            <span className="mt-1">{pct(actualPct)} on {money(sold)} invoiced{pcsInvoiced < pcsOrdered && ` · ${qty(pcsInvoiced)} of ${qty(pcsOrdered)} ${unitOfAll(styles)}`}</span>
          </div>
        )}
      </div>
      {plan.missing > 0 && (
        <p className="mt-3 text-[13px] text-warn">
          {plan.missing} {plan.missing === 1 ? "style is" : "styles are"} missing a buyer or factory rate, so {plan.missing === 1 ? "it is" : "they are"} left out above.
        </p>
      )}
      {thin.length > 0 && (
        <p className="mt-3 text-[13px] text-warn">Below {THIN_MARGIN_PCT}% margin: {thin.map((s) => s.style).join(", ")}.</p>
      )}
      {styles.length > 1 && (
        <div className="table-wrap mt-3">
          <table className="tbl">
            <thead>
              <tr><th>Style</th><th className="r">Pieces</th><th className="r">Buyer rate</th><th className="r">Factory rate</th><th className="r">Per piece</th><th className="r">Margin</th><th className="r">%</th></tr>
            </thead>
            <tbody>
              {styles.map((s) => {
                const has = s.buyerRate != null && s.factoryRate != null;
                const per = has ? s.buyerRate! - s.factoryRate! : null;
                const p = has && s.buyerRate! > 0 ? (per! / s.buyerRate!) * 100 : null;
                return (
                  <tr key={s.id}>
                    <td><span className="code">{s.style}</span>{s.colour && <span className="muted"> · {s.colour}</span>}</td>
                    <td className="r num">{qty(s.qty)}</td>
                    <td className="r num">{money(s.buyerRate)}</td>
                    <td className="r num">{money(s.factoryRate)}</td>
                    <td className="r num">{money(per)}</td>
                    <td className="r num">{per == null ? <span className="muted">Rate missing</span> : money(per * s.qty)}</td>
                    <td className={`r num ${marginCls(p)}`}>{pct(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="muted mt-3 text-[12px]">Before GST and freight. Earned is the invoice value less the factory bill, for dispatches already invoiced.</p>
    </section>
  );
}
