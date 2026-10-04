import { addDays, type OrderType } from "@/lib/model";
import { createClient } from "@/lib/supabase/server";

export type TemplateStep = { name: string; days: number };
export type TnaTemplate = { id: string; name: string; order_type: OrderType; steps: TemplateStep[]; is_default: boolean; active: boolean };

export async function loadTemplates(all = false) {
  const supabase = await createClient();
  let q = supabase.from("tna_templates").select("id, name, order_type, steps, is_default, active").order("is_default", { ascending: false }).order("name");
  if (!all) q = q.eq("active", true);
  const { data } = await q;
  return (data ?? []) as TnaTemplate[];
}

// Dates worked back from the factory delivery date: "Cutting, 18 days before".
export const datesFrom = (steps: TemplateStep[], factoryDate: string) =>
  steps.map((s) => ({ name: s.name, due_date: addDays(factoryDate, -Number(s.days)) }));
