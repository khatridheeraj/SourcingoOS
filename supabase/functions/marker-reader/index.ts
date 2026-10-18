import Anthropic from "npm:@anthropic-ai/sdk@0.135.0";
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.49.4";

// MarkerPilot's photo reading, running on Supabase so it can use the company's AI key without the app ever holding it.
//   {action: "start", id}  the photos of a reading are uploaded (marker_job_parts); reading starts.
//   {action: "check", id}  a reading that went to the batch queue: fetch its result if it is ready.
// The person must be signed in and on the orders team; their own access decides which readings they can see.
// A reading runs after the answer is sent. Supabase stops a function after 150 seconds, so a reading that
// isn't finished by then is handed to Claude's batch queue and picked up by "check".

const MODEL = "claude-opus-5-5";
const MAX_TOKENS = 32000;
const DIRECT_MS = 125_000;
const MAX_FILES = 100;

type File = { type: string; data: string };
type Job = { id: string; company_id: string; prompt: string; status: string; batch_id: string | null };

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: CORS });

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

function parseJSON(text: string) {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(t); } catch { /* fall through */ }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
  throw new Error("no JSON");
}

const done = (db: SupabaseClient, id: string, out: { result?: unknown; error_code?: string; error?: string }) =>
  db.from("marker_jobs").update({ status: out.result !== undefined ? "done" : "error", result: out.result ?? null,
    error_code: out.error_code ?? null, error: out.error ?? null, finished_at: new Date().toISOString() }).eq("id", id);

// What Claude answered, as MarkerPilot expects it: the parsed JSON, or an error code and message to show.
function outcome(msg: Anthropic.Message): { result?: unknown; error_code?: string; error?: string } {
  if (msg.stop_reason === "refusal") return { error_code: "refused", error: "Claude declined to read these files. Type the breakdown on screen 3 instead." };
  if (msg.stop_reason === "max_tokens") return { error_code: "invalid_json", error: "Claude's reply was cut off. Tap Read again with fewer files." };
  const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try { return { result: parseJSON(text) }; } catch { return { error_code: "invalid_json", error: "Claude replied in an unexpected format. Tap Read again." }; }
}

function failure(e: unknown): { error_code: string; error: string } {
  const status = e instanceof Anthropic.APIError ? e.status : undefined;
  const detail = String((e as { message?: string })?.message ?? e).slice(0, 200);
  if (/credit balance/i.test(detail)) return { error_code: "failed", error: "The Anthropic account behind the AI key has no credit left. The owner adds credit at console.anthropic.com under Billing, then taps Read again." };
  if (status === 401) return { error_code: "failed", error: "The AI key isn't valid. The owner can paste a new one on the Incoming POs page." };
  if (status === 429) return { error_code: "rate_limited", error: "Too many requests just now. Try again in a minute." };
  if (status === 529 || status === 503) return { error_code: "failed", error: "Claude is busy right now. Try again in a minute." };
  if (status === 400) return { error_code: "failed", error: "Claude could not accept these files: " + detail };
  return { error_code: "failed", error: "Reading failed: " + detail };
}

async function run(db: SupabaseClient, job: Job): Promise<void> {
  try {
    const { data: key } = await db.rpc("get_ai_key", { p_company: job.company_id });
    if (!key) {
      await done(db, job.id, { error_code: "failed", error: "The AI key isn't set yet. The owner pastes it once on the Incoming POs page." });
      return;
    }
    // The photos in the order they were sent.
    const { data: parts, error } = await db.from("marker_job_parts").select("files").eq("job_id", job.id).order("part");
    if (error) throw new Error(error.message);
    const files = (parts ?? []).flatMap((p) => p.files as File[]).slice(0, MAX_FILES);
    const content: Anthropic.ContentBlockParam[] = files.map((f) => f.type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
      : { type: "image", source: { type: "base64", media_type: f.type as "image/jpeg", data: f.data } });
    content.push({ type: "text", text: job.prompt });
    const params = { model: MODEL, max_tokens: MAX_TOKENS, thinking: { type: "adaptive" as const }, messages: [{ role: "user" as const, content }] };

    const client = new Anthropic({ apiKey: key as string, maxRetries: 1 });
    try {
      // Refusal fallbacks are on for the direct reading; the batch queue does not take them.
      const stream = client.beta.messages.stream({ ...params, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" } as never,
        { signal: AbortSignal.timeout(DIRECT_MS) });
      const msg = await stream.finalMessage();
      await done(db, job.id, outcome(msg as unknown as Anthropic.Message));
    } catch (e) {
      if (!(e instanceof Anthropic.APIUserAbortError) && !(e instanceof DOMException && e.name === "TimeoutError")) throw e;
      // Out of time here: the same reading goes to the batch queue, and "check" collects it.
      const batch = await client.messages.batches.create({ requests: [{ custom_id: job.id, params }] });
      await db.from("marker_jobs").update({ status: "batch", batch_id: batch.id }).eq("id", job.id);
    }
  } catch (e) {
    await done(db, job.id, failure(e));
  } finally {
    // Photos are not kept after reading (the batch queue has its own copy).
    await db.from("marker_job_parts").delete().eq("job_id", job.id);
  }
}

async function check(db: SupabaseClient, job: Job): Promise<void> {
  if (job.status !== "batch" || !job.batch_id) return;
  try {
    const { data: key } = await db.rpc("get_ai_key", { p_company: job.company_id });
    const client = new Anthropic({ apiKey: key as string });
    const batch = await client.messages.batches.retrieve(job.batch_id);
    if (batch.processing_status !== "ended") return;
    for await (const r of await client.messages.batches.results(job.batch_id)) {
      if (r.custom_id !== job.id) continue;
      if (r.result.type === "succeeded") await done(db, job.id, outcome(r.result.message));
      else if (r.result.type === "errored") await done(db, job.id, { error_code: "failed", error: "Reading failed: " + String(r.result.error.error.message).slice(0, 200) });
      else await done(db, job.id, { error_code: "failed", error: "Reading took too long. Try again with fewer files." });
      return;
    }
    await done(db, job.id, { error_code: "failed", error: "Reading failed: no answer came back. Tap Read again." });
  } catch (e) {
    const status = e instanceof Anthropic.APIError ? e.status : undefined;
    // A passing hiccup leaves the reading waiting; the next check tries again.
    if (status === 401 || status === 404) await done(db, job.id, failure(e));
  }
}

// Keeps the reading going after the answer is sent.
function inBackground(work: Promise<void>) {
  const rt = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (rt) rt.waitUntil(work);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ error: "Send JSON." }, 400);
  const auth = req.headers.get("authorization");
  if (!auth) return json({ error: "Sign in first." }, 401);
  const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false }, global: { headers: { Authorization: auth } },
  });
  // Only readings this person can see (the orders team of their company).
  const { data: seen } = await asUser.from("marker_jobs").select("id").eq("id", String(body.id ?? "")).maybeSingle();
  if (!seen) return json({ error: "This reading is no longer here. Tap Read again." }, 404);
  const db = admin();
  const { data: job } = await db.from("marker_jobs").select("id, company_id, prompt, status, batch_id").eq("id", seen.id).single();
  if (!job) return json({ error: "This reading is no longer here. Tap Read again." }, 404);

  if (body.action === "start") {
    // Only the first start reads; a repeated tap does nothing.
    const { data: claimed } = await db.from("marker_jobs").update({ status: "reading" }).eq("id", job.id).eq("status", "uploading").select("id");
    if (claimed?.length) inBackground(run(db, job as Job));
    return json({ ok: true });
  }
  if (body.action === "check") {
    await check(db, job as Job);
    return json({ ok: true });
  }
  return json({ error: "Unknown action." }, 400);
});
