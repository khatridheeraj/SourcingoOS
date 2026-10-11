import { PO_BUCKET, PO_FILE_TYPES, PO_MAX_BYTES, type StoredFile } from "@/lib/incoming";
import { createAdminClient } from "@/lib/supabase/admin";
import { companyForKey } from "./key";

// Step 1 for the mailbox script: hand over one email's details and get a place to upload each attachment.
// Body: { key, email: { email_id, from, subject, body, received_at }, files: [{ name, type, size }] }
export async function POST(request: Request) {
  const admin = createAdminClient();
  const body = await request.json().catch(() => null);
  const company = await companyForKey(admin, body?.key);
  if (!company) return Response.json({ error: "Unknown mailbox key." }, { status: 401 });

  const files = (Array.isArray(body.files) ? body.files : []) as { name?: unknown; size?: unknown }[];
  const wanted = files.flatMap((f) => {
    const name = typeof f.name === "string" ? f.name.slice(0, 200) : "";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const size = Number(f.size) || 0;
    return PO_FILE_TYPES[ext] && size > 0 && size <= PO_MAX_BYTES ? [{ name, ext, type: PO_FILE_TYPES[ext], size }] : [];
  });
  if (!wanted.length) return Response.json({ skipped: "No PO files in this email." });

  const { data: id, error } = await admin.rpc("receive_email_po", { p_key: body.key, p_email: body.email ?? {} });
  if (error) return Response.json({ error: error.message }, { status: 400 });
  if (!id) return Response.json({ duplicate: true });

  const stored: StoredFile[] = [];
  const uploads: { name: string; url: string; type: string }[] = [];
  for (const f of wanted) {
    const path = `${company}/${id}/${crypto.randomUUID()}.${f.ext}`;
    const { data, error: sign } = await admin.storage.from(PO_BUCKET).createSignedUploadUrl(path);
    if (sign || !data) return Response.json({ error: sign?.message ?? "Couldn't prepare the upload." }, { status: 500 });
    stored.push({ path, name: f.name, type: f.type, size: f.size });
    uploads.push({ name: f.name, url: data.signedUrl, type: f.type });
  }
  await admin.from("incoming_pos").update({ files: stored }).eq("id", id);
  return Response.json({ id, uploads });
}
