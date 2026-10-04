import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { cleanupList } from "@/lib/cleanup";
import { loadWorld } from "@/lib/data";
import { fmtDay, nf, sampleTitle } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { loadTemplates } from "@/lib/tna";
import { DateFill, OrderFill, RateFill, ShippedList, TemplatePicker } from "./parts";

export const metadata = { title: "Fix my data · Sourcingo OS" };

const MAX = 60;

function Section({ id, n, title, why, children }: { id: string; n: number; title: string; why: string; children: React.ReactNode }) {
  return (
    <section id={id} className="panel scroll-mt-20">
      <div className="row mb-1">
        <h2 className="grow text-[17px] font-bold">{title}</h2>
        {n ? <span className="chip warn">{n} to fix</span> : <span className="chip ok">All done</span>}
      </div>
      <p className="mb-3 text-[13px] text-muted">{why}</p>
      {n > 0 && children}
      {n > MAX && <p className="mt-2 text-xs text-muted">Showing the first {MAX}. Fix these and the next ones appear.</p>}
    </section>
  );
}

// A to-do list for the team: every gap that keeps alerts, factory POs and
// reports from being right, with the fix next to it.
export default async function Cleanup() {
  const me = await getMe();
  if (!isOps(me?.role)) redirect("/");
  const { world: w } = await loadWorld();
  const c = cleanupList(w);
  const templates = await loadTemplates();
  const supabase = await createClient();
  const { count: newPos } = await supabase.from("received_pos").select("id", { count: "exact", head: true }).eq("status", "new");
  const canClose = me?.role === "owner" || me?.role === "manager";
  const people = w.people.filter((p) => p.active && ["merchandiser", "manager", "owner"].includes(p.role ?? "")).map((p) => ({ id: p.id, label: p.full_name || p.email }));
  const managers = w.people.filter((p) => p.active && ["manager", "owner"].includes(p.role ?? "")).map((p) => ({ id: p.id, label: p.full_name || p.email }));
  const factories = w.factories.filter((f) => f.active).map((f) => ({ id: f.id, label: f.city ? `${f.name} · ${f.city}` : f.name }));
  const label = (o: { buyer_po_number: string; buyer_id: string; factory_id: string | null }) =>
    `#${o.buyer_po_number} · ${w.buyerCode(o.buyer_id)} · ${w.factoryName(o.factory_id)}`;
  const steps = [
    ["shipped", "Close shipped orders", c.pastBuyer.length], ["tna", "Add TNAs", c.noTna.length], ["people", "Assign people", c.noMerch.length],
    ["factory", "Pick factories", c.noFactory.length], ["dates", "Add dates", c.noDates.length], ["rates", "Factory rates", c.noRate.length],
    ["samples", "Sample due dates", c.samples.length], ["inquiries", "Follow-ups", c.inquiries.length],
  ] as const;

  return (
    <>
      <Head title="Fix my data" sub="Work down this list once. When it's empty, every alert, factory PO and report in the app is accurate." />
      <nav className="filters" aria-label="Sections">
        {steps.map(([id, l, n]) => (
          <a key={id} href={`#${id}`} className="pill">{l} {n ? <span className="ml-1 rounded-full bg-warn px-1.5 text-xs text-white">{n}</span> : "✓"}</a>
        ))}
        {!!newPos && <Link href="/pos?status=new" className="pill">POs received <span className="ml-1 rounded-full bg-bad px-1.5 text-xs text-white">{newPos}</span></Link>}
      </nav>
      {c.total === 0 && <p className="okbox">Everything is filled in. Nice work.</p>}

      <Section id="shipped" n={c.pastBuyer.length} title="Running orders past the buyer date"
        why="These are still marked running though the buyer date passed over a week ago. If they've shipped, tick them and mark them shipped so they stop raising alerts. If not, update the TNA instead.">
        <ShippedList canClose={canClose} rows={c.pastBuyer.slice(0, MAX).map((o) => ({ id: o.id, label: label(o), date: o.buyer_date }))} />
      </Section>

      <Section id="tna" n={c.noTna.length} title="Running orders without a TNA"
        why="Without steps, nobody gets warned before a delivery slips. Pick a template; the dates are worked back from the factory delivery date and the factory sees them at once.">
        <div className="list-rows">
          {c.noTna.slice(0, MAX).map((o) => (
            <div key={o.id}>
              <span className="grow"><Link className="code text-accent" href={`/orders/${o.id}`}>{o.id}</Link> <span className="text-muted">{label(o)} · {o.styles.length} style{o.styles.length === 1 ? "" : "s"} · factory date {fmtDay(o.factory_date)}</span></span>
              <TemplatePicker soId={o.id} factoryDate={o.factory_date} templates={templates.filter((t) => t.order_type === o.order_type)} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="people" n={c.noMerch.length} title="Orders without a merchandiser or manager"
        why="Alerts go to the order's merchandiser and manager. Without them, nobody's My day shows the problem.">
        <div className="list-rows">
          {c.noMerch.slice(0, MAX).map((o) => (
            <div key={o.id}>
              <span className="grow"><Link className="code text-accent" href={`/orders/${o.id}`}>{o.id}</Link> <span className="text-muted">{label(o)}</span></span>
              <OrderFill soId={o.id} people={people} managers={managers} factories={factories}
                need={{ merch: !o.merchandiser_id, manager: !o.manager_id, factory: false, factoryDate: false, buyerDate: false }} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="factory" n={c.noFactory.length} title="Orders without a factory"
        why="The factory PO, the factory portal and the scorecards all need it. On a running order it can be set once.">
        <div className="list-rows">
          {c.noFactory.slice(0, MAX).map((o) => (
            <div key={o.id}>
              <span className="grow"><Link className="code text-accent" href={`/orders/${o.id}`}>{o.id}</Link> <span className="text-muted">#{o.buyer_po_number} · {w.buyerCode(o.buyer_id)} · {o.status === "locked" ? "running" : "draft"}</span></span>
              <OrderFill soId={o.id} people={people} managers={managers} factories={factories} need={{ merch: false, manager: false, factory: true, factoryDate: false, buyerDate: false }} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="dates" n={c.noDates.length} title="Running orders missing a delivery date"
        why="Delivery dates drive the TNA, the deadline alerts and on-time scores. Each can be set once on a running order.">
        <div className="list-rows">
          {c.noDates.slice(0, MAX).map((o) => (
            <div key={o.id}>
              <span className="grow"><Link className="code text-accent" href={`/orders/${o.id}`}>{o.id}</Link> <span className="text-muted">{label(o)}</span></span>
              <OrderFill soId={o.id} people={people} managers={managers} factories={factories}
                need={{ merch: false, manager: false, factory: false, factoryDate: !o.factory_date, buyerDate: !o.buyer_date }} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="rates" n={c.noRate.length} title="Styles without a factory rate"
        why="The factory PO value and your margin report need the rate you pay the factory. On a running order it can be filled once.">
        <div className="list-rows">
          {c.noRate.slice(0, MAX).map(({ o, s }) => (
            <div key={s.id}>
              <span className="grow"><b>{s.name || "Style"}</b> <span className="text-muted">({s.colour || "—"}) · {nf(s.qty)} pcs · <Link className="code text-accent" href={`/orders/${o.id}`}>{o.id}</Link> · {w.factoryName(o.factory_id)}</span></span>
              <RateFill styleId={s.id} currency={o.currency} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="samples" n={c.samples.length} title="Open samples without a due date"
        why="Samples are judged on the buyer's date. Without one, the app can't warn you before it's late.">
        <div className="list-rows">
          {c.samples.slice(0, MAX).map((s) => (
            <div key={s.id}>
              <span className="grow"><Link className="code text-accent" href={`/samples/${s.id}`}>{s.id}</Link> <b>{sampleTitle(s)}</b> <span className="text-muted">· {w.buyerCode(s.buyer_id)} · received {fmtDay(s.received_on)}</span></span>
              <DateFill id={s.id} kind="sample" min={s.received_on ?? undefined} />
            </div>
          ))}
        </div>
      </Section>

      <Section id="inquiries" n={c.inquiries.length} title="Open inquiries with no follow-up planned"
        why="Set the next follow-up date, or mark the inquiry lost if the buyer went quiet.">
        <div className="list-rows">
          {c.inquiries.slice(0, MAX).map((i) => (
            <div key={i.id}>
              <span className="grow"><Link className="code text-accent" href={`/inquiries?q=${i.id}`}>{i.id}</Link> <b>{i.product_type}</b> <span className="text-muted">· {w.buyerCode(i.buyer_id)} · {i.next_follow_up ? `last planned ${fmtDay(i.next_follow_up)}` : "no date"}</span></span>
              <DateFill id={i.id} kind="inquiry" min={w.today} />
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
