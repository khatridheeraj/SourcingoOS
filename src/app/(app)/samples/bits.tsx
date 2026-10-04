import { fmtDay, isOpenSample, SAMPLE_LABEL, SAMPLE_TONE, type Sample, sampleDaysLeft, sampleOnTime, vendorLate } from "@/lib/model";

export function SampleChip({ s }: { s: Sample }) {
  return <span className={`chip ${SAMPLE_TONE[s.status]}`}>{SAMPLE_LABEL[s.status]}{s.round > 1 && ` · R${s.round}`}</span>;
}

// How the sample stands against the buyer's date: the first thing anyone looks at.
export function SampleDue({ s, today }: { s: Sample; today: string }) {
  if (isOpenSample(s)) {
    const d = sampleDaysLeft(s, today);
    if (d === null) return <span className="chip warn">No due date</span>;
    if (d < 0) return <span className="chip bad">{-d} day{d === -1 ? "" : "s"} late</span>;
    if (d === 0) return <span className="chip bad">Due today</span>;
    if (vendorLate(s, today)) return <span className="chip bad">Vendor late · {d}d left</span>;
    return <span className={`chip ${d <= 2 ? "warn" : ""}`}>{d} day{d === 1 ? "" : "s"} left</span>;
  }
  const ok = sampleOnTime(s);
  if (ok === null) return null;
  if (ok) return <span className="chip ok">On time</span>;
  const late = Math.round((Date.parse(s.dispatched_on!) - Date.parse(s.due_date!)) / 864e5);
  return <span className="chip bad">Sent {late} day{late === 1 ? "" : "s"} late</span>;
}

export function Thumb({ url, label }: { url?: string; label: string }) {
  return (
    <span className="file" style={{ border: 0, padding: 0, background: "none" }}>
      <span className="thumb" style={{ width: 44, height: 44 }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- signed storage links, not static assets */}
        {url ? <img src={url} alt="" loading="lazy" /> : <span aria-hidden="true">{label.slice(0, 2)}</span>}
      </span>
    </span>
  );
}

export const dueText = (s: Sample) => (s.due_date ? fmtDay(s.due_date) : "—");
