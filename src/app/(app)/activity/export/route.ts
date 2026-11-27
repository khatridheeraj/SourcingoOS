import { NextResponse, type NextRequest } from "next/server";
import { describe, type Entry, sourceLabel, tableLabel, when, who } from "@/lib/activity";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { type Cell, xlsx, XLSX_TYPE } from "@/lib/xlsx";
import { filterQuery, loadNames, queryActivity, readFilters } from "../query";

const BATCH = 1000;
const MAX = 50_000;

// The activity log as an Excel file, with the same filters as the screen. Owner only.
// Every cell is written as text or a number, never a formula, so text from outside (an emailed PO's subject) can't run in Excel.
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (me?.role !== "owner" || !me.companyId) return new NextResponse("Only the owner can download the activity log.", { status: 403 });
  const f = readFilters(Object.fromEntries(request.nextUrl.searchParams));
  const [names, supabase] = await Promise.all([loadNames(me.companyId), createClient()]);

  const entries: Entry[] = [];
  let capped = false;
  for (let before = 0; ;) {
    if (entries.length >= MAX) {
      // At the cap: check whether older entries remain, so the file can say it is cut short.
      const { data, error } = await queryActivity(supabase, me.companyId, f).lt("id", before).limit(1);
      capped = !!error || !!data?.length;
      break;
    }
    let q = queryActivity(supabase, me.companyId, f);
    if (before) q = q.lt("id", before);
    const { data, error } = await q.limit(BATCH);
    if (error) return new NextResponse(`Couldn't read the activity log: ${error.message}`, { status: 500 });
    entries.push(...(data as Entry[]));
    if (data.length < BATCH) break;
    before = data[data.length - 1].id;
  }

  const rows: Cell[][] = [["When (India time)", "Who", "Came from", "Area", "Record", "What", "Changes", "Entry no."]];
  for (const e of entries) {
    const d = describe(e, names);
    const detail = d.changes.length ? d.changes.map((c) => `${c.label}: ${c.from} → ${c.to}`) : d.fields.map((x) => `${x.label}: ${x.value}`);
    rows.push([when(e.at), who(e, names), sourceLabel(e) ?? "App", tableLabel(e.table_name), e.row_id, d.text, detail.join("; "), e.id]);
  }
  if (capped) rows.push([`Only the newest ${MAX.toLocaleString("en-IN")} entries are in this file. Narrow the dates or filters to download older ones.`]);
  const qs = filterQuery(f);
  return new NextResponse(Buffer.from(xlsx([{ name: "Activity log", rows, widths: [20, 18, 14, 16, 12, 40, 70, 10] }])), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="activity-log-${todayIST()}${qs ? "-filtered" : ""}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
