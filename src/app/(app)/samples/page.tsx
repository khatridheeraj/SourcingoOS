import Link from "next/link";
import { redirect } from "next/navigation";
import { BuyerCode, Empty, Head, Pills, Tile } from "@/components/bits";
import { AutoForm, ClickRow, SearchParamInput } from "@/components/feedback";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { loadSampleCovers } from "@/lib/files";
import { addDays, fmtDay, isOpenSample, nf, type Sample, sampleDaysLeft, sampleOnTime, sampleOrder, sampleTitle, sampleTypeLabel, vendorLate } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { dueText, SampleChip, SampleDue, Thumb } from "./bits";

export const metadata = { title: "Samples · Sourcingo OS" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "late", label: "Late or at risk" },
  { key: "week", label: "Due this week" },
  { key: "sent", label: "Waiting for buyer" },
  { key: "changes", label: "Changes asked" },
  { key: "done", label: "Closed" },
  { key: "all", label: "All" },
];

export default async function SamplesPage({ searchParams }: PageProps<"/samples">) {
  const me = await getMe();
  if (!me?.role || !["owner", "merchandiser", "manager", "qc", "accounts"].includes(me.role)) redirect("/");
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.show) ? String(sp.show) : "open";
  const q = String(sp.q ?? "").trim().toLowerCase();
  const buyer = String(sp.buyer ?? "");
  const vendor = String(sp.vendor ?? "");
  const { world: w, error } = await loadWorld();
  const t = w.today;

  const atRisk = (s: Sample) => {
    if (!isOpenSample(s)) return false;
    const d = sampleDaysLeft(s, t);
    return d === null || d <= 1 || vendorLate(s, t);
  };
  const match: Record<string, (s: Sample) => boolean> = {
    open: isOpenSample,
    late: atRisk,
    week: (s) => isOpenSample(s) && !!s.due_date && s.due_date <= addDays(t, 7),
    sent: (s) => s.status === "dispatched",
    changes: (s) => s.status === "changes",
    done: (s) => ["approved", "rejected", "cancelled"].includes(s.status),
    all: () => true,
  };
  const name = (s: Sample) => {
    const b = w.buyerById.get(s.buyer_id);
    return [b?.code, w.isOwner ? b?.real_name : ""].join(" ");
  };
  const list = w.samples
    .filter(match[filter])
    .filter((s) => (!buyer || s.buyer_id === buyer) && (!vendor || s.factory_id === vendor))
    .filter((s) => !q || [s.id, s.description, s.buyer_ref, s.fabric, s.remarks, s.tracking, name(s), w.factoryName(s.factory_id)].join(" ").toLowerCase().includes(q))
    .sort(sampleOrder);
  const covers = await loadSampleCovers(list.slice(0, 200).map((s) => s.id));

  const open = w.samples.filter(isOpenSample);
  const late = open.filter((s) => s.due_date && s.due_date < t).length;
  const soon = open.filter((s) => s.due_date && s.due_date >= t && s.due_date <= addDays(t, 3)).length;
  const sent60 = w.samples.filter((s) => s.dispatched_on && s.dispatched_on >= addDays(t, -60) && sampleOnTime(s) !== null);
  const onTime = sent60.filter((s) => sampleOnTime(s)).length;
  const href = (k: string) => {
    const p = new URLSearchParams({ show: k });
    if (q) p.set("q", q);
    if (buyer) p.set("buyer", buyer);
    if (vendor) p.set("vendor", vendor);
    return `/samples?${p}`;
  };
  const counts = Object.fromEntries(FILTERS.map((f) => [f.key, w.samples.filter(match[f.key]).length]));
  const usedVendors = w.factories.filter((f) => w.samples.some((s) => s.factory_id === f.id));
  const usedBuyers = w.buyers.filter((b) => w.samples.some((s) => s.buyer_id === b.id));

  return (
    <>
      <Head crumbs="Sales › Samples" title="Samples" sub="Every buyer sample from the day it arrives to the day it's sent back. Each one must reach the buyer on or before its due date.">
        {isOps(me.role) && <Link className="btn primary" href="/samples/new">+ Log sample</Link>}
      </Head>
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      <div className="tiles">
        <Tile tone="blue" label="Open samples" value={open.length} note={`${open.filter((s) => s.status === "with_vendor").length} with vendors`} href={href("open")} />
        <Tile tone="yellow" label="Due in 3 days" value={soon} note="Today included" href={href("week")} />
        <Tile alarm={late > 0} label="Late" value={late} note={late ? "Past the buyer's date" : "Must be zero"} href={href("late")} />
        <Tile tone="green" label="Ready to send" value={open.filter((s) => s.status === "ready").length} note="Back from the vendor" href={href("open")} />
        <Tile tone="pink" label="On time, last 60 days" value={sent60.length ? `${Math.round((onTime / sent60.length) * 100)}%` : "—"} note={`${onTime} of ${sent60.length} sent by the due date`} />
      </div>

      <div className="row">
        <SearchParamInput placeholder="Search sample, fabric, buyer, vendor" />
        <AutoForm className="row">
          <input type="hidden" name="show" value={filter} />
          {q && <input type="hidden" name="q" value={q} />}
          <select name="buyer" defaultValue={buyer} className="inp" style={{ width: "auto" }} aria-label="Buyer">
            <option value="">All buyers</option>
            {usedBuyers.map((b) => <option key={b.id} value={b.id}>{b.code}{w.isOwner && b.real_name ? ` · ${b.real_name}` : ""}</option>)}
          </select>
          <select name="vendor" defaultValue={vendor} className="inp" style={{ width: "auto" }} aria-label="Vendor">
            <option value="">All vendors</option>
            {usedVendors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </AutoForm>
      </div>
      <Pills current={filter} items={FILTERS.map((f) => ({ key: f.key, label: `${f.label}${f.key === "late" ? "" : ` · ${counts[f.key]}`}`, href: href(f.key), n: f.key === "late" ? counts.late : undefined }))} />

      {list.length ? (
        <>
          <div className="table-wrap hidden md:block">
            <table className="tbl">
              <thead>
                <tr><th></th><th>Sample</th><th>Buyer</th><th>Vendor</th><th>Received</th><th>To vendor</th><th>Due</th><th>Status</th><th>Sent</th></tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <ClickRow key={s.id} href={`/samples/${s.id}`}>
                    <td style={{ width: 56 }}><Thumb url={covers.get(s.id)} label={sampleTitle(s)} /></td>
                    <td>
                      <Link href={`/samples/${s.id}`} className="font-semibold hover:text-accent">{sampleTitle(s)}</Link>
                      <div className="text-xs text-muted">
                        <span className="code">{s.id}</span>
                        {s.description && s.fabric && ` · ${s.fabric}`}
                        {s.buyer_ref && ` · ref ${s.buyer_ref}`}
                        {s.qty > 1 && ` · ${nf(s.qty)} pcs`}
                        {s.sample_type !== "development" && ` · ${sampleTypeLabel(s.sample_type)}`}
                      </div>
                    </td>
                    <td><BuyerCode buyer={w.buyerById.get(s.buyer_id)} /></td>
                    <td>{s.factory_id ? w.factoryName(s.factory_id) : <span className="text-muted">—</span>}</td>
                    <td className="whitespace-nowrap">{fmtDay(s.received_on)}</td>
                    <td className="whitespace-nowrap">
                      {fmtDay(s.issued_on)}
                      {s.vendor_due && s.status === "with_vendor" && <div className="text-xs text-muted">back by {fmtDay(s.vendor_due)}</div>}
                    </td>
                    <td className="whitespace-nowrap"><b>{dueText(s)}</b><div className="mt-0.5"><SampleDue s={s} today={t} /></div></td>
                    <td><SampleChip s={s} /></td>
                    <td className="whitespace-nowrap">{fmtDay(s.dispatched_on)}</td>
                  </ClickRow>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cards md:hidden">
            {list.map((s) => (
              <Link key={s.id} href={`/samples/${s.id}`} className="card portal-card">
                <div className="row" style={{ flexWrap: "nowrap" }}>
                  <Thumb url={covers.get(s.id)} label={sampleTitle(s)} />
                  <div className="grow min-w-0">
                    <b className="block truncate">{sampleTitle(s)}</b>
                    <span className="code text-muted">{s.id}</span> · <BuyerCode buyer={w.buyerById.get(s.buyer_id)} />
                  </div>
                </div>
                <div className="row"><SampleChip s={s} /><SampleDue s={s} today={t} /></div>
                <div className="meta">
                  <span>Due <b>{dueText(s)}</b></span>
                  {s.factory_id && <span>Vendor <b>{w.factoryName(s.factory_id)}</b></span>}
                  {s.dispatched_on && <span>Sent <b>{fmtDay(s.dispatched_on)}</b></span>}
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <Empty title={w.samples.length ? "No samples match" : "No samples yet"}>
          {w.samples.length ? "Try another filter or search." : "Log a sample the day it arrives from the buyer, with the date they need it back."}
        </Empty>
      )}
    </>
  );
}
