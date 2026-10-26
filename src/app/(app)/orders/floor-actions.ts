"use server";

import { revalidatePath } from "next/cache";
import { canEnterDone, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";
import { friendly } from "@/lib/errors";
import { fetchAll } from "@/lib/fetch-all";
import { FLOOR_STATUS, type FloorStatus } from "@/lib/floor";
import { TNA_STEPS, todayIST, unitOf } from "@/lib/format";
import { PHOTO_BUCKET } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";

const str = (v: unknown) => (v == null ? "" : String(v));

export type VisitStep = { key: string; label: string; planned: string; done: string };
export type VisitLast = { stage: string; step: string; status: FloorStatus; qtyDone: number | null; expectedOn: string; note: string; at: string; by: string };
export type VisitStyle = {
  id: string; orderId: string; orderNo: string; buyer: string; style: string; colour: string; qty: number; unit: string; photoUrl: string | null;
  due: string; steps: VisitStep[]; last: VisitLast | null;
};
export type VisitData = {
  companyId: string; today: string; factoryId: string; factoryName: string;
  // Factories with production running, for switching the visit to another one.
  factories: { id: string; name: string; styles: number }[];
  styles: VisitStyle[];
};

// What a factory visit needs: every style in production at the factory (or on one order), each with its steps and
// the latest update from the floor.
export async function loadVisit(scope: { factoryId?: string; orderId?: string }): Promise<{ error?: string; visit?: VisitData }> {
  const me = await getMe();
  if (!canEnterDone(me?.role) || !me?.companyId) return { error: "Only Quality and the orders team post production updates." };
  const uuid = /^[0-9a-f-]{36}$/i;
  if ((scope.factoryId && !uuid.test(scope.factoryId)) || (scope.orderId && !uuid.test(scope.orderId))) return { error: "That wasn't found." };
  const supabase = await createClient();
  const [{ data: orders, error }, { data: pos }, buyers, factories, team] = await Promise.all([
    fetchAll((a, z) => supabase.from("orders").select("id, order_no, buyer_id, ship_date, revised_ship_date, order_lines(id, style, colour, qty, factory_id, position, product, photo_path)")
      .eq("company_id", me.companyId!).eq("status", "open").is("order_lines.removed_at", null).order("id").range(a, z)),
    fetchAll((a, z) => supabase.from("factory_pos").select("order_id, factory_id").not("released_at", "is", null).order("id").range(a, z)),
    loadBuyers(),
    loadFactories(),
    loadTeam(),
  ]);
  if (error) return { error: friendly(error) };
  const released = new Set((pos ?? []).map((p) => `${p.order_id}:${p.factory_id}`));
  const running = (orders ?? []).flatMap((o) => (o.order_lines ?? []).filter((l) => l.factory_id && released.has(`${o.id}:${l.factory_id}`)).map((l) => ({ o, l })));
  const counts = new Map<string, number>();
  for (const { l } of running) counts.set(l.factory_id!, (counts.get(l.factory_id!) ?? 0) + 1);
  const factoryName = new Map(factories.map((f) => [f.id, f.name]));
  const list = [...counts.entries()].map(([id, styles]) => ({ id, name: factoryName.get(id) ?? "Factory", styles })).sort((a, b) => a.name.localeCompare(b.name));

  const inScope = running.filter(({ o, l }) => (scope.orderId ? o.id === scope.orderId : true) && (scope.factoryId ? l.factory_id === scope.factoryId : !!scope.orderId));
  const ids = inScope.map(({ l }) => l.id);
  const [{ data: stages }, { data: ups }, { data: signed }] = ids.length
    ? await Promise.all([
        fetchAll((a, z) => supabase.from("line_stages").select("line_id, stage, label, planned_on, done_on, not_needed, added_at").in("line_id", ids).order("added_at").order("id").range(a, z)),
        supabase.from("floor_updates").select("line_id, stage, status, qty_done, expected_on, note, created_by, created_at").in("line_id", ids).order("created_at", { ascending: false }).limit(500),
        (() => {
          const paths = inScope.map(({ l }) => l.photo_path).filter(Boolean) as string[];
          return paths.length ? supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : Promise.resolve({ data: [] as { path: string | null; signedUrl: string }[] });
        })(),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }];
  const urlOf = new Map((signed ?? []).filter((s) => s.signedUrl).map((s) => [s.path, s.signedUrl]));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const labelOf = (lineId: string, stage: string) => TNA_STEPS.find((t) => t.key === stage)?.label
    ?? (str((stages ?? []).find((s) => s.line_id === lineId && s.stage === stage)?.label) || "Extra step");

  const styles: VisitStyle[] = inScope.map(({ o, l }) => {
    const rows = (stages ?? []).filter((s) => s.line_id === l.id);
    const step = (key: string, label: string) => {
      const r = rows.find((s) => s.stage === key);
      return r?.not_needed ? null : { key, label, planned: str(r?.planned_on), done: str(r?.done_on) };
    };
    const u = (ups ?? []).find((x) => x.line_id === l.id);
    return {
      id: l.id, orderId: o.id, orderNo: o.order_no, buyer: buyerOf.get(o.buyer_id) ?? "", style: l.style, colour: str(l.colour), qty: l.qty, unit: unitOf(l.product),
      photoUrl: (l.photo_path && urlOf.get(l.photo_path)) || null, due: str(o.revised_ship_date || o.ship_date),
      steps: [...TNA_STEPS.map((t) => step(t.key, t.label)), ...rows.filter((s) => s.stage.startsWith("extra_")).map((s) => step(s.stage, str(s.label)))]
        .filter((x): x is VisitStep => !!x),
      last: u ? {
        stage: u.stage, step: labelOf(l.id, u.stage), status: u.status as FloorStatus, qtyDone: u.qty_done, expectedOn: str(u.expected_on), note: str(u.note),
        at: u.created_at, by: (u.created_by && people.get(u.created_by)) || "Someone",
      } : null,
    };
  }).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999") || a.orderNo.localeCompare(b.orderNo));

  const fid = scope.factoryId ?? (new Set(inScope.map(({ l }) => l.factory_id)).size === 1 ? inScope[0].l.factory_id! : "");
  return {
    visit: {
      companyId: me.companyId, today: todayIST(), factoryId: fid, factoryName: fid ? factoryName.get(fid) ?? "Factory" : "",
      factories: list, styles,
    },
  };
}

export type FloorInput = { lineId: string; orderId: string; stage: string; status: FloorStatus; qty: string; expectedOn: string; note: string; photos: string[] };

// Posts one update from the floor. "Done" also enters the step's done date for today.
export async function postFloorUpdate(input: FloorInput): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEnterDone(me?.role)) return { error: "Only Quality and the orders team post production updates." };
  if (!FLOOR_STATUS.some((s) => s.key === input.status)) return { error: "Say how the step is: done, on track, running late or a problem." };
  const qty = input.qty.replace(/[,\s]/g, "");
  if (qty && !/^\d+$/.test(qty)) return { error: "Enter the quantity done as a whole number." };
  if (input.expectedOn && !/^\d{4}-\d{2}-\d{2}$/.test(input.expectedOn)) return { error: "Pick the ready date from the calendar." };
  if (!input.photos.length) return { error: "Add at least one photo from the floor." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("post_floor_update", {
    p_line: input.lineId, p_stage: input.stage, p_status: input.status, p_qty: qty ? Number(qty) : null,
    p_expected: input.expectedOn || null, p_note: input.note.trim().slice(0, 500), p_photos: input.photos,
  });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
  revalidatePath(`/orders/${input.orderId}`);
  if (input.status === "done") revalidatePath("/");
  return {};
}
