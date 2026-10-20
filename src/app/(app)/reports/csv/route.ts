import { canEditOrders, getMe } from "@/lib/auth";
import { loadBuyers, loadFactories } from "@/lib/data";
import { todayIST } from "@/lib/format";
import { addDays } from "@/lib/payments";
import { buildReport, RANGES, reportCsv } from "@/lib/reports";
import { createClient } from "@/lib/supabase/server";

// The factory scorecard for the chosen range, as a CSV file for Excel.
export async function GET(request: Request) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) return new Response("Only the orders team can download reports.", { status: 403 });
  const range = RANGES.find((r) => r.key === new URL(request.url).searchParams.get("range")) ?? RANGES[1];
  const today = todayIST();
  const supabase = await createClient();
  const [buyers, factories] = await Promise.all([loadBuyers(), loadFactories()]);
  const r = await buildReport(supabase, me.companyId, addDays(today, -range.days), today, buyers, factories);
  return new Response("﻿" + reportCsv(r), {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="factory-scorecard-${range.key}d-${today}.csv"` },
  });
}
