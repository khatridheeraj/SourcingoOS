import { VisitButton } from "@/components/visit-sheet";
import { dayAt, dayNear } from "@/lib/format";
import { floorLine, floorNote, floorStatus } from "@/lib/floor";

export type FloorUpdate = {
  id: string; style: string; step: string; status: string; qtyDone: number | null; total: string; expectedOn: string | null; note: string;
  at: string; by: string; photos: string[];
};

const dm = (d: string) => dayNear(d);

// What Quality saw on its factory visits, newest first: each style's step, how it is, and the photos.
export function OrderFloor({ orderId, updates, canPost }: { orderId: string; updates: FloorUpdate[]; canPost: boolean }) {
  if (!updates.length) return null;
  const row = (u: FloorUpdate) => (
    <li key={u.id} className="floor-row">
      <span className={`sev ${floorStatus(u.status).tone}`} aria-hidden />
      <div className="floor-what min-w-0">
        <b><span className="code">{u.style}</span>{floorLine({ status: u.status, qty_done: u.qtyDone, expected_on: u.expectedOn, note: u.note }, u.step, u.total, dm)}</b>
        <small>{u.by} · {dayAt(u.at)}</small>
        {floorNote(u.note, u.step) && <p className="floor-note">&ldquo;{floorNote(u.note, u.step)}&rdquo;</p>}
        {u.photos.length > 0 && (
          <div className="floor-photos">
            {u.photos.map((url, i) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" aria-label={`Photo ${i + 1} of ${u.style} ${u.step}`}>
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links, not for the image optimiser */}
                <img src={url} alt="" loading="lazy" />
              </a>
            ))}
          </div>
        )}
      </div>
    </li>
  );
  return (
    <section className="panel scroll-mt-20" id="floor" aria-labelledby="floor-h">
      <div className="row mb-1">
        <h2 id="floor-h" className="font-bold text-base">From the factory floor</h2>
        {canPost && <VisitButton orderId={orderId} className="btn sm ml-auto">Post update</VisitButton>}
      </div>
      <p className="muted mb-2 text-[13px]">What Quality saw on its visits, newest first.</p>
      <ul className="floor-list">{updates.slice(0, 4).map(row)}</ul>
      {updates.length > 4 && (
        <details className="mt-1">
          <summary className="link cursor-pointer text-[13px]">{updates.length - 4} earlier {updates.length - 4 === 1 ? "update" : "updates"}</summary>
          <ul className="floor-list">{updates.slice(4).map(row)}</ul>
        </details>
      )}
    </section>
  );
}
