import { cookies } from "next/headers";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PHOTO_BUCKET } from "@/lib/storage";
import { FactoryOrder, type PanelOrder, type StyleInfo } from "./factory-order";
import type { FactoryUpdate } from "./step-update";
import type { FactoryRound } from "./factory-samples";
import type { PanelPo } from "./factory-po";
import { FactoryMoney, type FactoryMoneyData } from "./factory-money";
import type { FactoryCheck } from "./factory-qc";
import type { FactoryCount } from "./factory-counts";
import type { DateAsk } from "./factory-date-ask";
import type { ReadyNotice } from "./factory-ready";
import { LANG_COOKIE, langOf, words } from "./i18n";
import { FactoryRecordCard } from "./factory-record";
import { FactoryGuarantee, type FactoryGuaranteeData } from "./factory-guarantee";
import type { RecordFacts } from "@/lib/factory-record";
import type { FactoryCap } from "@/lib/capacity";
import { todayIST } from "@/lib/format";
import { addDays } from "@/lib/buyer-week";
import { CapacityWeeks } from "@/components/capacity-weeks";
import { type CertRow, FactoryCerts } from "@/components/factory-certs";
import { FactoryProfileCard } from "@/components/factory-profile";
import { type FactoryProfile, onboardingSteps, visitState } from "@/lib/onboarding";
import { askVisit, removeMyCert, saveMyCapacity, saveMyCert, saveMyDetails, saveMyPaper, saveMyProfile } from "./actions";
import { FactoryKycCard } from "@/components/factory-kyc-card";
import type { PaperRow } from "@/components/factory-papers";
import { InviteCard } from "@/components/invite-card";
import { factoryInvite, isRef } from "@/lib/referral";

// Asking a factory to bring others: in the words used on the floor.
const INVITE = {
  en: {
    title: "Know a good factory?",
    text: "Send them your link to ask to join Sourcingo. We'll know you sent them.",
    message: "I get orders from Sourcingo, with clear dates and payments on time. Ask to join here:",
    words: { share: "Send on WhatsApp", copy: "Copy link", copied: "Link copied." },
  },
  hi: {
    title: "कोई अच्छी फैक्ट्री जानते हैं?",
    text: "उन्हें अपना लिंक भेजें ताकि वे Sourcingo से जुड़ने को कहें। हमें पता रहेगा कि उन्हें आपने भेजा।",
    message: "मुझे Sourcingo से ऑर्डर मिलते हैं, साफ़ तारीखें और समय पर पेमेंट। यहाँ जुड़ने के लिए कहें:",
    words: { share: "WhatsApp पर भेजें", copy: "लिंक कॉपी करें", copied: "लिंक कॉपी हुआ।" },
  },
} as const;

// The factory's panel. `preview` is a factory's id when the orders team is looking at it from inside the app:
// the same panel, read for that factory, with nothing to press.
export async function FactoryView({ preview }: { preview?: string }) {
  const supabase = await createClient(preview ? { "x-preview-factory": preview } : undefined);
  const [me, { data, error }, { data: ups }, { data: fileRows }, { data: detailRows }, { data: sampleRows }, { data: poRows }, { data: moneyRow }, { data: qcRows }, { data: countRows }, { data: askRows }, { data: readyRows }, { data: recordRow }, { data: guarRow }, { data: certRows }, { data: capRow }, { data: fixRows }, { data: rateRow }, { data: profRow }, { data: refCode }, { data: kycRow }] = await Promise.all([
    getMe(), supabase.rpc("factory_tna"), supabase.rpc("factory_step_updates"),
    // Each style's tech pack, cutting program, fabric and sizes, as the orders team entered them.
    supabase.rpc("factory_line_files"), supabase.rpc("factory_line_details"),
    // Every sample round of its styles, with Sourcingo's and the buyer's answers.
    supabase.rpc("factory_samples"),
    // The factory POs Sourcingo has sent, to open and accept.
    supabase.rpc("factory_po_list"),
    // Its bills and payments, from Sourcingo's accounts.
    supabase.rpc("factory_money"),
    // What Sourcingo's Quality team found on its styles.
    supabase.rpc("factory_qc"),
    // Its last piece count (cut, stitched, packed) on each style.
    supabase.rpc("factory_counts_mine"),
    // Its asks for a new date on a step, and Sourcingo's answers.
    supabase.rpc("factory_date_asks_mine"),
    // Its goods-ready notices, and whether Sourcingo saw them.
    supabase.rpc("factory_ready_mine"),
    // Its record: what buyers and Sourcingo choose factories by.
    supabase.rpc("factory_record_mine"),
    // The Sourcingo Guarantee: when it is paid for each order (nothing until the Guarantee is on).
    supabase.rpc("factory_guarantee"),
    // Its certificates, and the free pieces it gave week by week.
    supabase.rpc("factory_certificates_mine"), supabase.rpc("factory_capacity_mine", { p_weeks: 8 }),
    // The defects Sourcingo found most on its styles lately, and buyers' average rating (once three have rated).
    supabase.rpc("factory_defects_mine"), supabase.rpc("factory_rating_mine"),
    // Its profile: what it makes, floor photos and its visit (0110).
    supabase.rpc("factory_profile_mine"),
    // Its own invite link for factories it knows.
    supabase.rpc("my_referral_code"),
    // Its full details and papers, and what is still missing before Sourcingo can send it a PO (0135).
    supabase.rpc("factory_details_mine"),
  ]);
  const profile = profRow as FactoryProfile | null;
  const counts = (countRows ?? []) as FactoryCount[];
  const asks = (askRows ?? []) as DateAsk[];
  const ready = (readyRows ?? []) as ReadyNotice[];
  const pos = (poRows ?? []) as PanelPo[];
  const toAccept = pos.filter((p) => !p.accepted_at && (data as { orders?: { order_id: string }[] } | null)?.orders?.some((o) => o.order_id === p.order_id)).length;
  const files = (fileRows ?? []) as { line_id: string; kind: string; path: string; file_name: string | null }[];
  const rawRounds = (sampleRows ?? []) as (Omit<FactoryRound, "photos" | "answerPhotos"> & { photos: string[]; answer_photos: string[] })[];
  const rawChecks = (qcRows ?? []) as (Omit<FactoryCheck, "photos" | "reports"> & { files: { path: string; kind: string; name: string | null }[] })[];
  const allCerts = (certRows ?? []) as (Omit<CertRow, "url"> & { path: string | null; kind?: string })[];
  const rawCerts = allCerts.filter((c) => (c.kind ?? "cert") === "cert");
  const rawPapers = allCerts.filter((c) => (c.kind ?? "cert") !== "cert");
  const paths = [...(profile?.photos ?? []), ...allCerts.flatMap((c) => (c.path ? [c.path] : [])), ...files.map((f) => f.path), ...rawRounds.flatMap((r) => [...r.photos, ...r.answer_photos]), ...rawChecks.flatMap((c) => c.files.map((f) => f.path))];
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
  const checks: FactoryCheck[] = rawChecks.map(({ files: qf, ...c }) => ({
    ...c,
    photos: qf.filter((f) => f.kind !== "report").map((f) => urlOf.get(f.path)).filter((u): u is string => !!u),
    reports: qf.filter((f) => f.kind === "report").flatMap((f) => { const url = urlOf.get(f.path); return url ? [{ name: f.name || "Report", url }] : []; }),
  }));
  const panel = (data ?? { factory: "", orders: [] }) as { factory: string; orders: PanelOrder[] };
  const waiting = panel.orders.filter((o) => !o.released_at);
  const now = new Date().toISOString();
  const certs: CertRow[] = rawCerts.map(({ path, ...c }) => ({ ...c, url: path ? urlOf.get(path) ?? null : null }));
  const papers = rawPapers.map(({ path, ...c }) => ({ ...c, url: path ? urlOf.get(path) ?? null : null })) as unknown as PaperRow[];
  const kyc = kycRow as (Record<string, string | number | null> & { missing: string[] | null; total: number | null }) | null;
  const kycStr = (k: string) => (kyc?.[k] == null ? "" : String(kyc[k]));
  const cap = capRow as FactoryCap | null;
  const factoryId = (recordRow as RecordFacts | null)?.factory_id ?? cap?.factory_id ?? "";
  const canWrite = me?.role === "factory";
  const lang = langOf((await cookies()).get(LANG_COOKIE)?.value);
  const w = words(lang);
  const today = todayIST();
  const verifiedOn = (recordRow as RecordFacts | null)?.verified?.visited_on ?? null;
  const capGiven = !!cap?.weeks.some((x) => x.free != null && x.said_at && x.said_at.slice(0, 10) >= addDays(today, -21));
  const steps = profile ? onboardingSteps(profile, capGiven, verifiedOn, today) : [];
  // A new factory (no orders yet, steps still open) sees its steps first; a working one finds its profile further down.
  const gettingReady = panel.orders.length === 0 && steps.length > 0 && !steps.every((x) => x.done);
  const kycMissing = kyc?.missing ?? [];
  const kycCard = kyc && (
    <FactoryKycCard mode="factory" lang={lang} canEdit={canWrite} today={today} papers={papers}
      folder={`${me?.companyId}/factory-files/${kycStr("factory_id")}/certs`} gaps={{ missing: kycMissing, total: kyc.total ?? 15 }}
      details={{
        legal_name: kycStr("legal_name"), gstin: kycStr("gstin"), no_gst_reason: kycStr("no_gst_reason"), pan: kycStr("pan"), udyam_no: kycStr("udyam_no"),
        address: kycStr("address"), city: kycStr("city"), state: kycStr("state"), pin: kycStr("pin"), contact_name: kycStr("contact_name"), phone: kycStr("phone"),
        whatsapp: kycStr("whatsapp"), email: kycStr("email"), bank_holder: kycStr("bank_holder"), bank_account: kycStr("bank_account"), bank_ifsc: kycStr("bank_ifsc"),
        bank_name: kycStr("bank_name"), pay_days: kycStr("pay_days"),
      }}
      actions={{ save: saveMyDetails, savePaper: saveMyPaper }} />
  );
  const profileCard = profile && factoryId && (
    <FactoryProfileCard profile={profile} photoUrls={Object.fromEntries(profile.photos.flatMap((p) => { const u = urlOf.get(p); return u ? [[p, u]] : []; }))}
      steps={steps} visit={visitState(profile, verifiedOn, today)} folder={`${me?.companyId}/factory-files/${factoryId}/photos`} mode="factory" lang={lang}
      canEdit={canWrite} today={today} save={saveMyProfile} ask={askVisit} onboarding={gettingReady} />
  );
  
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
      {kycMissing.length > 0 && kycCard}
      {gettingReady && profileCard}
      {panel.orders.length === 0 ? (gettingReady ? null : 
        <div className="empty"><b>{w.noOrders}</b>{w.noOrdersSub}</div>
      ) : (
        <>
          {waiting.length > 0 && (
            <p className="text-[13px] font-semibold text-warn">
              {w.needDates(waiting.length)}
            </p>
          )}
          {toAccept > 0 && <p className="text-[13px] font-semibold text-warn">{w.posToAccept(toAccept)}</p>}
          {panel.orders.map((o) => <FactoryOrder key={o.order_id} order={o} now={now} companyId={me?.companyId ?? ""} updates={updates} rounds={rounds.filter((r) => r.order_id === o.order_id)} lang={lang} info={info} po={pos.find((p) => p.order_id === o.order_id)} checks={checks.filter((c) => c.order_id === o.order_id)} counts={counts} asks={asks} ready={ready} canWrite={me?.role === "factory"} />)}
        </>
      )}
      <FactoryRecordCard facts={(recordRow ?? null) as RecordFacts | null} lang={lang}
        fix={(fixRows ?? []) as { defect: string; pieces: number; checks: number }[]} rating={rateRow as { ratings: number; average: number } | null} />
      {!gettingReady && profileCard}
      {kycMissing.length === 0 && kycCard}
      {cap && <CapacityWeeks weeks={cap.weeks} mode="factory" lang={lang} canEdit={canWrite} save={saveMyCapacity} />}
      {factoryId && <FactoryCerts rows={certs} today={today} folder={`${me?.companyId}/factory-files/${factoryId}/certs`} mode="factory" lang={lang}
        canEdit={canWrite} actions={{ save: saveMyCert, remove: removeMyCert }} />}
      <FactoryGuarantee data={(guarRow ?? null) as FactoryGuaranteeData | null} lang={lang} preview={!!preview} />
      {moneyRow && <FactoryMoney data={moneyRow as FactoryMoneyData} lang={lang} />}
      {isRef(refCode as string | null) && (
        <InviteCard id="finvite-h" link={factoryInvite(refCode as string)} {...INVITE[lang]} />
      )}
    </>
  );
}

