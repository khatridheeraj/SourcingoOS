import { json, markersClient } from "@/lib/markers";
import { fetchAll } from "@/lib/fetch-all";

// MarkerPilot's saved styles, shared by the company's orders team.
// GET lists every saved version; PUT ?id= saves one (a new version, or the same version again).

export async function GET() {
  const { supabase, error } = await markersClient();
  if (error) return error;
  const { data, error: err } = await fetchAll<{ doc_id: string; data: unknown }>((from, to) =>
    supabase.from("marker_styles").select("doc_id, data").order("doc_id").range(from, to));
  if (err) return json({ error: "failed", message: err.message }, 500);
  return json({ docs: data.map((d) => ({ id: d.doc_id, data: d.data })) });
}

export async function PUT(request: Request) {
  const { supabase, me, error } = await markersClient();
  if (error) return error;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(id)) return json({ error: "bad_id", message: "That style can't be saved under this name." }, 400);
  const text = await request.text();
  if (text.length > 1024 * 1024) return json({ error: "too_large", message: "This style is too large to save." }, 413);
  let data: unknown;
  try { data = JSON.parse(text); } catch { return json({ error: "bad_json", message: "The style could not be read." }, 400); }
  if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "bad_json", message: "The style could not be read." }, 400);
  const { error: err } = await supabase.from("marker_styles")
    .upsert({ company_id: me.companyId, doc_id: id, data }, { onConflict: "company_id,doc_id" });
  if (err) return json({ error: "failed", message: err.message }, 500);
  return json({ ok: true });
}
