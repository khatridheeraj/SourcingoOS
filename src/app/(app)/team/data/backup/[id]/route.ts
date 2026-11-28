import { NextResponse, type NextRequest } from "next/server";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// One night's backup for the owner: a link to the file that works for five minutes.
export async function GET(_req: NextRequest, ctx: RouteContext<"/team/data/backup/[id]">) {
  const me = await getMe();
  if (me?.role !== "owner") return new NextResponse("Only the owner can download backups.", { status: 403 });
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data } = await supabase.rpc("backup_list");
  const row = ((data ?? []) as { id: number; file: string | null }[]).find((b) => String(b.id) === id);
  if (!row?.file) return new NextResponse("That backup isn't kept any more.", { status: 404 });
  const { data: link, error } = await supabase.storage.from("backups").createSignedUrl(row.file, 300, { download: `sourcingo-backup-${row.file}` });
  if (error || !link) return new NextResponse(`Couldn't open the backup: ${error?.message ?? "no link"}`, { status: 500 });
  return NextResponse.redirect(link.signedUrl);
}
