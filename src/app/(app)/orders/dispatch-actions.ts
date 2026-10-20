"use server";

import { revalidatePath } from "next/cache";
import { canEditOrders, getMe } from "@/lib/auth";
import { friendly } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";

type Result = { error?: string };
const num = (s: string) => s.replace(/[,₹\s]/g, "");
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function team() {
  const me = await getMe();
  if (!me?.role || !me.companyId) return null;
  return canEditOrders(me.role) ? me : null;
}

async function run(orderId: string, fn: string, args: Record<string, unknown>): Promise<Result> {
  const supabase = await createClient();
  const { error } = await supabase.rpc(fn, args);
  if (error) return { error: friendly(error) };
  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/today");
  return {};
}

export type PurchaseInput = {
  factory_id: string; bill_no: string; bill_date: string; notes: string;
  lines: { line_id: string; qty: string; purchase_rate: string; sale_rate: string }[];
};

// Step 1: the factory's bill. The 4 hours to invoice the buyer start now.
export async function recordPurchase(orderId: string, p: PurchaseInput): Promise<Result> {
  if (!(await team())) return { error: "Only the orders team can record dispatches." };
  if (!p.factory_id) return { error: "Pick the factory." };
  if (!p.bill_no.trim()) return { error: "Enter the factory's bill number." };
  if (!isDate(p.bill_date)) return { error: "Enter the bill date." };
  const lines = p.lines.filter((l) => num(l.qty) !== "" && Number(num(l.qty)) !== 0);
  if (!lines.length) return { error: "Enter the pieces bought for at least one style." };
  for (const l of lines) {
    const q = Number(num(l.qty));
    if (!Number.isInteger(q) || q <= 0) return { error: "Pieces must be whole numbers above zero." };
    if (!(Number(num(l.purchase_rate)) >= 0) || num(l.purchase_rate) === "") return { error: "Every style needs its purchase rate." };
    if (num(l.sale_rate) !== "" && !(Number(num(l.sale_rate)) >= 0)) return { error: "The sale rate must be a number." };
  }
  // GST is worked out by the database from the styles' rates.
  return run(orderId, "record_purchase", {
    p: {
      order_id: orderId, factory_id: p.factory_id, bill_no: p.bill_no.trim(), bill_date: p.bill_date, notes: p.notes,
      lines: lines.map((l) => ({ line_id: l.line_id, qty: Number(num(l.qty)), purchase_rate: num(l.purchase_rate), sale_rate: num(l.sale_rate) })),
    },
  });
}

// Step 2: the buyer's invoice. It also goes into Payments.
export async function recordDispatchInvoice(orderId: string, id: string, p: { invoice_no: string; invoice_date: string; taxable: string }): Promise<Result> {
  if (!(await team())) return { error: "Only the orders team can record dispatches." };
  if (!p.invoice_no.trim()) return { error: "Enter the invoice number." };
  if (!isDate(p.invoice_date)) return { error: "Enter the invoice date." };
  if (!(Number(num(p.taxable)) >= 0) || num(p.taxable) === "") return { error: "Enter the invoice value before GST." };
  return run(orderId, "record_dispatch_invoice", { p_id: id, p: { invoice_no: p.invoice_no.trim(), invoice_date: p.invoice_date, taxable: num(p.taxable) } });
}

// Files for a dispatch live under <company>/<order>/dispatch/<dispatch>/.
async function filesOk(orderId: string, id: string, paths: string[]) {
  const me = await team();
  return !!me && paths.every((x) => x.startsWith(`${me.companyId}/${orderId}/dispatch/${id}/`) && !x.includes(".."));
}

// Step 3: the e-way bill, with its copy.
export async function recordEwayBill(orderId: string, id: string, p: { no: string; date: string; valid_until: string; path: string }): Promise<Result> {
  if (!(await filesOk(orderId, id, [p.path]))) return { error: "The e-way bill didn't upload properly. Try again." };
  const no = p.no.replace(/\s/g, "");
  if (!/^\d{12}$/.test(no)) return { error: "An e-way bill number has 12 digits." };
  if (!isDate(p.date)) return { error: "Enter the e-way bill date." };
  return run(orderId, "record_eway_bill", { p_id: id, p: { no, date: p.date, valid_until: isDate(p.valid_until) ? p.valid_until : "", path: p.path } });
}

export type ShippingInput = { transporter: string; vehicle_no: string; lr_no: string; lr_date: string; cartons: string; lr_path: string; photos: string[] };

// Step 4: photos of the goods, the transporter and the LR.
export async function recordShipping(orderId: string, id: string, p: ShippingInput): Promise<Result> {
  if (!p.photos.length) return { error: "Add photos of the goods." };
  if (!p.lr_path) return { error: "Attach the LR copy." };
  if (!(await filesOk(orderId, id, [p.lr_path, ...p.photos]))) return { error: "The files didn't upload properly. Try again." };
  if (!p.transporter.trim()) return { error: "Enter the transporter." };
  if (!p.lr_no.trim() || !isDate(p.lr_date)) return { error: "Enter the LR number and date." };
  const cartons = num(p.cartons);
  if (cartons !== "" && !(Number.isInteger(Number(cartons)) && Number(cartons) > 0)) return { error: "Cartons must be a whole number." };
  return run(orderId, "record_shipping", { p_id: id, p: { ...p, transporter: p.transporter.trim(), lr_no: p.lr_no.trim(), cartons } });
}

// Step 5: the buyer's GRN report.
export async function recordGrn(orderId: string, id: string, p: { path: string; received_qty: string; notes: string }): Promise<Result> {
  if (!p.path) return { error: "Attach the GRN report." };
  if (!(await filesOk(orderId, id, [p.path]))) return { error: "The GRN report didn't upload properly. Try again." };
  const q = Number(num(p.received_qty));
  if (num(p.received_qty) === "" || !Number.isInteger(q) || q < 0) return { error: "Enter the pieces the buyer received." };
  return run(orderId, "record_grn", { p_id: id, p: { path: p.path, received_qty: q, notes: p.notes } });
}

export async function cancelDispatch(orderId: string, id: string, reason: string): Promise<Result> {
  if (!(await team())) return { error: "Only the orders team can record dispatches." };
  return run(orderId, "cancel_dispatch", { p_id: id, p_reason: reason });
}
