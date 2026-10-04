import "./activity.css";
import Link from "next/link";
import { describe, type Entry, groupEntries, hrefFor, sourceLabel, who } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import type { World } from "@/lib/model";

const MAX_INLINE = 5;

// Entries newest first, one card per save. `linkRecords` adds a link from
// each line to the screen of the record it changed (used on the Activity screen).
export function ActivityList({ entries, w, linkRecords, byDay }: { entries: Entry[]; w: World; linkRecords?: boolean; byDay?: boolean }) {
  const groups = groupEntries(entries);
  const days = groups.map((g) => new Date(g.at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }));
  return (
    <ol className="acts">
      {groups.map((g, n) => {
        const first = g.entries[0];
        const d = days[n];
        const newDay = byDay && d !== days[n - 1];
        return (
          <li key={g.key} style={newDay ? { borderTop: 0 } : undefined}>
            {newDay ? <div className="acts-day" style={{ gridColumn: "1 / -1" }}>{d}</div> : null}
            <i className={`dot ${first.action}`} aria-hidden />
            <div className="min-w-0">
              <div className="who">
                <b>{who(first, w)}</b>
                <time dateTime={g.at} title={new Date(g.at).toISOString()}>{fmtDateTime(g.at)}</time>
                {first.actor && first.source && first.source !== "app" && <span className="src">{sourceLabel(first.source)}</span>}
              </div>
              <ul className="lines">
                {g.entries.map((e) => <Line key={e.id} e={e} w={w} link={linkRecords} />)}
              </ul>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Line({ e, w, link }: { e: Entry; w: World; link?: boolean }) {
  const d = describe(e, w);
  const href = link ? hrefFor(e) : null;
  const shown = d.changes.slice(0, MAX_INLINE);
  return (
    <li>
      {href ? <Link href={href}>{d.text}</Link> : d.text}
      {shown.length > 0 && (
        <ul className="chg">
          {shown.map((c) => (
            <li key={c.field}>
              <span>{c.label}:</span>
              {c.from === "empty" ? null : <><s>{c.from}</s> →</>}
              <ins>{c.to === "empty" ? "cleared" : c.to}</ins>
            </li>
          ))}
        </ul>
      )}
      {d.fields.length > 0 || d.changes.length > MAX_INLINE ? (
        <details>
          <summary>{d.changes.length > MAX_INLINE ? `${d.changes.length - MAX_INLINE} more changes and full record` : e.action === "DELETE" ? "What was deleted" : "Full record"}</summary>
          {d.changes.length > MAX_INLINE && (
            <ul className="chg">
              {d.changes.slice(MAX_INLINE).map((c) => (
                <li key={c.field}><span>{c.label}:</span>{c.from === "empty" ? null : <><s>{c.from}</s> →</>}<ins>{c.to === "empty" ? "cleared" : c.to}</ins></li>
              ))}
            </ul>
          )}
          <div className="all">
            {d.fields.map((f) => <div key={f.label} style={{ display: "contents" }}><span>{f.label}</span><b>{f.value}</b></div>)}
          </div>
        </details>
      ) : null}
    </li>
  );
}
