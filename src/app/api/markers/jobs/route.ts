import { askMarkerReader, json, markersClient } from "@/lib/markers";

// MarkerPilot's photo readings.
//   POST {prompt, files}          starts a reading with its first photos; answers with its id.
//   POST ?id=&part=n {files}      adds more photos (each request stays under the hosting limit of 4.5 MB).
//   POST ?id=&start=1             all photos are in: the marker reader starts reading.
//   GET ?id=                      the reading's state, and its result once read.

const MAX_CHARS = 4 * 1024 * 1024;
const TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const ID = /^[0-9a-f-]{36}$/;
// A reading still "reading" this long after it was made has stopped; the marker reader marks it as failed.
const STALE_MS = 4 * 60_000;

type File = { type: string; data: string };
const cleanFiles = (files: unknown): File[] | null => {
  if (!Array.isArray(files) || !files.length || files.length > 100) return null;
  if (files.some((f) => !f || !TYPES.includes(f.type) || typeof f.data !== "string" || !f.data)) return null;
  return files.map((f) => ({ type: f.type as string, data: f.data as string }));
};

export async function POST(request: Request) {
  const { supabase, error } = await markersClient();
  if (error) return error;
  const q = new URL(request.url).searchParams;
  const id = q.get("id");
  if (id && !ID.test(id)) return json({ error: "bad_id" }, 400);

  if (id && q.get("start")) {
    const { error: err } = await askMarkerReader(supabase, "start", id);
    return err ? json({ error: "failed", message: err }, 502) : json({ ok: true });
  }

  const text = await request.text();
  if (text.length > MAX_CHARS) return json({ error: "too_large", message: "The photos are too large together. Send fewer photos." }, 413);
  let body: { prompt?: unknown; files?: unknown };
  try { body = JSON.parse(text); } catch { return json({ error: "bad_json" }, 400); }
  const files = cleanFiles(body.files);

  if (id) {
    const part = Number(q.get("part"));
    if (!Number.isInteger(part) || part < 1 || part > 40 || !files) return json({ error: "bad_part" }, 400);
    const { error: err } = await supabase.from("marker_job_parts").insert({ job_id: id, part, files });
    if (err) console.error("markers: photos not added", err);
    return err ? json({ error: "failed", message: "These photos could not be added. Tap Read again." }, 400) : json({ ok: true });
  }

  if (typeof body.prompt !== "string" || !body.prompt.trim()) return json({ error: "no_prompt" }, 400);
  if (body.files !== undefined && Array.isArray(body.files) && body.files.length && !files) return json({ error: "bad_files" }, 400);
  const { data: job, error: err } = await supabase.from("marker_jobs").insert({ prompt: body.prompt }).select("id").single();
  if (err || !job) {
    if (err) console.error("markers: reading not created", err);
    return json({ error: "failed", message: "The reading could not be started. Tap Read again." }, 500);
  }
  if (files) {
    const { error: partErr } = await supabase.from("marker_job_parts").insert({ job_id: job.id, part: 0, files });
    if (partErr) {
      console.error("markers: first photos not added", partErr);
      return json({ error: "failed", message: "The photos could not be added. Tap Read again." }, 500);
    }
  }
  return json({ id: job.id });
}

export async function GET(request: Request) {
  const { supabase, error } = await markersClient();
  if (error) return error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!ID.test(id)) return json({ error: "bad_id" }, 400);
  const read = () => supabase.from("marker_jobs").select("status, result, error_code, error, created_at").eq("id", id).maybeSingle();
  let { data: job } = await read();
  if (!job) return json({ status: "missing" }, 404);
  // A reading in the batch queue is collected by the reader when it is ready; one stuck mid-way is closed by it.
  if (job.status === "batch" || (job.status === "reading" && Date.now() - Date.parse(job.created_at) > STALE_MS)) {
    await askMarkerReader(supabase, "check", id);
    ({ data: job } = await read());
    if (!job) return json({ status: "missing" }, 404);
  }
  if (job.status === "done") return json({ status: "done", result: job.result });
  if (job.status === "error") return json({ status: "error", code: job.error_code, message: job.error });
  return json({ status: "running", queued: job.status === "batch", seconds: Math.round((Date.now() - Date.parse(job.created_at)) / 1000) });
}
