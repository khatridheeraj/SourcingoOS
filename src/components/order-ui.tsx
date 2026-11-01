import { dayNear } from "@/lib/format";
import { type Clock, STAGES, type StageKey, stageIndex } from "@/lib/journey";
import type { Forecast } from "@/lib/progress";

// The building blocks every order is drawn with, so an order looks the same on Home, in Orders and on its own page.

// Days to ship as one big number: the first thing anyone wants to know about an order.
export function ShipClock({ c, date, size = "lg" }: { c: Clock; date?: string; size?: "lg" | "sm" }) {
  return (
    <div className={`clock clock-${size} tone-${c.tone}`} role="group" aria-label={`${c.n === "–" || c.n === "✓" ? "" : `${c.n} `}${c.unit}${date ? `, ${date}` : ""}`}>
      {c.n !== "–" && c.n !== "✓" && <b className="num">{c.n}</b>}
      <span>{c.unit}</span>
      {date && <small>{date}</small>}
    </div>
  );
}

// Six short bars, one per stage from Factory to Ship: filled up to where the order is, the current one in its tone.
export function StageMeter({ stage, tone, label = true }: { stage: StageKey; tone: string; label?: boolean }) {
  const at = stageIndex(stage);
  const name = stage === "done" ? "Done" : STAGES.find((s) => s.key === stage)?.label ?? "";
  return (
    <span className={`meter tone-${tone}`} role="img" aria-label={`Stage: ${name}`}>
      <span className="meter-bars" aria-hidden>
        {STAGES.map((s, i) => <i key={s.key} data-state={i < at ? "done" : i === at ? "now" : "todo"} />)}
      </span>
      {label && <span className="meter-l" aria-hidden>{name}</span>}
    </span>
  );
}

// Up to four style photos overlapping, then "+N", so an order is recognised by its garments.
export function PhotoStack({ photos, total, size = 36 }: { photos: { url: string | null; alt: string }[]; total: number; size?: number }) {
  const shown = photos.slice(0, 4);
  return (
    <span className="pstack" style={{ ["--ps" as string]: `${size}px` }}>
      {shown.map((p, i) => p.url
        // eslint-disable-next-line @next/next/no-img-element
        ? <img key={i} src={p.url} alt={p.alt} loading="lazy" />
        : <span key={i} className="pstack-ph" title={p.alt} aria-label={p.alt}>{p.alt.slice(0, 2)}</span>)}
      {total > shown.length && <span className="pstack-more">+{total - shown.length}</span>}
    </span>
  );
}

// A ring that fills as work gets done.
export function Ring({ done, total, size = 56, children }: { done: number; total: number; size?: number; children?: React.ReactNode }) {
  const r = 15.5;
  const len = 2 * Math.PI * r;
  const f = total ? Math.min(1, done / total) : 0;
  return (
    <span className="pring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 36 36" aria-hidden>
        <circle cx="18" cy="18" r={r} className="pring-bg" />
        {f > 0 && <circle cx="18" cy="18" r={r} className="pring-fg" strokeDasharray={`${f * len} ${len}`} transform="rotate(-90 18 18)" />}
      </svg>
      <span className="pring-c">{children}</span>
    </span>
  );
}

const dm = (d: string) => dayNear(d);
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

// Where the order is heading, worked out from its steps and how its factory usually runs: the day it will likely be
// ready against the ship date, and the one reason when it slips. Red only when it will miss the ship date.
export function Outlook({ f, due, styles = 1 }: { f: Forecast; due: string | null; styles?: number }) {
  const spare = due ? Math.round((Date.parse(due) - Date.parse(f.finish)) / 86_400_000) : 0;
  const late = f.daysLate > 0;
  const head = late ? `Likely ready ${dm(f.finish)}, ${days(f.daysLate)} after the ship date`
    : `On course: likely ready ${dm(f.finish)}${spare > 0 ? `, ${days(spare)} to spare` : ", just in time"}`;
  const reason = f.why && `${!late && f.slip ? `${days(f.slip)} behind plan. ` : ""}${f.why}${styles > 1 && f.style ? ` on ${f.style}` : ""}.`;
  return (
    <p className={`outlook ${late ? "tone-bad" : ""}`}>
      <b>{head}</b>
      {reason && <span>{reason}</span>}
    </p>
  );
}
