import { fmtDay, type FpoLine, money, nf, SIZES } from "@/lib/model";

// The lines of a factory PO: what to make, at what rate, by when.
export function FpoLines({ lines, currency, unit }: { lines: FpoLine[]; currency: string; unit: string }) {
  return (
    <div className="table-wrap">
      <table className="tbl">
        <thead><tr><th>#</th><th>Style</th><th>Fabric · colour</th><th>Qty</th><th>Rate</th><th>Value</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={l.style_id}>
              <td className="code text-muted">{i + 1}</td>
              <td><b>{l.name}</b><br /><span className="code text-muted">{l.code}</span></td>
              <td>{l.fabric}<br /><span className="text-muted">{l.colour}</span></td>
              <td className="num whitespace-nowrap">
                {nf(l.qty)} {unit}
                {l.use_sizes && <span className="block text-xs text-muted">{SIZES.filter((z) => Number(l.sizes?.[z])).map((z) => `${z} ${l.sizes[z]}`).join(", ")}</span>}
              </td>
              <td className="num whitespace-nowrap">{l.rate != null ? money(l.rate, currency) : <span className="text-warn">Not set</span>}</td>
              <td className="num whitespace-nowrap">{l.rate != null ? money(l.rate * l.qty, currency) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Step dates per style, compact: "Cutting 12 Oct · Sewing 20 Oct".
export function FpoSchedule({ lines }: { lines: FpoLine[] }) {
  const same = lines.every((l) => JSON.stringify(l.steps) === JSON.stringify(lines[0]?.steps));
  const rows = same ? lines.slice(0, 1) : lines;
  if (!rows.some((l) => l.steps.length)) return <p className="text-sm text-muted">No TNA dates on this PO.</p>;
  return (
    <div className="stack" style={{ gap: 8 }}>
      {rows.map((l) => (
        <div key={l.style_id}>
          {!same && <div className="sub mb-1">{l.name} ({l.colour})</div>}
          <div className="row" style={{ gap: 6 }}>
            {l.steps.map((s, i) => <span key={i} className="chip">{s.name} · {fmtDay(s.due_date)}</span>)}
          </div>
        </div>
      ))}
    </div>
  );
}
