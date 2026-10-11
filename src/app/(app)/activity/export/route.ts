import { NextResponse, type NextRequest } from "next/server";
import { describe, type Entry, sourceLabel, tableLabel, when, who } from "@/lib/activity";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { filterQuery, loadNames, queryActivity, readFilters } from "../query";

const BATCH = 1000;
const MAX = 50_000;
const cell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

// The activity log as a spreadsheet, with the same filters as the screen. Owner only.
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (me?.role !== "owner" || !me.companyId) return new NextResponse("Only the owner can download the activity log.", { status: 403 });
  const f = readFilters(Object.fromEntries(request.nextUrl.searchParams));
  const [names, supabase] = await Promise.all([loadNames(me.companyId), createClient()]);

  const entries: Entry[] = [];
  for (let before = 0; entries.length < MAX;) {
    let q = queryActivity(supabase, me.companyId, f);
    if (before) q = q.lt("id", before);
    const { data, error } = await q.limit(BATCH);
    if (error) return new NextResponse(`Couldn't read the activity log: ${error.message}`, { status: 500 });
    entries.push(...(data as Entry[]));
    if (data.length < BATCH) break;
    before = data[data.length - 1].id;
  }

  const lines = [["When (India time)", "Who", "Came from", "Area", "Record", "What", "Changes", "Entry no."].join(",")];
  for (const e of entries) {
    const d = describe(e, names);
    const detail = d.changes.length ? d.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`) : d.fields.map((x) => `${x.label}: ${x.value}`);
    lines.push([when(e.at), who(e, names), sourceLabel(e) ?? "App", tableLabel(e.table_name), e.row_id, d.text, detail.join("; "), String(e.id)].map(cell).join(","));
  }
  const qs = filterQuery(f);
  return new NextResponse(`﻿${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="activity-log-${todayIST()}${qs ? "-filtered" : ""}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
