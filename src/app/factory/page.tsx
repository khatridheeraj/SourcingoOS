import { cookies } from "next/headers";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET } from "@/lib/storage";
import { FactoryOrder, type PanelOrder, type StyleInfo } from "./factory-order";
import type { FactoryUpdate } from "./step-update";
import type { FactoryRound } from "./factory-samples";
import { LANG_COOKIE, langOf, words } from "./i18n";

export default async function FactoryPage() {
  const supabase = await createClient();
  const [me, { data, error }, { data: ups }, { data: fileRows }, { data: detailRows }, { data: sampleRows }] = await Promise.all([
    getMe(), supabase.rpc("factory_tna"), supabase.rpc("factory_step_updates"),
    // Each style's tech pack, cutting program, fabric and sizes, as the orders team entered them.
    supabase.rpc("factory_line_files"), supabase.rpc("factory_line_details"),
    // Every sample round of its styles, with Sourcingo's and the buyer's answers.
    supabase.rpc("factory_samples"),
  ]);
  const files = (fileRows ?? []) as { line_id: string; kind: string; path: string; file_name: string | null }[];
  const rawRounds = (sampleRows ?? []) as (Omit<FactoryRound, "photos" | "answerPhotos"> & { photos: string[]; answer_photos: string[] })[];
  const paths = [...files.map((f) => f.path), ...rawRounds.flatMap((r) => [...r.photos, ...r.answer_photos])];
  const { data: signed } = paths.length ? await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, 3600) : { data: [] };
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
  const rounds: FactoryRound[] = rawRounds.map(({ answer_photos, ...r }) => ({
    ...r, photos: r.photos.map((p) => urlOf.get(p)).filter((u): u is string => !!u), answerPhotos: answer_photos.map((p) => urlOf.get(p)).filter((u): u is string => !!u),
  }));
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
          {/* The dates rule matters only while a PO waits for the factory's dates. */}
          {waiting.length > 0 && <p className="show-phone">{w.introPhone}</p>}
          {waiting.length > 0 && <p className="hide-phone">{w.intro}</p>}
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
          {panel.orders.map((o) => <FactoryOrder key={o.order_id} order={o} now={now} companyId={me?.companyId ?? ""} updates={updates} rounds={rounds.filter((r) => r.order_id === o.order_id)} lang={lang} info={info} />)}
        </>
      )}
    </>
  );
}
