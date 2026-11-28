import { createClient } from "npm:@supabase/supabase-js@2.49.4";

// The nightly backup. pg_cron calls it at 2:20 am India time with the key from the vault (migration 0119).
// It writes every public table into one gzipped file, backups/<date>.ndjson.gz, where each line is
// {"table": "...", "row": {...}}, logs the run in public.backups and clears files older than 14 nights.
// Every call also clears the files of emails set aside as "Not a PO" more than a week ago (clearAside).
// A second call within 20 hours does nothing, so a repeat can't fill the storage.

const BUCKET = "backups";
const KEEP = 14;
const PAGE = 1000;
const ASIDE_DAYS = 7;

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

// Files of emails set aside as "Not a PO" more than a week ago go: each is a copy of a Gmail attachment that
// stays in Gmail, and they were filling the free 1 GB (1.1 GB by 28 Nov 2026). The last week stays, so
// "Put it back" still works on anything set aside by mistake. Runs on every call, before the once-a-day check.
async function clearAside(db: ReturnType<typeof admin>): Promise<number> {
  const { data: aside } = await db.from("incoming_pos").select("files").eq("status", "not_po")
    .lt("closed_at", new Date(Date.now() - ASIDE_DAYS * 86400e3).toISOString()).order("closed_at", { ascending: false }).limit(2000);
  const paths = (aside ?? []).flatMap((r) => ((r.files ?? []) as { path?: string }[]).map((f) => f.path ?? "")).filter(Boolean);
  for (let i = 0; i < paths.length; i += 500) await db.storage.from("po-files").remove(paths.slice(i, i + 500));
  return paths.length;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Use POST.", { status: 405 });
  const db = admin();
  const { data: ok } = await db.rpc("backup_key_ok", { p_key: req.headers.get("x-backup-key") ?? "" });
  if (!ok) return Response.json({ error: "Not allowed." }, { status: 403 });
  const cleared = await clearAside(db).catch(() => 0);

  const since = new Date(Date.now() - 20 * 3600e3).toISOString();
  const { data: recent } = await db.from("backups").select("id").is("error", null).not("finished_at", "is", null).gte("started_at", since).limit(1);
  if (recent?.length) return Response.json({ skipped: "A backup already ran in the last 20 hours.", cleared });

  const { data: company } = await db.from("companies").select("id").order("created_at").limit(1).single();
  const { data: run, error: runErr } = await db.from("backups").insert({ company_id: company!.id }).select("id").single();
  if (runErr) return Response.json({ error: runErr.message }, { status: 500 });

  try {
    const { data: tables, error: tErr } = await db.rpc("backup_tables");
    if (tErr) throw tErr;
    const enc = new TextEncoder();
    const chunks: Uint8Array[] = [];
    let rows = 0;
    chunks.push(enc.encode(JSON.stringify({ backup: "sourcingo", at: new Date().toISOString(), tables }) + "\n"));
    for (const table of tables as string[]) {
      for (let offset = 0; ; offset += PAGE) {
        const { data, error } = await db.rpc("backup_page", { p_table: table, p_offset: offset, p_limit: PAGE });
        if (error) throw new Error(`${table}: ${error.message}`);
        const page = data as unknown[];
        if (page.length) chunks.push(enc.encode(page.map((row) => JSON.stringify({ table, row })).join("\n") + "\n"));
        rows += page.length;
        if (page.length < PAGE) break;
      }
    }
    const gz = await new Response(new Blob(chunks).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
    const day = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const file = `${day}-${run.id}.ndjson.gz`;
    const { error: upErr } = await db.storage.from(BUCKET).upload(file, gz, { contentType: "application/gzip", upsert: true });
    if (upErr) throw upErr;
    await db.from("backups").update({ finished_at: new Date().toISOString(), file, bytes: gz.byteLength, tables: (tables as string[]).length, rows }).eq("id", run.id);

    // Keep the newest KEEP files.
    const { data: old } = await db.from("backups").select("id, file").not("file", "is", null).is("removed_at", null)
      .order("started_at", { ascending: false }).range(KEEP, KEEP + 50);
    if (old?.length) {
      await db.storage.from(BUCKET).remove(old.map((o) => o.file as string));
      await db.from("backups").update({ removed_at: new Date().toISOString() }).in("id", old.map((o) => o.id));
    }
    return Response.json({ file, bytes: gz.byteLength, rows, cleared });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await db.from("backups").update({ finished_at: new Date().toISOString(), error: message.slice(0, 500) }).eq("id", run.id);
    return Response.json({ error: message }, { status: 500 });
  }
});
