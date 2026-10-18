import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";
import { encodeHex } from "jsr:@std/encoding@1/hex";
import { readPos, type PoFile } from "./reader.ts";

// Buyer PO pickup, running on Supabase so it can use the service role without any key kept in the app.
//   {action: "receive", key, email, files}  the Gmail script hands over one email; answers with upload links.
//   {action: "ready", key, id}              the script has uploaded the files; reading starts.
//   {action: "read", id}                    the orders team (signed in) added a file or asked to read again.
//   {action: "brief", google_token}         the Gmail script's 9 am brief: that person's brief data, for the app to word.
// The Gmail script proves itself with a mailbox key, or with google_token: the mailbox's own Google sign-in,
// so the script holds no secret. A Google mailbox is registered as the key "google:<address>".
// Reading runs after the answer is sent and saves its result, or its error, on the incoming PO.

const PO_BUCKET = "po-files";
const PO_FILE_TYPES: Record<string, string> = {
  pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", csv: "text/csv",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};
const PO_MAX_BYTES = 25 * 1024 * 1024;
type StoredFile = { path: string; name: string; type: string; size: number };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// The mailbox key a request proves: its Google sign-in, checked with Google, or a plain key.
async function mailboxKey(body: Record<string, unknown>): Promise<string | null> {
  if (typeof body.google_token === "string" && body.google_token) {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(body.google_token)}`);
    if (!res.ok) return null;
    const info = await res.json() as { email?: string; email_verified?: string | boolean; scope?: string };
    if (!info.email || String(info.email_verified) !== "true") return null;
    // Only a token from an Apps Script that fetches URLs counts: any other app the person signed in to with Google
    // also gets a token naming their address, and must not be able to replay it here.
    if (!(info.scope ?? "").split(" ").includes("https://www.googleapis.com/auth/script.external_request")) return null;
    return `google:${info.email.toLowerCase()}`;
  }
  return typeof body.key === "string" && !body.key.startsWith("google:") ? body.key : null;
}

// The company a mailbox script's key belongs to, or null for an unknown key.
async function companyForKey(db: SupabaseClient, key: unknown): Promise<string | null> {
  if (typeof key !== "string" || key.length < 20) return null;
  const hash = encodeHex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key))));
  const { data } = await db.from("inbound_keys").select("company_id").eq("key_hash", hash).maybeSingle();
  return (data?.company_id as string | undefined) ?? null;
}

// Reads an incoming PO's files with AI and saves what it found. Never throws: a failure is saved on the row to show the team.
async function readIncomingPo(db: SupabaseClient, id: string): Promise<void> {
  try {
    const { data: row, error } = await db.from("incoming_pos")
      .select("company_id, files, email_from, email_subject, email_body, source").eq("id", id).single();
    if (error || !row) throw new Error(error?.message ?? "Incoming PO not found.");
    await db.from("incoming_pos").update({ status: "reading", read_error: null }).eq("id", id).in("status", ["receiving", "failed", "to_check", "reading"]);

    const files: PoFile[] = [];
    for (const f of (row.files ?? []) as StoredFile[]) {
      const { data, error: dl } = await db.storage.from(PO_BUCKET).download(f.path);
      if (dl || !data) throw new Error(`Couldn't open ${f.name}.`);
      files.push({ name: f.name, type: f.type, bytes: new Uint8Array(await data.arrayBuffer()) });
    }
    const [{ data: buyers }, { data: names }, { data: key }] = await Promise.all([
      db.from("buyers").select("id, code").eq("company_id", row.company_id).eq("active", true),
      db.from("buyer_names").select("buyer_id, real_name").eq("company_id", row.company_id),
      db.rpc("get_ai_key", { p_company: row.company_id }),
    ]);
    const nameOf = new Map((names ?? []).map((n) => [n.buyer_id as string, n.real_name as string]));
    const pos = await readPos((key as string | null) ?? null, files,
      row.source === "email" ? { from: row.email_from, subject: row.email_subject, body: row.email_body } : null,
      (buyers ?? []).map((b) => ({ code: b.code as string, name: nameOf.get(b.id as string) ?? null })));
    const { error: save } = await db.rpc("save_po_reading", { p_id: id, p_pos: pos, p_error: null });
    if (save) throw new Error(save.message);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The PO could not be read.";
    await db.rpc("save_po_reading", { p_id: id, p_pos: null, p_error: message });
  }
}

// Keeps the reading going after the answer is sent.
function inBackground(work: Promise<void>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt) rt.waitUntil(work);
}

async function receive(db: SupabaseClient, body: Record<string, unknown>) {
  const key = await mailboxKey(body);
  const company = await companyForKey(db, key);
  if (!company) return json({ error: "Unknown mailbox key." }, 401);
  const files = (Array.isArray(body.files) ? body.files : []) as { name?: unknown; size?: unknown }[];
  const wanted = files.flatMap((f) => {
    const name = typeof f.name === "string" ? f.name.slice(0, 200) : "";
    const ext = name.split(".").pop()?.toLowerCase() ?? "";
    const size = Number(f.size) || 0;
    return PO_FILE_TYPES[ext] && size > 0 && size <= PO_MAX_BYTES ? [{ name, ext, type: PO_FILE_TYPES[ext], size }] : [];
  });
  if (!wanted.length) return json({ skipped: "No PO files in this email." });

  const { data: id, error } = await db.rpc("receive_email_po", { p_key: key, p_email: body.email ?? {} });
  if (error) return json({ error: error.message }, 400);
  if (!id) return json({ duplicate: true });

  const stored: StoredFile[] = [];
  const uploads: { name: string; url: string; type: string }[] = [];
  for (const f of wanted) {
    const path = `${company}/${id}/${crypto.randomUUID()}.${f.ext}`;
    const { data, error: sign } = await db.storage.from(PO_BUCKET).createSignedUploadUrl(path);
    if (sign || !data) return json({ error: sign?.message ?? "Couldn't prepare the upload." }, 500);
    stored.push({ path, name: f.name, type: f.type, size: f.size });
    uploads.push({ name: f.name, url: data.signedUrl, type: f.type });
  }
  await db.from("incoming_pos").update({ files: stored }).eq("id", id);
  return json({ id, uploads });
}

async function ready(db: SupabaseClient, body: Record<string, unknown>) {
  const company = await companyForKey(db, await mailboxKey(body));
  if (!company) return json({ error: "Unknown mailbox key." }, 401);
  const { data: row } = await db.from("incoming_pos").select("id, status").eq("id", String(body.id ?? "")).eq("company_id", company).maybeSingle();
  if (!row) return json({ error: "No such email." }, 404);
  if (row.status === "receiving") {
    await db.from("incoming_pos").update({ status: "reading" }).eq("id", row.id);
    inBackground(readIncomingPo(db, row.id));
  }
  return json({ ok: true });
}

// A signed-in person asks for a read: their own access decides whether they can see this PO.
async function read(db: SupabaseClient, body: Record<string, unknown>, auth: string | null) {
  if (!auth) return json({ error: "Sign in first." }, 401);
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false }, global: { headers: { Authorization: auth } },
  });
  const { data: row } = await asUser.from("incoming_pos").select("id, status").eq("id", String(body.id ?? "")).maybeSingle();
  if (!row) return json({ error: "This PO is no longer here. Reload the page." }, 404);
  if (row.status === "added") return json({ error: "This PO is already added as an order." }, 400);
  // An email from an unknown sender is read only once the owner accepts it.
  if (row.status === "held") return json({ error: "Accept or ignore this sender first." }, 400);
  const { data: canRead } = await asUser.rpc("ai_key_status");
  if (!canRead) return json({ error: "Only the orders team can do this." }, 403);
  await db.from("incoming_pos").update({ status: "reading", read_error: null }).eq("id", row.id);
  inBackground(readIncomingPo(db, row.id));
  return json({ ok: true });
}

// The morning brief for the person whose mailbox asks. Only a registered Google mailbox gets one, and only its own.
async function brief(db: SupabaseClient, body: Record<string, unknown>) {
  if (typeof body.google_token !== "string") return json({ error: "Send the mailbox's Google sign-in." }, 401);
  const key = await mailboxKey(body);
  if (!key?.startsWith("google:") || !(await companyForKey(db, key))) return json({ error: "Unknown mailbox." }, 401);
  const { data, error } = await db.rpc("brief_data_for_email", { p_email: key.slice("google:".length) });
  if (error) return json({ error: error.message }, 400);
  return json(data);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "Send JSON." }, 400);
  const db = admin();
  if (body.action === "receive") return receive(db, body);
  if (body.action === "ready") return ready(db, body);
  if (body.action === "read") return read(db, body, req.headers.get("authorization"));
  if (body.action === "brief") return brief(db, body);
  return json({ error: "Unknown action." }, 400);
});
