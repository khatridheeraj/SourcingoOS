import { createClient } from "@/lib/supabase/server";
import { day, daysBetween, qty, qtyTotal, qtyU, todayIST, TNA_STEPS, unitOfAll } from "@/lib/format";
import { PHOTO_BUCKET } from "@/lib/storage";
import { getMe } from "@/lib/auth";
import { BuyerSamples, type BuyerSample } from "./buyer-samples";

type Step = { stage: string; label: string | null; planned_on: string | null; done_on: string | null };
type FinalQc = { result: string; checked_on: string; pieces_checked: number | null; photos: string[] };
type Line = { id: string; style: string; colour: string | null; description: string | null; qty: number; product?: string; shipped?: number; photo_path: string | null; steps: Step[]; final_qc: FinalQc | null };
type Order = { id: string; order_no: string; buyer_po: string | null; po_date: string | null; status: string; ship_date: string | null; revised_ship_date: string | null; closed_short?: boolean; lines: Line[] };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dm = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
const stepName = (s: Step) => s.label ?? TNA_STEPS.find((t) => t.key === s.stage)?.label ?? s.stage;

// Where a style stands, in the buyer's words: the furthest step done ("PP sample done", not "At PP sample",
// which reads as if it were still being made) and the one after it.
// Inside targets are not deadlines for the buyer, so a passed target shows as "in progress", never as late.
function where(l: Line, today: string) {
  const done = l.steps.filter((s) => s.done_on).length;
  let last = -1;
  l.steps.forEach((s, i) => { if (s.done_on) last = i; });
  const next = l.steps.slice(last + 1).find((s) => !s.done_on) ?? l.steps.find((s) => !s.done_on);
  const at = last < 0 ? "Not started" : `${stepName(l.steps[last])} done`;
  const then = !next ? "Every step done"
    : next.planned_on && next.planned_on >= today ? `Next: ${stepName(next)} by ${dm(next.planned_on)}` : `Next: ${stepName(next)}`;
  return { done, total: l.steps.length, at, then, next };
}

function qcChip(q: FinalQc | null) {
  if (!q) return { text: "Final QC not done yet", cls: "" };
  return q.result === "pass" ? { text: `Final QC passed ${dm(q.checked_on)}`, cls: "ok" } : { text: "Final QC: being reworked", cls: "warn" };
}

// "Final QC not done yet" means something only once a style is near the end of production.
const NEAR_QC = ["finishing", "packed", "final_qc", "ex_factory"];

// Styles shown per PO before "Show more", so a 9-style PO doesn't bury the next one.
const SHOWN = 3;

export default async function BuyerPage() {
  const supabase = await createClient();
  const [me, { data, error }, { data: sampleRows }] = await Promise.all([getMe(), supabase.rpc("buyer_orders"), supabase.rpc("buyer_samples")]);
  const { buyer, orders } = (data ?? { buyer: "", orders: [] }) as { buyer: string; orders: Order[] };
  const rawSamples = (sampleRows ?? []) as (Omit<BuyerSample, "styleUrl" | "answerPhotos"> & { photo_path: string | null; answer_photos: string[] })[];
  const today = todayIST();

  // One batch of short-lived links for every photo on the page.
  const paths = [...new Set([
    ...orders.flatMap((o) => o.lines.flatMap((l) => [l.photo_path, ...(l.final_qc?.photos ?? [])])),
    ...rawSamples.flatMap((s) => [s.photo_path, ...s.photos, ...s.answer_photos]),
  ].filter((p): p is string => !!p))];
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const url = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));

  const samples: BuyerSample[] = rawSamples.map(({ photo_path, answer_photos, ...s }) => ({
    ...s, styleUrl: (photo_path && url.get(photo_path)) || null,
    photos: s.photos.map((p) => url.get(p)).filter((u): u is string => !!u), answerPhotos: answer_photos.map((p) => url.get(p)).filter((u): u is string => !!u),
  }));
  const open = orders.filter((o) => o.status === "open");
  const styles = open.flatMap((o) => o.lines);
  const passed = styles.filter((l) => l.final_qc?.result === "pass").length;
  const nextShip = open.map((o) => o.revised_ship_date ?? o.ship_date).filter((d): d is string => !!d && d >= today).sort()[0];

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{buyer ? `${buyer}'s orders` : "Your orders"}</h1>
          {/* The whole picture in one line; each order below says where it is. */}
          {open.length > 0 && (
            <p className="num">
              {open.length} open {open.length === 1 ? "order" : "orders"} · {qtyTotal(styles)}
              {nextShip && <> · next ship <b className="text-foreground">{dm(nextShip)}</b>, {inDays(daysBetween(today, nextShip))}</>}
              {passed > 0 && <> · {passed} of {styles.length} styles passed final QC</>}
            </p>
          )}
        </div>
      </div>
      {error && <div className="errbox">{error.message}</div>}
      <BuyerSamples companyId={me?.companyId ?? ""} samples={samples} />

      {orders.length === 0 && !error ? (
        <div className="empty"><b>No open orders right now</b>Orders appear here as soon as Sourcingo enters your PO.</div>
      ) : (
        <>
          {orders.map((o) => {
            const ship = o.revised_ship_date ?? o.ship_date;
            const lines = o.lines.map((l) => ({ l, w: where(l, today), qc: qcChip(l.final_qc) }));
            const done = lines.reduce((n, x) => n + x.w.done, 0);
            const total = lines.reduce((n, x) => n + x.w.total, 0);
            const shipped = o.status === "shipped";
            // Pieces already sent, for an order going out in parts.
            const ordered = o.lines.reduce((n, l) => n + Number(l.qty), 0);
            const sent = o.lines.reduce((n, l) => n + Number(l.shipped ?? 0), 0);
            const left = ship ? daysBetween(today, ship) : null;
            // Hiding just one style saves nothing, so a PO is cut only when two or more would be hidden.
            const cut = lines.length > SHOWN + 1 ? SHOWN : lines.length;
            // Photos only when this PO has at least one; a column of empty boxes tells the buyer nothing.
            const photos = o.lines.some((l) => l.photo_path && url.get(l.photo_path));
            const list = photos ? "bstyles" : "bstyles no-photo";
            const item = ({ l, w, qc }: (typeof lines)[number]) => {
              const photo = l.photo_path ? url.get(l.photo_path) : undefined;
              const qcPhotos = (l.final_qc?.photos ?? []).map((p) => url.get(p)).filter((u): u is string => !!u);
              return (
                <li key={l.id}>
                  <details className="bstyle">
                    <summary>
                      {photos && (
                        <span className="style-photo">
                          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                          {photo ? <img src={photo} alt="" /> : <span className="ph">No photo</span>}
                        </span>
                      )}
                      <span className="bstyle-id">
                        <b className="code">{l.style}</b>
                        <span>{[l.colour, l.description, qtyU(l.qty, l.product), !shipped && l.shipped ? `${qty(l.shipped)} shipped` : ""].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="bstyle-prog">
                        <span className="stepper" aria-label={`${w.done} of ${w.total} steps done`}>
                          {l.steps.map((s) => <i key={s.stage} className={s.done_on ? "ok" : s === w.next ? "now" : ""} />)}
                        </span>
                        <span className="style-line"><span>{w.at} · {w.done} of {w.total} steps</span><b>{w.then}</b></span>
                      </span>
                      {l.final_qc || !w.next || NEAR_QC.includes(w.next.stage) ? <span className={`chip ${qc.cls}`}>{qc.text}</span> : <span className="bstyle-nochip" aria-hidden />}
                      <svg className="bstyle-chev" viewBox="0 0 16 16" aria-hidden><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </summary>
                    <div className="bstyle-body">
                      <ol className="btimeline">
                        {l.steps.map((s) => {
                          const now = s === w.next;
                          return (
                            <li key={s.stage} className={s.done_on ? "done" : now ? "now" : ""}>
                              <i aria-hidden>{s.done_on ? "✓" : ""}</i>
                              <span>{stepName(s)}</span>
                              <small>
                                {s.done_on ? `Done ${dm(s.done_on)}` : now ? (s.planned_on && s.planned_on >= today ? `In progress, by ${dm(s.planned_on)}` : "In progress")
                                  : s.planned_on && s.planned_on >= today ? `Planned ${dm(s.planned_on)}` : null}
                              </small>
                            </li>
                          );
                        })}
                      </ol>
                      {l.final_qc && (
                        <div className="bqc">
                          <div className="row">
                            <b>Final quality check</b>
                            <span className={`chip ${qc.cls}`}>{l.final_qc.result === "pass" ? "Passed" : "Being reworked"}</span>
                            <span className="muted text-[13px]">
                              {[day(l.final_qc.checked_on), l.final_qc.pieces_checked ? `${qty(l.final_qc.pieces_checked)} pcs checked` : ""].filter(Boolean).join(" · ")}
                            </span>
                          </div>
                          {qcPhotos.length > 0 && (
                            <div className="bqc-photos">
                              {qcPhotos.map((u, i) => (
                                <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`QC photo ${i + 1} of ${l.style}`}>
                                  {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                                  <img src={u} alt="" loading="lazy" />
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </details>
                </li>
              );
            };
            return (
              <section key={o.id} className="bord" aria-label={`PO ${o.buyer_po ?? o.order_no}`}>
                <header className="bord-h">
                  <div className="bord-id">
                    <span className="eyebrow">Your PO</span>
                    <h2>{o.buyer_po || o.order_no}</h2>
                    <span className="muted">
                      {[`Sourcingo ref ${o.order_no}`, o.po_date && `PO date ${day(o.po_date)}`, `${lines.length} ${lines.length === 1 ? "style" : "styles"}`,
                        qtyTotal(o.lines)].filter(Boolean).join(" · ")}
                    </span>
                  </div>
                  <div className="bord-ship">
                    {shipped ? <span className="chip ok">{o.closed_short && sent < ordered ? `Shipped · ${qty(sent)} of ${qty(ordered)} ${unitOfAll(o.lines)}` : "Shipped"}</span> : ship ? (
                      <>
                        <span className="eyebrow">{o.revised_ship_date ? "Revised ship date" : "Ship date"}</span>
                        <b>{day(ship)}</b>
                        {left != null && left >= 0 && <span className="muted">{inDays(left)}</span>}
                      </>
                    ) : <span className="muted">Ship date to be confirmed</span>}
                  </div>
                </header>
                {!shipped && sent > 0 && (
                  <p className="bord-sent"><span className="chip ok">Part shipped</span> {qty(sent)} of {qty(ordered)} {unitOfAll(o.lines)} sent · {qty(ordered - sent)} to follow</p>
                )}
                {!shipped && total > 0 && (
                  <div className="bord-prog">
                    <div className="bmeter" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label="Steps done">
                      <i style={{ width: `${Math.round((done / total) * 100)}%` }} />
                    </div>
                    <span>{Math.round((done / total) * 100)}% done</span>
                  </div>
                )}
                <ul className={list}>{lines.slice(0, cut).map(item)}</ul>
                {lines.length > cut && (
                  <details className="bmore">
                    <summary>Show {lines.length - cut} more styles</summary>
                    <ul className={list}>{lines.slice(cut).map(item)}</ul>
                  </details>
                )}
              </section>
            );
          })}
          <p className="muted text-center text-[12.5px]">Questions about an order? Message your Sourcingo merchandiser.</p>
        </>
      )}
    </>
  );
}

// "today", "in 1 day", "in 8 days": the header and each order say it the same way.
function inDays(n: number) {
  return n === 0 ? "today" : `in ${n} ${n === 1 ? "day" : "days"}`;
}
