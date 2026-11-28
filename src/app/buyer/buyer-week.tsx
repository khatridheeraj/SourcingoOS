import { dm, pastShip, rupees, type BuyerWeek, type OrderWeek } from "@/lib/buyer-week";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function shipLine(o: OrderWeek) {
  if (o.shipped) return "Shipped";
  if (!o.ship) return "Ship date to be confirmed";
  if (o.daysLeft != null && o.daysLeft >= 0) return `Ships ${dm(o.ship)} · ${o.daysLeft === 0 ? "today" : `in ${plural(o.daysLeft, "day")}`}`;
  return `Ship date ${dm(o.ship)}`;
}
// Past its ship date and not shipped: said plainly, in red, until the team sets a new date.
const late = (o: OrderWeek) => !o.shipped && !!o.ship && o.daysLeft != null && o.daysLeft < 0;

// Steps grouped by name, so ten styles cut on one day read as one line.
function grouped(o: OrderWeek) {
  const m = new Map<string, string[]>();
  for (const d of o.done) m.set(d.step, [...new Set([...(m.get(d.step) ?? []), d.style])]);
  return [...m].map(([step, styles]) => ({ step, styles }));
}

// The weekly update as a card: one sentence first, then one block per PO with only what moved, and what comes next.
// Used on the buyer's own page ("This week") and on the team's send screen, so both read the same words.
// `compact` (the buyer's own page, where every PO follows below) keeps only the POs where something moved, and no
// "next" lines, which the PO cards already show.
export function BuyerWeekCard({ week, photoUrls = [], title, sub, compact = false }: { week: BuyerWeek; photoUrls?: string[]; title: string; sub?: string; compact?: boolean }) {
  const money = week.money.pastDue > 0 ? { text: `${rupees(week.money.pastDue)} past its due date`, cls: "bad" }
    : week.money.dueSoon > 0 && week.money.nextDue ? { text: `${rupees(week.money.dueSoon)} falls due from ${dm(week.money.nextDue)}`, cls: "" } : null;
  return (
    <section className="card bweek" aria-labelledby="bweek-h">
      <header className="bweek-h">
        <span className="eyebrow">{sub ?? `Week of ${dm(week.weekOf)}`}</span>
        <h2 id="bweek-h">{title}</h2>
        <p>{week.headline}</p>
      </header>
      {photoUrls.length > 0 && (
        <div className="bweek-photos" aria-label="New photos this week, checked by Sourcingo">
          {photoUrls.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`Photo ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
              <img src={u} alt="" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      <ul className="bweek-orders">
        {week.orders.map((o) => {
          const steps = grouped(o);
          const quiet = !steps.length && !o.qc.length && !o.sent.length;
          if (compact && quiet) return null;
          return (
            <li key={o.id}>
              <div className="bweek-po">
                <b>PO {o.po}</b>
                <span className="num">{shipLine(o)}{late(o) && <> · <b className="text-bad">{pastShip(o.daysLeft!)}</b></>}{!o.shipped && ` · ${o.pct}% done`}</span>
              </div>
              <ul className="bweek-moves">
                {steps.map((s) => <li key={s.step} className="ok"><b>{s.step} done</b> <span>{s.styles.join(", ")}</span></li>)}
                {o.qc.map((q) => (
                  <li key={`qc-${q.style}`} className={q.pass ? "ok" : "warn"}>
                    <b>{q.pass ? "Final QC passed" : "Final QC: being reworked"}</b> <span>{q.style}{q.pass && q.pieces ? `, ${q.pieces} ${o.unit} checked` : ""}</span>
                  </li>
                ))}
                {o.sent.map((s) => (
                  <li key={`sent-${s.on}-${s.pieces}`} className="ok">
                    <b>Sent {dm(s.on)}</b> <span className="num">{s.pieces} {o.unit}{s.cartons ? `, ${plural(s.cartons, "carton")}` : ""}</span>
                  </li>
                ))}
                {late(o) && <li><span>We will confirm the new ship date with you.</span></li>}
                {quiet && !o.shipped && !late(o) && <li><span>Production carries on; nothing new to show this week.</span></li>}
                {!compact && o.next.slice(0, 3).map((n) => (
                  <li key={`next-${n.style}`} className="next"><b>Next</b> <span>{n.step} by {dm(n.by)} · {n.style}</span></li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
      {money && !compact && <p className={`bweek-money ${money.cls}`}><b>Payment</b> {money.text}</p>}
    </section>
  );
}
