import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Attachments } from "@/components/attachments";
import { BuyerCode } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { CATEGORIES_FOR } from "@/lib/file-kinds";
import { loadFiles } from "@/lib/files";
import { fmtDateTime } from "@/lib/format";
import { fmtDay, nf, SAMPLE_LABEL, SAMPLE_STEPS, sampleDaysLeft, sampleStep, sampleTitle, sampleTypeLabel, type SampleStatus } from "@/lib/model";
import { isInternal, isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { SampleChip, SampleDue } from "../bits";
import { sampleOptions } from "../options";
import { NextStep } from "./next-step";
import { DeleteSample, Details, NoteForm } from "./parts";
import { History } from "@/components/history";

export async function generateMetadata({ params }: PageProps<"/samples/[id]">) {
  return { title: `${(await params).id} · Sourcingo OS` };
}

type Event = { id: string; kind: "status" | "note"; from_status: SampleStatus | null; to_status: SampleStatus | null; round: number | null; note: string | null; created_by: string | null; created_at: string };

export default async function SamplePage({ params, searchParams }: PageProps<"/samples/[id]">) {
  const me = await getMe();
  if (!me || !isInternal(me.role)) redirect("/");
  const { id } = await params;
  const isNew = (await searchParams).new === "1";
  const { world: w } = await loadWorld();
  const s = w.samples.find((x) => x.id === id);
  if (!s) notFound();
  const ops = isOps(me.role);
  const t = w.today;
  const supabase = await createClient();
  const [files, events] = await Promise.all([
    loadFiles("sample", [s.id], w.personName).then((m) => m.get(s.id) ?? []),
    supabase.from("sample_events").select("*").eq("sample_id", s.id).order("created_at", { ascending: false }),
  ]);
  const history = (events.data ?? []) as Event[];
  const step = sampleStep(s.status);
  const left = sampleDaysLeft(s, t);
  const vendor = w.factoryName(s.factory_id);
  const opts = sampleOptions(w, { vendor: s.factory_id });

  const view = (
    <div className="stack">
      <div className="dl">
        <div><span>Buyer</span><b><BuyerCode buyer={w.buyerById.get(s.buyer_id)} /></b></div>
        <div><span>Type</span><b>{sampleTypeLabel(s.sample_type)}</b></div>
        <div><span>Fabric</span><b>{s.fabric || "—"}</b></div>
        <div><span>Buyer&apos;s ref</span><b>{s.buyer_ref || "—"}</b></div>
        <div><span>Pieces</span><b>{nf(s.qty)}</b></div>
        <div><span>Merchandiser</span><b>{s.merchandiser_id ? w.personName(s.merchandiser_id) : "Unassigned"}</b></div>
        <div><span>Received</span><b>{fmtDay(s.received_on)}</b></div>
        <div><span>Due to buyer</span><b>{fmtDay(s.due_date)}</b></div>
        <div><span>{s.status === "received" ? "Planned vendor" : "Vendor"}</span><b>{s.factory_id ? vendor : "—"}</b></div>
        <div><span>Given to vendor</span><b>{fmtDay(s.issued_on)}</b></div>
        <div><span>Vendor to return by</span><b>{fmtDay(s.vendor_due)}</b></div>
        <div><span>Back from vendor</span><b>{fmtDay(s.ready_on)}</b></div>
        <div><span>Sent to buyer</span><b>{fmtDay(s.dispatched_on)}</b></div>
        <div><span>Courier</span><b>{[s.courier, s.tracking].filter(Boolean).join(" · ") || "—"}</b></div>
      </div>
      {s.feedback && <p className="text-[13px]"><b>Buyer&apos;s feedback:</b> {s.feedback}</p>}
      {s.remarks && <p className="whitespace-pre-line text-[13px]"><b>Remarks:</b> {s.remarks}</p>}
    </div>
  );

  return (
    <div className="stack">
      <div className="crumbs">Sales › <Link className="link" href="/samples">Samples</Link> › {s.id}</div>
      <div className="head">
        <div className="grow">
          <h1>{sampleTitle(s)} <SampleChip s={s} /> <SampleDue s={s} today={t} /></h1>
          <p>
            <span className="code">{s.id}</span> · <BuyerCode buyer={w.buyerById.get(s.buyer_id)} />
            {s.round > 1 && ` · round ${s.round}`} · logged {fmtDateTime(s.created_at)}{s.created_by ? ` by ${w.personName(s.created_by)}` : ""}
          </p>
        </div>
        {me.role === "owner" && <DeleteSample id={s.id} />}
      </div>
      {isNew && <p className="okbox">Logged {s.id}. Add the buyer&apos;s photos or reference files below so the vendor knows exactly what to make.</p>}

      <section className="panel">
        <div className="row">
          <div className="grow">
            <span className="sub">Buyer needs it by</span>
            <div className="font-display text-[26px] leading-tight">{s.due_date ? fmtDay(s.due_date) : "No due date set"}</div>
          </div>
          {left !== null && step >= 0 && step < 3 && (
            <span className={`text-right text-sm font-semibold ${left < 0 ? "text-bad" : left <= 2 ? "text-warn" : "text-muted"}`}>
              {left < 0 ? `${-left} day${left === -1 ? "" : "s"} late` : left === 0 ? "Due today" : `${left} day${left === 1 ? "" : "s"} left`}
            </span>
          )}
        </div>
        {step >= 0 ? (
          <div className="steps" aria-label={`Step: ${SAMPLE_LABEL[s.status]}`}>
            {SAMPLE_STEPS.map((label, i) => (
              <div key={label} className={`step ${i < step || (i === 4 && step === 4) ? "done" : ""} ${i === step ? "now" : ""}`}>
                {i === 4 && step === 4 ? SAMPLE_LABEL[s.status] : label}
              </div>
            ))}
          </div>
        ) : null}
        {!s.due_date && <p className="warnbox mt-3">Ask the buyer when they need this and set the due date{ops ? " with Edit below" : ""}, so reminders work.</p>}
      </section>

      {ops && <NextStep s={s} vendors={opts.vendors} today={t} vendorName={vendor} />}

      <div className="two">
        <div className="stack">
          <Details s={s} canEdit={ops} view={view} {...opts} today={t} meId={me.id} isOwner={me.role === "owner"} />
          <section className="panel">
            <Attachments target="sample" id={s.id} files={files} upload={ops ? CATEGORIES_FOR.sample : []} canDeleteAll={ops}
              title="Photos & references" empty="No photos yet. Add the buyer's sample, references and the vendor's progress photos." />
          </section>
        </div>
        <section className="panel">
          <h3>History</h3>
          <div className="stack">
            {ops && <NoteForm id={s.id} />}
            {history.length ? (
              <ul className="hist">
                {history.map((e) => (
                  <li key={e.id}>
                    <time>{fmtDateTime(e.created_at)} · {e.created_by ? w.personName(e.created_by) : "Imported"}</time>
                    {e.kind === "note" ? e.note : e.from_status
                      ? <>Moved to <b>{SAMPLE_LABEL[e.to_status!]}</b>{e.round && e.round > 1 ? ` (round ${e.round})` : ""}</>
                      : <>Logged as <b>{SAMPLE_LABEL[e.to_status!]}</b></>}
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted">Nothing yet.</p>}
          </div>
        </section>
      </div>
      <History table="samples" id={s.id} w={w} />
    </div>
  );
}
