import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { DelayReason, FpoLine, FpoStatus, OrderType, QcDefect, QcKind, QcResult, SampleStatus, SampleType, TnaStatus } from "@/lib/model";

/* Factory portal: only what the portal_factory_* views expose. */
export type FCheckpoint = {
  id: string; style_id: string; so_id: string; position: number; name: string; due_date: string | null; status: TnaStatus;
  status_updated_at: string | null; status_note: string | null; delay_reason: DelayReason | null;
};
export type FPo = {
  id: string; so_id: string; buyer_code: string; revision: number; status: FpoStatus; currency: string; delivery_date: string | null;
  payment_terms: string | null; terms: string | null; lines: FpoLine[]; total_qty: number; total_value: number | null; issued_at: string;
  responded_at: string | null; response_note: string | null;
};
export type FQc = {
  id: string; so_id: string; style_id: string; kind: QcKind; inspected_on: string; lot_qty: number; sample_size: number; defects: QcDefect[];
  critical: number; major: number; minor: number; measurements_ok: boolean | null; packing_ok: boolean | null; result: QcResult; notes: string | null;
};
export type FStyle = {
  id: string; so_id: string; position: number; name: string; code: string; fabric: string; colour: string; use_sizes: boolean;
  sizes: Record<string, number | string | null>; qty: number; factory_rate: number | null; checkpoints: FCheckpoint[]; received: number;
};
export type FReceipt = { grn_id: string; so_id: string; received_at: string; status: string; style_id: string; qty: number; condition: string };
export type FOrder = {
  id: string; buyer_code: string; order_type: OrderType; so_date: string; factory_date: string | null; status: "tna_review" | "locked" | "shipped";
  locked_at: string | null; terms: string | null; currency: string; styles: FStyle[]; receipts: FReceipt[];
};

export type FSample = {
  id: string; buyer_code: string; sample_type: SampleType; description: string | null; buyer_ref: string | null; fabric: string | null; qty: number;
  status: SampleStatus; round: number; issued_on: string | null; vendor_due: string | null; ready_on: string | null; feedback: string | null;
};

const byPos = <T extends { position: number }>(a: T, b: T) => a.position - b.position;

export const loadFactory = cache(async () => {
  const supabase = await createClient();
  const [profile, orders, styles, cps, receipts, samples, pos, qcs] = await Promise.all([
    supabase.from("portal_factory_profile").select("id, name, city").maybeSingle(),
    supabase.from("portal_factory_orders").select("*").order("factory_date", { ascending: true, nullsFirst: false }),
    supabase.from("portal_factory_styles").select("*"),
    supabase.from("portal_factory_checkpoints").select("*"),
    supabase.from("portal_factory_receipts").select("*").order("received_at", { ascending: false }),
    supabase.from("portal_factory_samples").select("*").order("vendor_due", { ascending: true, nullsFirst: false }),
    supabase.from("portal_factory_pos").select("*").order("issued_at", { ascending: false }),
    supabase.from("portal_factory_qc").select("*").order("inspected_on", { ascending: false }),
  ]);
  const error = [profile, orders, styles, cps, receipts, samples, pos, qcs].find((r) => r.error)?.error ?? null;
  const rec = (receipts.data ?? []) as FReceipt[];
  const list: FOrder[] = ((orders.data ?? []) as Omit<FOrder, "styles" | "receipts">[]).map((o) => ({
    ...o,
    receipts: rec.filter((r) => r.so_id === o.id),
    styles: ((styles.data ?? []) as Omit<FStyle, "checkpoints" | "received">[])
      .filter((s) => s.so_id === o.id)
      .map((s) => ({
        ...s,
        checkpoints: ((cps.data ?? []) as FCheckpoint[]).filter((c) => c.style_id === s.id).sort(byPos),
        received: rec.filter((r) => r.style_id === s.id).reduce((a, r) => a + Number(r.qty), 0),
      }))
      .sort(byPos),
  }));
  return {
    factory: profile.data as { id: string; name: string; city: string | null } | null, orders: list, samples: (samples.data ?? []) as FSample[],
    pos: (pos.data ?? []) as FPo[], qcs: (qcs.data ?? []) as FQc[], error,
  };
});

/* Buyer portal: milestones, styles and shipments only. */
export type BStyle = {
  id: string; so_id: string; name: string; code: string; colour: string; qty: number; buyer_rate: number; position: number;
  use_sizes: boolean; sizes: Record<string, number | string | null>;
};
export type BDispatch = { id: string; so_id: string; dispatched_at: string; courier: string; tracking: string; invoice_no: string; invoice_date: string };
export type BSample = {
  id: string; sample_type: string; description: string | null; buyer_ref: string | null; fabric: string | null; qty: number; round: number;
  received_on: string | null; due_date: string | null; stage: string; dispatched_on: string | null; courier: string | null; tracking: string | null;
};
export type BOrder = {
  id: string; buyer_po_number: string; so_date: string; buyer_date: string | null; currency: string; milestone: string; order_type: OrderType;
  styles: BStyle[]; dispatches: BDispatch[];
};

export const loadBuyer = cache(async () => {
  const supabase = await createClient();
  const [profile, orders, styles, dcs, samples] = await Promise.all([
    supabase.from("portal_buyer_profile").select("id, code").maybeSingle(),
    supabase.from("portal_buyer_orders").select("*").order("so_date", { ascending: false }),
    supabase.from("portal_buyer_styles").select("*"),
    supabase.from("portal_buyer_dispatches").select("*").order("dispatched_at", { ascending: false }),
    supabase.from("portal_buyer_samples").select("*").order("due_date", { ascending: false, nullsFirst: false }),
  ]);
  const error = [profile, orders, styles, dcs, samples].find((r) => r.error)?.error ?? null;
  const list: BOrder[] = ((orders.data ?? []) as Omit<BOrder, "styles" | "dispatches">[]).map((o) => ({
    ...o,
    styles: ((styles.data ?? []) as BStyle[]).filter((s) => s.so_id === o.id).sort(byPos),
    dispatches: ((dcs.data ?? []) as BDispatch[]).filter((d) => d.so_id === o.id),
  }));
  return { buyer: profile.data as { id: string; code: string } | null, orders: list, samples: (samples.data ?? []) as BSample[], error };
});
