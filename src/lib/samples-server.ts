import { fetchAll } from "@/lib/fetch-all";
import { buyerName, loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";
import { getMe } from "@/lib/auth";
import { NO_COMPANY } from "@/lib/names";
import { ROUND_COLUMNS, SAMPLE_STEPS, type SampleRound, type SampleState } from "@/lib/samples";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

// A round as the team's screens show it: photos as links, people by name.
export type RoundView = Omit<SampleRound, "photos" | "answer_photos"> & {
  photos: string[]; answerPhotos: string[]; sentByName: string; forwardedByName: string; answeredByName: string;
};

// One style's sample step: where it stands and every round sent so far, oldest first.
export type SampleThread = {
  key: string; companyId: string; orderId: string; orderNo: string; buyerPo: string; buyer: string;
  lineId: string; style: string; colour: string; qty: number; styleUrl: string | null;
  factoryId: string; factory: string; factoryPhone: string | null;
  stage: string; target: string | null; doneOn: string | null; state: SampleState; rounds: RoundView[];
};

// Every sample step of the open orders' released styles (or of one order), with their rounds.
export async function loadSampleThreads(orderId?: string): Promise<{ threads: SampleThread[]; error: string | null }> {
  const me = await getMe();
  const companyId = me?.companyId ?? NO_COMPANY;
  const supabase = await createClient();
  const stages = SAMPLE_STEPS.map((s) => s.key);
  const [orders, buyers, factories, team] = await Promise.all([
    fetchAll((a, z) => {
      let q = supabase.from("orders").select("id, order_no, buyer_id, buyer_po, status, order_lines(id, style, colour, qty, factory_id, position, photo_path, removed_at)")
        .eq("company_id", companyId).is("order_lines.removed_at", null);
      q = orderId ? q.eq("id", orderId) : q.eq("status", "open");
      return q.order("order_no").order("id").range(a, z);
    }),
    loadBuyers(), loadFactories(), loadTeam(),
  ]);
  const ids = (orders.data ?? []).map((o) => o.id as string);
  const [pos, steps, rounds] = ids.length
    ? await Promise.all([
        fetchAll((a, z) => supabase.from("factory_pos").select("order_id, factory_id, released_at").in("order_id", ids).not("released_at", "is", null).order("id").range(a, z)),
        fetchAll((a, z) => supabase.from("line_stages").select("line_id, stage, planned_on, done_on").in("order_id", ids).in("stage", stages).order("id").range(a, z)),
        fetchAll<SampleRound>((a, z) => supabase.from("sample_rounds").select(ROUND_COLUMNS).in("order_id", ids).order("round").order("id").range(a, z)),
      ])
    : [{ data: [], error: null }, { data: [], error: null }, { data: [], error: null }];
  const error = [orders.error, pos.error, steps.error, rounds.error].find(Boolean)?.message ?? null;

  const paths = [...new Set([
    ...(rounds.data ?? []).flatMap((r) => [...r.photos, ...r.answer_photos]),
    ...(orders.data ?? []).flatMap((o) => (o.order_lines ?? []).map((l: { photo_path: string | null }) => l.photo_path)).filter((p): p is string => !!p),
  ])];
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
  const url = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const name = (id: string | null) => (id && people.get(id)) || "";
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const factoryOf = new Map(factories.map((f) => [f.id, f]));
  const released = new Set((pos.data ?? []).map((p) => `${p.order_id}:${p.factory_id}`));
  const stepOf = new Map((steps.data ?? []).map((s) => [`${s.line_id}:${s.stage}`, s]));

  const threads: SampleThread[] = [];
  for (const o of orders.data ?? []) {
    const lines = [...(o.order_lines ?? [])].sort((a, b) => a.position - b.position);
    for (const l of lines) {
      if (!l.factory_id) continue;
      for (const st of SAMPLE_STEPS) {
        const rs = (rounds.data ?? []).filter((r) => r.line_id === l.id && r.stage === st.key);
        // Samples start once the factory PO is released; rounds already sent always show.
        if (!rs.length && !released.has(`${o.id}:${l.factory_id}`)) continue;
        const step = stepOf.get(`${l.id}:${st.key}`);
        const last = rs[rs.length - 1];
        const state: SampleState = last ? (last.status === "approved" ? "approved" : step?.done_on ? "done" : last.status) : step?.done_on ? "done" : "not_sent";
        const f = factoryOf.get(l.factory_id);
        threads.push({
          key: `${l.id}:${st.key}`, companyId, orderId: o.id, orderNo: o.order_no, buyerPo: o.buyer_po ?? "", buyer: buyerOf.get(o.buyer_id) ?? "",
          lineId: l.id, style: l.style, colour: l.colour ?? "", qty: l.qty, styleUrl: (l.photo_path && url.get(l.photo_path)) || null,
          factoryId: l.factory_id, factory: f?.name ?? "Factory", factoryPhone: f?.phone ?? null,
          stage: st.key, target: step?.planned_on ?? null, doneOn: step?.done_on ?? null, state,
          rounds: rs.map(({ photos, answer_photos, ...r }) => ({
            ...r, photos: photos.map((p) => url.get(p)).filter((u): u is string => !!u), answerPhotos: answer_photos.map((p) => url.get(p)).filter((u): u is string => !!u),
            sentByName: r.sent_by_team ? name(r.sent_by) : f?.name ?? "Factory", forwardedByName: name(r.forwarded_by), answeredByName: name(r.answered_by),
          })),
        });
      }
    }
  }
  return { threads, error };
}
