"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, canEnterDone, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadFactories, loadTeam, personName } from "@/lib/data";
import { friendly } from "@/lib/errors";
import { TNA_STEPS, todayIST } from "@/lib/format";
import { addDays, andList, dm, EMAIL_OK, emptySteps, pastTarget, startTargets, type QGroup, type QOrder, type QStyle } from "@/lib/quick";
import { createClient } from "@/lib/supabase/server";
import { saveLineStages, type LineStageInput } from "./actions";

const str = (v: unknown) => (v == null ? "" : String(v));

// Everything the quick sheets need about one order: its styles by factory, each style's steps, and where each
// factory's plan stands.
export async function loadQuick(orderId: string): Promise<{ error?: string; order?: QOrder }> {
  const me = await getMe();
  if (!canEnterDone(me?.role)) return { error: "Only the orders team and Quality can update production." };
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return { error: "That order wasn't found." };
  const supabase = await createClient();
  const [{ data: o, error }, { data: stages }, { data: pos }, { data: prices }, buyers, factories, team, { data: withPo }] = await Promise.all([
    supabase.from("orders").select("id, order_no, buyer_id, buyer_po, ship_date, revised_ship_date, status, order_lines(id, style, colour, qty, factory_id, position, product, photo_path)")
      .eq("id", orderId).is("order_lines.removed_at", null).maybeSingle(),
    supabase.from("line_stages").select("line_id, stage, label, planned_on, done_on, factory_on, not_needed, added_at").eq("order_id", orderId).order("added_at").order("id"),
    supabase.from("factory_pos").select("factory_id, plan_requested_at, plan_requested_on, factory_sent_at, released_at, lock_requested_at, lock_note, buffer_days").eq("order_id", orderId),
    supabase.rpc("line_prices", { p_orders: [orderId] }),
    loadBuyers(),
    loadFactories(),
    loadTeam(),
    supabase.rpc("orders_with_po_file", { p_orders: [orderId] }),
  ]);
  if (error) return { error: friendly(error) };
  if (!o) return { error: "That order wasn't found." };
  const rate = new Map(((prices ?? []) as { id: string; factory_rate: number | null }[]).map((p) => [p.id, p.factory_rate]));
  const lines = [...(o.order_lines ?? [])].sort((a, b) => a.position - b.position);
  const styleOf = (l: (typeof lines)[number]): QStyle => {
    const rows = (stages ?? []).filter((s) => s.line_id === l.id);
    const step = (key: string, label: string, extra: boolean) => {
      const r = rows.find((s) => s.stage === key);
      return { key, label, planned_on: str(r?.planned_on), done_on: str(r?.done_on), factory_on: str(r?.factory_on), not_needed: !!r?.not_needed, extra };
    };
    return {
      id: l.id, style: l.style, colour: str(l.colour), qty: l.qty, hasRate: rate.get(l.id) != null, hasPhoto: !!l.photo_path, factoryId: l.factory_id, fabric: l.product === "fabric",
      steps: [...TNA_STEPS.map((t) => step(t.key, t.label, false)), ...rows.filter((s) => s.stage.startsWith("extra_")).map((s) => step(s.stage, str(s.label), true))],
    };
  };
  const groups: QGroup[] = [];
  for (const l of lines) {
    let g = groups.find((x) => x.factoryId === (l.factory_id ?? null));
    if (!g) {
      const po = (pos ?? []).find((p) => p.factory_id === l.factory_id);
      const f = factories.find((x) => x.id === l.factory_id);
      g = {
        factoryId: l.factory_id ?? null, factoryName: f?.name ?? "No factory yet", phone: f?.phone ?? null, email: f?.email ?? null,
        released: !!po?.released_at, asked: !!(po?.plan_requested_at || po?.plan_requested_on),
        sent: !!po?.factory_sent_at && (!po.plan_requested_at || po.factory_sent_at >= po.plan_requested_at),
        lockRequestedAt: str(po?.lock_requested_at), lockNote: str(po?.lock_note), bufferDays: po?.buffer_days ?? null, styles: [],
      };
      groups.push(g);
    }
    g.styles.push(styleOf(l));
  }
  // A plan waiting for approval can have changed since it was sent: say what stops it, so nobody presses a button that fails.
  await Promise.all(groups.filter((g) => g.factoryId && g.lockRequestedAt && !g.released).map(async (g) => {
    const { data } = await supabase.rpc("release_blocker", { p_order: orderId, p_factory: g.factoryId });
    g.blocker = friendly({ message: str(data) });
  }));
  const owner = team.find((m) => m.role === "owner" && m.active);
  const b = buyers.find((x) => x.id === o.buyer_id);
  return {
    order: {
      id: o.id, orderNo: o.order_no, buyer: b ? buyerName(b) : "", buyerPo: str(o.buyer_po), due: str(o.revised_ship_date || o.ship_date), shipDate: str(o.ship_date),
      status: o.status, today: todayIST(), isOwner: me?.role === "owner", companyId: me?.companyId ?? "", ownerName: owner ? personName(owner).split(" ")[0] : "the owner",
      factories: factories.filter((f) => f.active).map((f) => ({ id: f.id, name: f.name, email: f.email ?? null })).sort((a, b) => a.name.localeCompare(b.name)),
      groups,
      // Quality can't see PO files; it never starts production, so the flag only matters to the orders team.
      hasBuyerPo: ((withPo ?? []) as string[]).includes(o.id),
    },
  };
}

// Marks steps done from the quick sheet. Each row carries what the sheet loaded, so someone else's newer date is never overwritten.
export async function markStepsDone(orderId: string, rows: LineStageInput[]): Promise<{ error?: string }> {
  if (!rows.length) return { error: "Pick at least one style." };
  const res = await saveLineStages(orderId, rows);
  if (!res.error) revalidatePath("/today");
  return res;
}

export type StartInput = {
  factoryId: string;
  bufferDays: number;
  // The factory agreed to the targets (by phone or WhatsApp): its dates are entered as the targets and the plan goes for the lock.
  agreed: boolean;
  // A factory for styles without one, and rates the factory quoted, set on the way.
  styles?: { line_id: string; factory_id?: string; factory_rate?: string }[];
  // A new ship date when the old one has passed, and why.
  newShipDate?: string;
  reason?: string;
  // The factory's email, typed in the sheet when it has none: the approved PO is emailed there.
  factoryEmail?: string;
  // The merchandiser chose to move her dates that fall after the finish date onto it. Never done without asking.
  moveLate?: boolean;
};

// Starts a factory's production in one go: missing factory and rates, targets for every step, the request to the
// factory, its agreement, and the plan sent for the owner's lock (or locked, when the owner does it).
export async function startProduction(orderId: string, input: StartInput): Promise<{ error?: string; done?: string; factoryId?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can start production." };
  const b = Number(input.bufferDays);
  if (!Number.isInteger(b) || b < 0 || b > 90) return { error: "Keep a buffer of 0 to 90 days." };
  const supabase = await createClient();
  const today = todayIST();

  if (input.newShipDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.newShipDate) || input.newShipDate <= today) return { error: "Pick a new ship date after today." };
    if (!input.reason?.trim()) return { error: "Say why the ship date moves, so everyone knows." };
    // Moves any targets already set by the same days, like a new date saved on the order page.
    const { error } = await supabase.rpc("move_ship_date", { p_order: orderId, p_new: input.newShipDate, p_reason: input.reason });
    if (error) return { error: friendly(error) };
  }
  let factoryId = input.factoryId;
  if (input.styles?.length) {
    const rows = input.styles.filter((s) => s.factory_id || s.factory_rate?.trim());
    if (rows.some((s) => s.factory_rate?.trim() && !(Number(s.factory_rate.replace(/[,₹\s]/g, "")) >= 0))) return { error: "Enter each factory rate as a number." };
    if (rows.length) {
      const { error } = await supabase.rpc("set_style_factory", { p_order: orderId, p_rows: rows });
      if (error) return { error: friendly(error) };
    }
    if (!factoryId) factoryId = rows.find((s) => s.factory_id)?.factory_id ?? "";
  }
  if (!factoryId) return { error: "Pick the factory making these styles." };
  const email = input.factoryEmail?.trim().toLowerCase();
  if (email) {
    if (!EMAIL_OK.test(email)) return { error: "The factory's email doesn't look right." };
    const { error } = await supabase.from("factories").update({ email }).eq("id", factoryId);
    if (error) return { error: friendly(error) };
    revalidatePath("/factories");
  }

  const { order, error: loadError } = await loadQuick(orderId);
  if (!order) return { error: loadError ?? "That order wasn't found." };
  const g = order.groups.find((x) => x.factoryId === factoryId);
  if (!g) return { error: "This factory has no styles on the order." };
  if (g.released) return { done: `${g.factoryName}'s production has already started.`, factoryId };
  if (!order.due) return { error: "Enter the order's ship date first." };
  const target = addDays(order.due, -b);
  if (target < today) return { error: `With ${b} days' buffer the factory would have to finish by ${dm(target)}, which has passed. Use a smaller buffer or a new ship date.` };
  // The merchandiser's saved dates are never changed behind her back: dates after the finish date move only when she says so.
  const late = pastTarget(g.styles, target);
  if (late.rows.length && !input.moveLate) return { error: `${andList(late.labels)} ${late.labels.length === 1 ? "is" : "are"} set after ${dm(target)}, the day the factory must finish by. Use a smaller buffer, or move ${late.labels.length === 1 ? "it" : "them"} to ${dm(target)}.` };
  // No day left to plan the steps with no date: every one of them on the same day would be no plan at all.
  if (target <= today && emptySteps(g.styles)) return { error: `With ${b} days' buffer the factory would have to finish today, leaving no days for the steps with no date yet. Use a smaller buffer or a new ship date.` };
  if (input.agreed && !order.hasBuyerPo) return { error: NO_BUYER_PO };
  if (g.styles.some((s) => !s.hasRate)) return { error: `Enter ${g.factoryName}'s rate for ${g.styles.filter((s) => !s.hasRate).map((s) => s.style).join(", ")}.` };
  // What would stop the PO going for approval is checked before anything is saved, so nothing is left half done.
  if (input.agreed && me?.role !== "owner") {
    const { data: block } = await supabase.rpc("po_send_blocker", { p_order: orderId, p_factory: factoryId });
    if (block) return { error: block as string };
  }

  // Targets: fill the empty ones (and move the late ones, when asked), then save them with what was loaded.
  const plan = startTargets(g.styles, target, today, !!input.moveLate);
  const rows: LineStageInput[] = g.styles.flatMap((s) => Object.entries(plan[s.id] ?? {}).map(([stage, on]) => {
    const x = s.steps.find((y) => y.key === stage)!;
    return { line_id: s.id, stage, planned_on: on, done_on: x.done_on, not_needed: false, ...(x.extra ? { label: x.label } : {}),
      was: { planned_on: x.planned_on, done_on: x.done_on, not_needed: x.not_needed } };
  }));
  if (rows.length) {
    const res = await saveLineStages(orderId, rows);
    if (res.error) return res;
  }
  const step = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await supabase.rpc(fn, args);
    return error ? friendly(error) : null;
  };
  let err = await step("request_factory_plan", { p_order: orderId, p_factory: factoryId, p_buffer_days: b });
  if (err) return { error: err };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  if (!input.agreed) return { done: `Targets set and ${g.factoryName} asked for its dates. It has 24 hours to send them.`, factoryId };
  err = await step("accept_targets_for_factory", { p_order: orderId, p_factory: factoryId });
  if (err) return { error: err };
  if (me?.role === "owner") {
    err = await step("release_factory_po", { p_order: orderId, p_factory: factoryId });
    if (err) return { error: err };
    revalidatePath("/");
    return { done: `Approved. ${g.factoryName}'s production has started and the PO is emailed to them.`, factoryId };
  }
  err = await step("request_po_lock", { p_order: orderId, p_factory: factoryId });
  if (err) return { error: err };
  return { done: `Sent to ${order.ownerName} for approval. Once approved, the PO is emailed to ${g.factoryName}.`, factoryId };
}

// The owner locks a plan sent for the lock, from Home or the sheet.
const NO_BUYER_PO = "The buyer's PO isn't on file yet. A factory PO is issued only against a PO received from the buyer: add the buyer's PO in the order's Details first.";

export async function lockPlan(orderId: string, factoryId: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (me?.role !== "owner") return { error: "Only the owner locks a plan." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("release_factory_po", { p_order: orderId, p_factory: factoryId });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Moves the open targets that sit after the factory's finish date back to that date, when the factory's own dates
// already meet it; the owner can approve in the same tap.
export async function moveLateTargets(orderId: string, factoryId: string, approve: boolean): Promise<{ error?: string; done?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can change the plan." };
  const { order, error: loadError } = await loadQuick(orderId);
  if (!order) return { error: loadError ?? "That order wasn't found." };
  const g = order.groups.find((x) => x.factoryId === factoryId);
  if (!g || g.released) return { error: "This factory's PO is already approved." };
  if (!order.due) return { error: "Enter the order's ship date first." };
  const target = addDays(order.due, -(g.bufferDays ?? 0));
  const late = pastTarget(g.styles, target);
  if (late.rows.length && !late.movable) return { error: `The factory's own dates for ${andList(late.labels)} are after ${dm(target)}. Ask the factory for earlier dates, or move the ship date.` };
  if (late.rows.length) {
    const res = await saveLineStages(orderId, late.rows.map(({ style, step }) => ({
      line_id: style.id, stage: step.key, planned_on: target, done_on: step.done_on, not_needed: false, ...(step.extra ? { label: step.label } : {}),
      was: { planned_on: step.planned_on, done_on: step.done_on, not_needed: step.not_needed },
    })));
    if (res.error) return res;
  }
  const moved = late.rows.length ? `${andList(late.labels)} moved to ${dm(target)}.` : "";
  if (approve && me?.role === "owner") {
    const res = await lockPlan(orderId, factoryId);
    if (res.error) return res;
    return { done: `${moved} Approved: the PO is emailed to ${g.factoryName}.`.trim() };
  }
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/");
  return { done: moved || "Nothing to move." };
}

// Closes an order that shipped before the app was in use: nothing in Dispatch, ship date two weeks past.
export async function closeOldOrder(orderId: string, note: string): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return { error: "Only the orders team can close an order." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("close_old_order", { p_order: orderId, p_note: note.trim() });
  if (error) return { error: friendly(error) };
  revalidatePath("/");
  revalidatePath("/today");
  revalidatePath(`/orders/${orderId}`);
  return {};
}

// Notes that a factory was chased on WhatsApp, so the team sees it was done today.
export async function logChase(factoryId: string, orderId: string | null): Promise<{ error?: string }> {
  const me = await getMe();
  if (!canEditOrders(me?.role)) return {};
  const supabase = await createClient();
  const { error } = await supabase.from("factory_chases").insert({ factory_id: factoryId, order_id: orderId });
  if (error) return { error: friendly(error) };
  revalidatePath("/today");
  return {};
}
