import Link from "next/link";
import { redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadTeam, personName } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { day, daysBetween, money, qty, todayIST } from "@/lib/format";
import { INQUIRY_COLUMNS, isOpenInquiry, QUIET_DAYS, STAGES, stageOf, type Inquiry } from "@/lib/inquiries";
import { addDays } from "@/lib/payments";
import { createClient } from "@/lib/supabase/server";
import { InquiryButton, InquirySheet, type StepInquiry } from "./inquiry-step";
import { QuickAdd } from "./quick-add";
import { CloseQuiet } from "./close-quiet";
import { PageTabs } from "@/components/page-tabs";
import { INBOX_TABS } from "@/lib/page-groups";

const VIEWS = [
  { key: "open", label: "Open" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "all", label: "All" },
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const lakh = (n: number) => (n >= 100_000 ? `₹${(n / 100_000).toFixed(n >= 1_000_000 ? 0 : 1)} L` : money(Math.round(n)));

export default async function InquiriesPage({ searchParams }: PageProps<"/inquiries">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  const view = VIEWS.some((t) => t.key === sp.show) ? String(sp.show) : "open";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  // Text shared to the app from another app (WhatsApp's Share on Android) lands in the quick add.
  const shared = [sp.title, sp.text, sp.url].filter((x) => typeof x === "string" && x.trim()).join("\n");
  const supabase = await createClient();
  const [{ data, error }, buyers, team] = await Promise.all([
    fetchAll<Inquiry>((a, z) => supabase.from("inquiries").select(INQUIRY_COLUMNS).eq("company_id", me.companyId!).order("created_at", { ascending: false }).order("id").range(a, z)),
    loadBuyers(),
    loadTeam(),
  ]);
  const all = data ?? [];
  const openIds = all.filter((i) => isOpenInquiry(i.status)).map((i) => i.id);
  const orderIds = all.map((i) => i.order_id).filter(Boolean) as string[];
  const [{ data: linked }, { data: notes }] = await Promise.all([
    orderIds.length ? supabase.from("orders").select("id, order_no").in("id", orderIds) : Promise.resolve({ data: [] as { id: string; order_no: string }[] }),
    openIds.length ? supabase.from("inquiry_notes").select("inquiry_id, created_at").in("inquiry_id", openIds) : Promise.resolve({ data: [] as { inquiry_id: string; created_at: string }[] }),
  ]);
  const orderNo = new Map((linked ?? []).map((o) => [o.id, o.order_no]));
  const lastNote = new Map<string, string>();
  for (const n of notes ?? []) if ((lastNote.get(n.inquiry_id) ?? "") < n.created_at) lastNote.set(n.inquiry_id, n.created_at);
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const today = todayIST();
  const who = (i: Inquiry) => (i.buyer_id ? buyerOf.get(i.buyer_id) ?? "Buyer" : i.prospect ?? "");
  const lastTouch = (i: Inquiry) => [i.updated_at, i.created_at, lastNote.get(i.id) ?? ""].sort().at(-1)!.slice(0, 10);
  const due = (i: Inquiry) => isOpenInquiry(i.status) && !!i.next_follow_up && i.next_follow_up <= today;
  const quiet = (i: Inquiry) => isOpenInquiry(i.status) && !i.next_follow_up && daysBetween(lastTouch(i), today) >= QUIET_DAYS;
  const matches = (i: Inquiry) => !q || [i.inquiry_no, who(i), i.product, i.contact_name, i.contact, i.merchandiser_id ? people.get(i.merchandiser_id) : ""]
    .join(" ").toLowerCase().includes(q);

  const open = all.filter((i) => isOpenInquiry(i.status));
  const step = (i: Inquiry): StepInquiry => ({
    id: i.id, no: i.inquiry_no, title: who(i), product: i.product, status: i.status, stage: stageOf(i), hasBuyer: !!i.buyer_id,
    price: i.quoted_price != null ? String(i.quoted_price) : i.target_price != null ? String(i.target_price) : "", quoted: i.quoted_price,
    unit: i.unit, estQty: i.est_qty, sampleSentOn: i.sample_sent_on, contactName: i.contact_name ?? "", contact: i.contact ?? "", nextFollowUp: i.next_follow_up ?? "",
  });

  // The open list, by what to do: follow up today, send a price, wait on the buyer, and the ones gone quiet.
  const byDue = (a: Inquiry, b: Inquiry) => (a.next_follow_up ?? "9999").localeCompare(b.next_follow_up ?? "9999") || b.created_at.localeCompare(a.created_at);
  const shown = open.filter(matches);
  const groups = [
    { key: "due", title: "Follow up now", hint: "Send a message, then pick the next day.", rows: shown.filter(due).sort(byDue) },
    { key: "price", title: "Needs a price", hint: "Asked, not priced yet.", rows: shown.filter((i) => !due(i) && !quiet(i) && stageOf(i) === 0).sort(byDue) },
    { key: "wait", title: "Waiting on the buyer", hint: "Price or sample sent. Back here on its follow-up day.", rows: shown.filter((i) => !due(i) && !quiet(i) && stageOf(i) > 0).sort(byDue) },
  ];
  const quietRows = shown.filter(quiet).sort((a, b) => lastTouch(b).localeCompare(lastTouch(a)));
  const closed = all.filter((i) => matches(i) && (view === "all" || (view === "won" ? i.status === "converted" : view === "lost" ? i.status === "lost" : false)));

  // One line of numbers instead of a wall of tiles.
  const since = addDays(today, -90);
  const decided = all.filter((i) => i.status_at.slice(0, 10) >= since && (i.status === "converted" || i.status === "lost"));
  const won = decided.filter((i) => i.status === "converted").length;
  const quotedValue = open.reduce((s, i) => s + (i.quoted_price ?? 0) * (i.est_qty ?? 0), 0);
  const dueCount = open.filter(due).length;
  const summary = [
    dueCount ? <b key="d" className="text-bad">{plural(dueCount, "follow-up")} due</b> : open.length ? <b key="d" className="text-ok">No follow-ups due</b> : null,
    open.length ? `${open.length} open` : null,
    quotedValue ? `${lakh(quotedValue)} quoted` : null,
    decided.length >= 3 ? `${won} of ${decided.length} won in 90 days` : null,
  ].filter(Boolean);
  const qs = (k: string) => `/inquiries?${new URLSearchParams({ ...(k !== "open" ? { show: k } : {}), ...(q ? { q } : {}) })}`;

  function Row({ i }: { i: Inquiry }) {
    const s = stageOf(i);
    const isDue = due(i);
    const late = isDue && i.next_follow_up ? daysBetween(i.next_follow_up, today) : 0;
    const price = i.quoted_price != null ? `${money(i.quoted_price)} quoted` : i.target_price != null ? `${money(i.target_price)} target` : "";
    const bits = [i.est_qty ? `${qty(i.est_qty)} ${i.unit}` : "", price, i.merchandiser_id && i.merchandiser_id !== me?.id ? people.get(i.merchandiser_id) : ""].filter(Boolean);
    const when = i.status === "converted" ? null
      : i.status === "lost" ? <span key="w" className="!whitespace-normal">Lost: {i.lost_reason}</span>
      : isDue ? <span key="w" className="text-bad">{late ? `${plural(late, "day")} late` : "Due today"}</span>
      : i.next_follow_up ? <span key="w">Follow up {day(i.next_follow_up).replace(/ \d{4}$/, "")}</span>
      : <span key="w">Quiet since {day(lastTouch(i)).replace(/ \d{4}$/, "")}</span>;
    return (
      <li className="inq-row">
        <span className={`sev ${isDue ? "bad" : i.status === "converted" ? "ok" : ""}`} aria-hidden />
        <Link href={`/inquiries/${i.id}`} className="min-w-0 inq-main">
          <span className="inq-who">{who(i)}{!i.buyer_id && i.status !== "converted" && <span className="chip ml-1.5 align-middle">New buyer</span>}</span>
          <span className="inq-what">{i.product}</span>
          <span className="inq-meta dots">
            <span>
              {i.status === "converted" ? <span className="text-ok">Order {orderNo.get(i.order_id ?? "") ?? ""}</span> : i.status !== "lost" ? <span className="inq-stage">{STAGES[s]}</span> : null}
              {bits.map((b) => <span key={b}>{b}</span>)}
              {when}
            </span>
          </span>
        </Link>
        {isOpenInquiry(i.status) && (quiet(i)
          ? <CloseQuiet id={i.id} />
          : <InquiryButton i={step(i)} label={isDue ? "Follow up" : "Update"} className={`btn sm ${isDue ? "primary" : ""}`} />)}
      </li>
    );
  }

  const empty = all.length === 0;

  return (
    <>
      <PageTabs tabs={INBOX_TABS} label="Buyer emails" />
      <div className="head inq-head">
        <div className="grow">
          <h1>Inquiries</h1>
          {summary.length > 0 && <div className="inq-sum dots"><span>{summary.map((s, n) => <span key={n}>{s}</span>)}</span></div>}
        </div>
        <Link href="/inquiries/new" className="btn ghost sm hide-phone">Full form</Link>
      </div>

      <QuickAdd buyers={buyers.filter((b) => b.active).map((b) => ({ id: b.id, label: buyerName(b), names: [b.realName ?? "", b.code] }))}
        companyId={me.companyId} meId={me.id} today={today} initial={shared} />

      {error && <div className="errbox">{error.message}</div>}

      {empty ? (
        <div className="inq-empty">
          <b>Every buyer ask, in one place</b>
          <p>When a buyer asks for a price on WhatsApp, a call or email, paste it above. It comes back on its follow-up day, so no inquiry is forgotten, and the ones you win become orders in one tap.</p>
          <p className="muted">Emails the PO pickup catches that aren&apos;t POs can be made inquiries from <Link href="/pos" className="link">Buyer POs</Link>.</p>
        </div>
      ) : (
        <>
          <div className="inq-bar">
            <nav className="seg" aria-label="Show">
              {VIEWS.map((x) => (
                <Link key={x.key} href={qs(x.key)} aria-current={view === x.key ? "page" : undefined} scroll={false}>{x.label}</Link>
              ))}
            </nav>
            {all.length > 8 && (
              <form action="/inquiries" className="inq-search">
                {view !== "open" && <input type="hidden" name="show" value={view} />}
                <input className="inp" type="search" name="q" defaultValue={q} placeholder="Search" aria-label="Search inquiries" enterKeyHint="search" />
              </form>
            )}
          </div>

          {view === "open" ? (
            <>
              {groups.filter((g) => g.rows.length).map((g) => (
                <section key={g.key} className="card inq-group" aria-labelledby={`g-${g.key}`}>
                  <header className="inq-gh">
                    <h2 id={`g-${g.key}`}>{g.title} <span>{g.rows.length}</span></h2>
                    <p>{g.hint}</p>
                  </header>
                  <ul className="inq-list">{g.rows.map((i) => <Row key={i.id} i={i} />)}</ul>
                </section>
              ))}
              {quietRows.length > 0 && (
                <details className="card inq-group inq-quiet" open={groups.every((g) => !g.rows.length)}>
                  <summary className="inq-gh">
                    <h2>Gone quiet <span>{quietRows.length}</span></h2>
                    <p>No follow-up day and nothing for {QUIET_DAYS}+ days. Close the dead ones in a tap, or open one to pick it up again.</p>
                  </summary>
                  <ul className="inq-list">{quietRows.map((i) => <Row key={i.id} i={i} />)}</ul>
                </details>
              )}
              {!shown.length && <p className="inq-none">{q ? "No open inquiries match that search." : "No open inquiries. Log the next buyer ask above."}</p>}
            </>
          ) : (
            <section className="card inq-group">
              {closed.length ? <ul className="inq-list">{closed.map((i) => <Row key={i.id} i={i} />)}</ul>
                : <p className="inq-none">{q ? "Nothing matches that search." : view === "won" ? "No inquiry has become an order yet." : view === "lost" ? "None lost." : "Nothing here yet."}</p>}
            </section>
          )}
        </>
      )}
      <InquirySheet today={today} />
    </>
  );
}
