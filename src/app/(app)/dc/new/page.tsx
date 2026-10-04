import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { isOps } from "@/lib/roles";
import { DcForm } from "../dc-form";
import { dcGrnOptions } from "../options";

export const metadata = { title: "Create delivery challan · Sourcingo OS" };

export default async function NewDc({ searchParams }: PageProps<"/dc/new">) {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/dc");
  const { grn } = await searchParams;
  const { world: w } = await loadWorld();
  const grns = dcGrnOptions(w, null);
  const pick = grns.find((g) => g.id === grn);
  return (
    <DcForm
      id={null}
      grns={grns}
      initial={{
        grn_id: pick?.id ?? "", courier: "", tracking: "", address: pick?.address ?? "", invoice_no: "", invoice_date: w.today,
        dispatched_at: new Date(w.now).toISOString(), lines: Object.fromEntries((pick?.lines ?? []).map((l) => [l.style_id, String(l.avail)])),
      }}
    />
  );
}
