import { after } from "next/server";
import { readIncomingPo } from "@/lib/incoming";
import { createAdminClient } from "@/lib/supabase/admin";
import { companyForKey } from "../key";

// Reading a long PO can take a minute or two.
export const maxDuration = 300;

// Step 2 for the mailbox script: the attachments are uploaded, so read them. Answers at once; the reading runs after.
// Body: { key, id }
export async function POST(request: Request) {
  const admin = createAdminClient();
  const body = await request.json().catch(() => null);
  const company = await companyForKey(admin, body?.key);
  if (!company) return Response.json({ error: "Unknown mailbox key." }, { status: 401 });
  const { data: row } = await admin.from("incoming_pos").select("id, status").eq("id", String(body.id ?? "")).eq("company_id", company).maybeSingle();
  if (!row) return Response.json({ error: "No such email." }, { status: 404 });
  if (row.status === "receiving") {
    await admin.from("incoming_pos").update({ status: "reading" }).eq("id", row.id);
    after(() => readIncomingPo(row.id));
  }
  return Response.json({ ok: true });
}
