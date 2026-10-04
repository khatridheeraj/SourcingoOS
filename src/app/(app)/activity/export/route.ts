import { describe, type Entry, sourceLabel, tableLabel, who } from "@/lib/activity";
import { loadWorld } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { queryActivity, readFilters } from "../query";

const BATCH = 1000;
const MAX = 200_000;

// Excel-friendly CSV. Cells that look like formulas are neutralised.
function cell(v: string | number | null | undefined) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === "string") s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// The filtered activity log as a CSV the owner can keep or audit offline.
export async function GET(req: Request) {
  const { world: w, me } = await loadWorld();
  if (me?.role !== "owner") return new Response("Not allowed", { status: 403 });
  const f = readFilters(Object.fromEntries(new URL(req.url).searchParams));
  const supabase = await createClient();
  const rows: Entry[] = [];
  for (let before = 0; rows.length < MAX; ) {
    let q = queryActivity(supabase, f);
    if (before) q = q.lt("id", before);
    const { data, error } = await q.limit(BATCH);
    if (error) return new Response(`Couldn't read the activity log: ${error.message}`, { status: 500 });
    const page = (data ?? []) as unknown as Entry[];
    rows.push(...page);
    if (page.length < BATCH) break;
    before = page[page.length - 1].id;
  }
  await supabase.rpc("log_activity", { p_action: "EXPORT", p_table: "audit_log", p_row: "activity-log", p_note: new URL(req.url).search || null });

  const lines = [
    ["Entry", "When (IST)", "Who", "Role", "Source", "Action", "Area", "Record", "Summary", "Changed fields", "Before", "After"],
    ...rows.map((e) => {
      const d = describe(e, w);
      return [e.id, fmtDateTime(e.at), e.actor ? (e.actor_name ?? who(e, w)) : "", e.actor_role ?? "", sourceLabel(e.source), e.action,
        tableLabel(e.table_name), e.row_id ?? "", d.text + (d.changes.length ? ` (${d.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`).join("; ")})` : ""),
        (e.changed ?? []).join(", "), e.old_data ? JSON.stringify(e.old_data) : "", e.new_data ? JSON.stringify(e.new_data) : ""];
    }),
  ];
  const stamp = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  return new Response("﻿" + lines.map((r) => r.map(cell).join(",")).join("\r\n"), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="sourcingo-activity-log-${stamp}.csv"`, "cache-control": "no-store" },
  });
}
