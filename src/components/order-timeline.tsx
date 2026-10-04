import { fmtDateTime } from "@/lib/format";
import { delayLabel, FPO_LABEL, type FpoStatus, GRN_LABEL, type GrnStatus, QC_KIND_LABEL, QC_RESULT_LABEL, type QcKind, type QcResult, SO_LABEL, type SoStatus, TNA_LABEL, type TnaStatus, type World } from "@/lib/model";
import { createClient } from "@/lib/supabase/server";

type Row = { at: string; actor: string | null; source: string; action: string; row_id: string; old_data: Record<string, unknown> | null; new_data: Record<string, unknown> | null };

// One line per event, in plain words.
function describe(r: Row): string | null {
  const n = (r.new_data ?? {}) as Record<string, string>;
  const o = (r.old_data ?? {}) as Record<string, string>;
  switch (r.source) {
    case "sales_orders":
      if (r.action === "INSERT") return "Sales order created";
      if (o.status !== n.status) return `Status: ${SO_LABEL[o.status as SoStatus] ?? o.status} → ${SO_LABEL[n.status as SoStatus] ?? n.status}`;
      if (o.remarks !== n.remarks && n.remarks) return `Status remarks: “${String(n.remarks).split("\n").pop()}”`;
      if (o.merch_date !== n.merch_date) return `Merchandiser predicted date changed to ${n.merch_date ?? "none"}`;
      if (o.factory_id !== n.factory_id) return "Factory set";
      if (o.merchandiser_id !== n.merchandiser_id || o.manager_id !== n.manager_id) return "People on the order changed";
      return null;
    case "so_styles":
      return r.action === "INSERT" ? `Style added: ${n.name || "unnamed"} (${n.colour || "—"})` : `Style removed: ${o.name || "unnamed"} (${o.colour || "—"})`;
    case "grns":
      if (r.action === "INSERT") return `${n.id} started (goods received)`;
      if (r.action === "DELETE") return `${o.id} deleted`;
      return `${n.id}: ${GRN_LABEL[n.status as GrnStatus] ?? n.status}`;
    case "delivery_challans":
      if (r.action === "INSERT") return `${n.id} started`;
      if (r.action === "DELETE") return `${o.id} deleted`;
      return n.status === "dispatched" ? `${n.id} dispatched${n.courier ? ` by ${n.courier}` : ""}` : `${n.id} updated`;
    case "factory_pos":
      if (r.action === "INSERT") return `${n.id} sent to the factory${Number(n.revision) > 1 ? ` (revision ${n.revision})` : ""}`;
      return `${n.id}: ${FPO_LABEL[n.status as FpoStatus] ?? n.status}${n.response_note && o.status === "issued" ? ` · “${n.response_note}”` : ""}`;
    case "qc_inspections": {
      const d = r.action === "DELETE" ? o : n;
      if (r.action === "DELETE") return `${d.id} deleted`;
      return `${QC_KIND_LABEL[d.kind as QcKind]} QC ${r.action === "INSERT" ? "" : "updated "}· ${QC_RESULT_LABEL[d.result as QcResult]} (${d.critical}/${d.major}/${d.minor})`;
    }
    case "tna_status_history":
      return `${n.name} · ${n.style}${n.colour ? ` (${n.colour})` : ""}: ${TNA_LABEL[o.status as TnaStatus] ?? "—"} → ${TNA_LABEL[n.status as TnaStatus]}${n.delay_reason ? ` · ${delayLabel(n.delay_reason)}` : ""}${n.note ? ` · “${n.note}”` : ""}`;
  }
  return null;
}

export async function OrderTimeline({ soId, w }: { soId: string; w: World }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("order_timeline", { p_so: soId });
  const rows = ((data ?? []) as Row[]).map((r) => ({ r, text: describe(r) })).filter((x) => x.text);
  return (
    <details className="panel" open={rows.length > 0 && rows.length <= 8}>
      <summary>History ({rows.length})</summary>
      {error && <p className="errbox mt-2">{error.message}</p>}
      {rows.length ? (
        <ol className="hist mt-3">
          {rows.map(({ r, text }, i) => (
            <li key={i}>
              <time>{fmtDateTime(r.at)} · {w.personName(r.actor)}</time>
              {text}
            </li>
          ))}
        </ol>
      ) : <p className="mt-2 text-sm text-muted">Nothing recorded yet.</p>}
    </details>
  );
}
