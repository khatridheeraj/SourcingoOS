import { PO_BUCKET, type StoredFile } from "@/lib/po-files";
import { readPos, type PoFile } from "@/lib/po-reader";
import { createAdminClient } from "@/lib/supabase/admin";

export { PO_BUCKET, PO_FILE_TYPES, PO_MAX_BYTES, type StoredFile } from "@/lib/po-files";

// Reads an incoming PO's files with AI and saves what it found. Never throws: a failure is saved on the row to show the team.
export async function readIncomingPo(id: string): Promise<void> {
  const admin = createAdminClient();
  try {
    const { data: row, error } = await admin.from("incoming_pos")
      .select("company_id, files, email_from, email_subject, email_body, source").eq("id", id).single();
    if (error || !row) throw new Error(error?.message ?? "Incoming PO not found.");
    await admin.from("incoming_pos").update({ status: "reading", read_error: null }).eq("id", id).in("status", ["receiving", "failed", "to_check", "reading"]);

    const files: PoFile[] = [];
    for (const f of (row.files ?? []) as StoredFile[]) {
      const { data, error: dl } = await admin.storage.from(PO_BUCKET).download(f.path);
      if (dl || !data) throw new Error(`Couldn't open ${f.name}.`);
      files.push({ name: f.name, type: f.type, bytes: new Uint8Array(await data.arrayBuffer()) });
    }
    const [{ data: buyers }, { data: names }] = await Promise.all([
      admin.from("buyers").select("id, code").eq("company_id", row.company_id).eq("active", true),
      admin.from("buyer_names").select("buyer_id, real_name").eq("company_id", row.company_id),
    ]);
    const nameOf = new Map((names ?? []).map((n) => [n.buyer_id as string, n.real_name as string]));
    const pos = await readPos(files,
      row.source === "email" ? { from: row.email_from, subject: row.email_subject, body: row.email_body } : null,
      (buyers ?? []).map((b) => ({ code: b.code, name: nameOf.get(b.id) ?? null })));
    const { error: save } = await admin.rpc("save_po_reading", { p_id: id, p_pos: pos, p_error: null });
    if (save) throw new Error(save.message);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The PO could not be read.";
    await admin.rpc("save_po_reading", { p_id: id, p_pos: null, p_error: message });
  }
}
