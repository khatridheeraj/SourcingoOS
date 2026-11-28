import { NextResponse, type NextRequest } from "next/server";
import { can, getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { xlsx, XLSX_TYPE } from "@/lib/xlsx";
import { EXPORTS, exportSheets, type ExportKey } from "../exports";

// One Excel file: ?what=orders for one sheet, or everything this person may download.
export async function GET(request: NextRequest) {
  const me = await getMe();
  if (!me?.companyId || !can(me, "export")) return new NextResponse("Ask the owner to switch on Download data for you on the Team page.", { status: 403 });
  const what = request.nextUrl.searchParams.get("what");
  const allowed = EXPORTS.filter((e) => (!e.money || can(me, "money")) && (!e.buyers || can(me, "buyers")));
  const keys = (what ? allowed.filter((e) => e.key === what) : allowed).map((e) => e.key as ExportKey);
  if (!keys.length) return new NextResponse("There is no such download.", { status: 404 });
  const { sheets, error } = await exportSheets(me, keys);
  if (error) return new NextResponse(`Couldn't read everything for the download: ${error}`, { status: 500 });
  const name = what ? EXPORTS.find((e) => e.key === what)!.label.toLowerCase().replace(/\W+/g, "-") : "sourcingo-data";
  return new NextResponse(Buffer.from(xlsx(sheets)), {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${name}-${todayIST()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
