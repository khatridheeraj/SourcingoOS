import { Attachments } from "@/components/attachments";
import { Chip } from "@/components/bits";
import { CheckpointSelect, StyleNote } from "@/components/order-actions";
import { CATEGORIES_FOR, type FileItem } from "@/lib/file-kinds";
import { fmtDateTime } from "@/lib/format";
import { fmtDay, money, nf, type Order, overdue, SIZES, unitOf, type World } from "@/lib/model";

// One card per style with its TNA checkpoints; status is editable once locked.
export function TnaStyles({ w, o, canEdit, files }: { w: World; o: Order; canEdit: boolean; files: Map<string, FileItem[]> }) {
  const live = o.status === "locked";
  return o.styles.map((st) => (
    <article key={st.id} className="style-card">
      <div className="style-head">
        <h3>{st.name || "Unnamed style"} <span className="font-normal text-muted">({st.colour || "—"})</span></h3>
        <span className="code text-muted">{st.code}</span>
      </div>
      <div className="style-body">
        <div className="meta">
          <span>Fabric <b>{st.fabric || "—"}</b></span>
          <span>
            Qty <b className="num">{nf(st.qty)} {unitOf(o)}</b>
            {st.use_sizes && o.order_type === "garment" && ` (${SIZES.filter((z) => Number(st.sizes?.[z])).map((z) => `${z} ${st.sizes[z]}`).join(", ")})`}
          </span>
          <span>Rate <b className="num">{money(st.buyer_rate, o.currency)}</b></span>
          <span>Value <b className="num">{money(st.qty * st.buyer_rate, o.currency)}</b></span>
          {st.factory_rate != null && <span>Factory rate <b className="num">{money(st.factory_rate, o.currency)}</b></span>}
        </div>
        {st.checkpoints.length ? (
          <div className="table-wrap">
            <table className="tbl">
              <thead><tr><th>#</th><th>Activity</th><th>Due</th><th>Status</th><th>Last update</th></tr></thead>
              <tbody>
                {st.checkpoints.map((cp, j) => (
                  <tr key={cp.id}>
                    <td className="code text-muted">{j + 1}</td>
                    <td><b>{cp.name}</b></td>
                    <td className="num whitespace-nowrap">{fmtDay(cp.due_date)} {overdue(cp, w.today) && live && <Chip status="overdue" />}</td>
                    <td>{canEdit && live ? <CheckpointSelect id={cp.id} value={cp.status} label={cp.name} /> : <Chip status={cp.status} />}</td>
                    <td className="text-xs text-muted">
                      {cp.status_updated_at ? `${fmtDateTime(cp.status_updated_at)} · ${w.personName(cp.status_updated_by)}` : "—"}
                      {cp.status_note && <span className={`block ${cp.status === "delayed" ? "text-bad" : "text-foreground"}`}>“{cp.status_note}”</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-muted">No checkpoints.</p>
        )}
        <Attachments target="style" id={st.id} files={files.get(st.id) ?? []} upload={canEdit ? CATEGORIES_FOR.style : []} canDeleteAll={canEdit}
          title="Tech pack, cutting program & photos" hint="The factory sees tech packs, cutting programs, photos and QC reports. “Other” stays internal." />
        {canEdit ? <StyleNote id={st.id} note={st.internal_note ?? ""} /> : st.internal_note && <p className="text-[12.5px]"><b>Internal note:</b> {st.internal_note}</p>}
      </div>
    </article>
  ));
}
