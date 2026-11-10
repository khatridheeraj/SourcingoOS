// What Sourcingo's Quality team found on the factory's styles: each check with its result, pieces checked, defects,
// what Quality wrote, and the photos and report. Newest first; the newest few show, the rest fold away.
import { dayNear as day, qty, TNA_STEPS } from "@/lib/format";
import { stepName, words, type Lang } from "./i18n";

export type FactoryCheck = {
  id: string; order_id: string; line_id: string; style: string; kind: string; checked_on: string; result: "pass" | "fail";
  pieces_checked: number | null; defects: number; notes: string | null;
  photos: string[]; reports: { name: string; url: string }[];
};

const SHOWN = 3;

export function FactoryQc({ checks, lang }: { checks: FactoryCheck[]; lang: Lang }) {
  const w = words(lang);
  if (!checks.length) return null;
  // A QC kind reads like its TNA step; "final" is the Final QC step, and a re-check has its own name.
  const name = (kind: string) => kind === "recheck" ? w.qcRecheck
    : stepName(lang, kind === "final" ? "final_qc" : kind, null, TNA_STEPS.find((t) => t.key === (kind === "final" ? "final_qc" : kind))?.label ?? kind);
  // A style whose newest Final QC or re-check failed has goods to fix before they can leave.
  const toFix = [...new Set(checks.filter((c) => c.kind === "final" || c.kind === "recheck").reduce<FactoryCheck[]>((acc, c) => {
    if (!acc.some((a) => a.line_id === c.line_id)) acc.push(c);
    return acc;
  }, []).filter((c) => c.result === "fail").map((c) => c.style))];

  const row = (c: FactoryCheck) => (
    <li key={c.id} className="fqc-row">
      <div className="fqc-id">
        <b><span className="code">{c.style}</span> · {name(c.kind)}</b>
        <span className={`chip ${c.result === "pass" ? "ok" : "bad"}`}>{c.result === "pass" ? w.qcPassed : w.qcFailed}</span>
      </div>
      <small className="fqc-meta num">
        {[day(c.checked_on), c.pieces_checked ? w.qcChecked(qty(c.pieces_checked)) : "", c.pieces_checked || c.defects ? w.qcDefects(c.defects) : ""].filter(Boolean).join(" · ")}
      </small>
      {c.notes && <q className="fsmp-note">{c.notes}</q>}
      {c.photos.length > 0 && (
        <div className="smp-photos">
          {c.photos.map((u, i) => (
            <a key={u} href={u} target="_blank" rel="noreferrer" aria-label={`${w.photo} ${i + 1}`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed links */}
              <img src={u} alt="" loading="lazy" />
            </a>
          ))}
        </div>
      )}
      {c.reports.map((r) => (
        <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="fqc-file">{w.qcReport}: {r.name}</a>
      ))}
    </li>
  );

  return (
    <div className="fsmp fqc">
      <div className="row">
        <h3 className="text-[14px] font-semibold">{w.qcTitle}</h3>
        <span className="fsmp-sum">{w.qcSum(checks.length)}</span>
      </div>
      {toFix.length > 0 && <p className="mt-1 text-[13px] font-semibold text-bad">{w.qcToFix(toFix.join(", "))}</p>}
      <ul className="fqc-list">{checks.slice(0, SHOWN).map(row)}</ul>
      {checks.length > SHOWN && (
        <details className="fqc-more">
          <summary>{w.qcEarlier(checks.length - SHOWN)}</summary>
          <ul className="fqc-list">{checks.slice(SHOWN).map(row)}</ul>
        </details>
      )}
    </div>
  );
}
