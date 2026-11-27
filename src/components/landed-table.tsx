import "@/app/trade.css";
import { money } from "@/lib/format";
import { curMoney, type Landed } from "@/lib/landed";

// The delivered price line by line, in the buyer's currency. Shared with the buyer's page.
export function LandedTable({ l, inr }: { l: Landed; inr?: number }) {
  const m = (n: number) => curMoney(n, l.currency);
  return (
    <dl className="cost-sum num land-sum">
      <div><dt>Our price{inr ? ` (${money(inr)})` : ""}, from India</dt><dd>{m(l.price)}</dd></div>
      <div><dt>Freight by {l.mode} to the door</dt><dd>{m(l.freight)}</dd></div>
      <div><dt>Insurance</dt><dd>{m(l.insurance)}</dd></div>
      <div><dt>Import duty, {l.dutyPct}% estimate</dt><dd>{m(l.duty)}</dd></div>
      <div className="tot"><dt>Delivered, a {l.unit === "m" ? "metre" : "piece"}</dt><dd>{m(l.total)}</dd></div>
    </dl>
  );
}
