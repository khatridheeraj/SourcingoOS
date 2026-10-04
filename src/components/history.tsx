import Link from "next/link";
import { ActivityList } from "@/components/activity-list";
import { ENTRY_COLUMNS, type Entry, who } from "@/lib/activity";
import { fmtDateTime } from "@/lib/format";
import type { World } from "@/lib/model";
import { createClient } from "@/lib/supabase/server";

// Everything that ever happened to a record and the rows that belong to it,
// from the permanent activity log. Each reader sees only what their access allows.
export async function History({ table, id, w, open }: { table: string; id: string; w: World; open?: boolean }) {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_history", { p_table: table, p_id: id, p_limit: 500 }).select(ENTRY_COLUMNS);
  const entries = (data ?? []) as unknown as Entry[];
  const last = entries[0];
  return (
    <details className="panel" open={open}>
      <summary>
        History
        <span className="font-normal">
          {last ? ` · ${entries.length >= 500 ? "500+" : entries.length} change${entries.length === 1 ? "" : "s"} · last ${fmtDateTime(last.at)} by ${who(last, w)}` : " · nothing recorded yet"}
        </span>
      </summary>
      {error && <p className="errbox mt-3">Couldn&apos;t load the history: {error.message}</p>}
      {entries.length > 0 && <div className="mt-3"><ActivityList entries={entries} w={w} /></div>}
      {entries.length >= 500 && (
        <p className="mt-2 text-xs text-muted">Showing the latest 500. <Link className="link" href={`/history/${table}/${encodeURIComponent(id)}`}>See everything</Link></p>
      )}
    </details>
  );
}
