import { cookies } from "next/headers";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET } from "@/lib/storage";
import { FactoryOrder, type PanelOrder, type StyleInfo } from "./factory-order";
import type { FactoryUpdate } from "./step-update";
import { LANG_COOKIE, langOf, words } from "./i18n";

export default async function FactoryPage() {
  const supabase = await createClient();
  const [me, { data, error }, { data: ups }, { data: fileRows }, { data: detailRows }] = await Promise.all([
    getMe(), supabase.rpc("factory_tna"), supabase.rpc("factory_step_updates"),
    // Each style's tech pack, cutting program, fabric and sizes, as the orders team entered them.
    supabase.rpc("factory_line_files"), supabase.rpc("factory_line_details"),
  ]);
  const files = (fileRows ?? []) as { line_id: string; kind: string; path: string; file_name: string | null }[];
  const { data: signed } = files.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(files.map((f) => f.path), 3600) : { data: [] };
  const urlOf = new Map((signed ?? []).filter((x) => x.signedUrl).map((x) => [x.path, x.signedUrl]));
  const info: Record<string, StyleInfo> = {};
  const infoOf = (id: string) => (info[id] ??= { fabric: "", sizes: {}, files: [] });
  for (const d of (detailRows ?? []) as { line_id: string; fabric: string | null; sizes: Record<string, number> | null }[]) {
    Object.assign(infoOf(d.line_id), { fabric: d.fabric ?? "", sizes: d.sizes ?? {} });
  }
  for (const f of files) {
    const url = urlOf.get(f.path);
    if (url) infoOf(f.line_id).files.push({ kind: f.kind, name: f.file_name || (f.kind === "cutting" ? "Cutting program" : "Tech pack"), url });
  }
  const updates = (ups ?? []) as FactoryUpdate[];
  const panel = (data ?? { factory: "", orders: [] }) as { factory: string; orders: PanelOrder[] };
  const waiting = panel.orders.filter((o) => !o.released_at);
  const now = new Date().toISOString();
  const lang = langOf((await cookies()).get(LANG_COOKIE)?.value);
  const w = words(lang);

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>{panel.factory || w.yourPos}</h1>
          <p className="show-phone">{w.introPhone}</p>
          <p className="hide-phone">{w.intro}</p>
        </div>
      </div>
      {error && <div className="errbox">{error.message}</div>}
      {panel.orders.length === 0 ? (
        <div className="empty"><b>{w.noOrders}</b>{w.noOrdersSub}</div>
      ) : (
        <>
          {waiting.length > 0 && (
            <p className="text-[13px] font-semibold text-warn">
              {w.needDates(waiting.length)}
            </p>
          )}
          {panel.orders.map((o) => <FactoryOrder key={o.order_id} order={o} now={now} companyId={me?.companyId ?? ""} updates={updates} lang={lang} info={info} />)}
        </>
      )}
    </>
  );
}
