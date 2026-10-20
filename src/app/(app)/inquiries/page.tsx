import Link from "next/link";
import { redirect } from "next/navigation";
import { Icon } from "@/components/nav";
import { canEditOrders, getMe } from "@/lib/auth";
import { buyerName, loadBuyers, loadTeam, personName } from "@/lib/data";
import { fetchAll } from "@/lib/fetch-all";
import { day, dayAt, daysBetween, money, qty, todayIST } from "@/lib/format";
import { INQUIRY_COLUMNS, INQUIRY_STATUS, isOpenInquiry, sourceLabel, type Inquiry } from "@/lib/inquiries";
import { createClient } from "@/lib/supabase/server";
import { addDays } from "@/lib/payments";

const TABS = [
  { key: "open", label: "Open", hint: "New and quoted inquiries, the ones with a follow-up due first." },
  { key: "due", label: "Follow-up due", hint: "Open inquiries whose follow-up date is today or has passed." },
  { key: "converted", label: "Converted", hint: "Inquiries that became sales orders." },
  { key: "lost", label: "Lost", hint: "Inquiries that didn't become orders, with the reason." },
  { key: "all", label: "All", hint: "Every inquiry, newest first." },
];

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export default async function InquiriesPage({ searchParams }: PageProps<"/inquiries">) {
  const me = await getMe();
  if (!canEditOrders(me?.role) || !me?.companyId) redirect("/");
  const sp = await searchParams;
  const tab = TABS.some((t) => t.key === sp.show) ? String(sp.show) : "open";
  const q = typeof sp.q === "string" ? sp.q.trim().toLowerCase() : "";
  const supabase = await createClient();
  const [{ data, error }, buyers, team] = await Promise.all([
    fetchAll<Inquiry>((a, z) => supabase.from("inquiries").select(INQUIRY_COLUMNS).eq("company_id", me.companyId!).order("created_at", { ascending: false }).order("id").range(a, z)),
    loadBuyers(),
    loadTeam(),
  ]);
  const all = data ?? [];
  const orderIds = all.map((i) => i.order_id).filter(Boolean) as string[];
  const { data: linked } = orderIds.length ? await supabase.from("orders").select("id, order_no").in("id", orderIds) : { data: [] };
  const orderNo = new Map((linked ?? []).map((o) => [o.id, o.order_no]));
  const buyerOf = new Map(buyers.map((b) => [b.id, buyerName(b)]));
  const people = new Map(team.map((m) => [m.user_id, personName(m)]));
  const today = todayIST();
  const due = (i: Inquiry) => isOpenInquiry(i.status) && !!i.next_follow_up && i.next_follow_up <= today;
  const who = (i: Inquiry) => (i.buyer_id ? buyerOf.get(i.buyer_id) ?? "Buyer" : i.prospect ?? "");
  const matches = (i: Inquiry) => !q || [i.inquiry_no, who(i), i.product, i.contact_name, i.contact, i.merchandiser_id ? people.get(i.merchandiser_id) : ""]
    .join(" ").toLowerCase().includes(q);

  const inTab = (k: string, i: Inquiry) => k === "all" || (k === "open" ? isOpenInquiry(i.status) : k === "due" ? due(i) : i.status === k);
  const rows = all.filter((i) => inTab(tab, i) && matches(i));
  if (tab === "open" || tab === "due") {
    // Follow-ups due first (oldest first), then the rest by their next follow-up, then newest.
    rows.sort((a, b) => Number(due(b)) - Number(due(a)) || (a.next_follow_up ?? "9999").localeCompare(b.next_follow_up ?? "9999") || b.created_at.localeCompare(a.created_at));
  }
  const count = (k: string) => all.filter((i) => inTab(k, i)).length;

  // The numbers on top: what is open, what needs a call today, and how many inquiries became orders in 90 days.
  const since = addDays(today, -90);
  const recent = all.filter((i) => i.created_at >= since);
  const decided = recent.filter((i) => i.status === "converted" || i.status === "lost");
  const won = decided.filter((i) => i.status === "converted").length;
  const quoted = all.filter((i) => i.status === "quoted");
  const quotedValue = quoted.reduce((s, i) => s + (i.quoted_price ?? 0) * (i.est_qty ?? 0), 0);
  const t = TABS.find((x) => x.key === tab)!;
  const qs = (k: string) => `/inquiries?${new URLSearchParams({ ...(k !== "open" ? { show: k } : {}), ...(q ? { q } : {}) })}`;

  const kpis = [
    { key: "open", label: "Open inquiries", value: String(count("open")), sev: "", sub: `${count("open") - quoted.length} new · ${quoted.length} quoted` },
    { key: "due", label: "Follow-ups due", value: String(count("due")), sev: count("due") ? "bad" : "ok", sub: count("due") ? "Call or write today" : "All followed up" },
    { key: "quoted", label: "Quoted, waiting", value: quotedValue ? money(Math.round(quotedValue)) : String(quoted.length), sev: "",
      sub: quotedValue ? plural(quoted.length, "quote") : "Quotes sent" },
    { key: "converted", label: "Won in 90 days", value: decided.length ? `${Math.round((won / decided.length) * 100)}%` : "–", sev: "",
      sub: decided.length ? `${won} of ${decided.length} decided became orders` : "None decided yet" },
  ];

  return (
    <>
      <div className="head">
        <div className="grow">
          <h1>Inquiries</h1>
          <p>
            Every buyer inquiry, from the first ask to the order.{" "}
            {count("due") ? <b className="text-bad">{plural(count("due"), "follow-up")} due</b> : <b className="text-ok">No follow-ups due</b>}
          </p>
        </div>
        <Link href="/inquiries/new" className="btn primary"><Icon name="plus" size={16} />New inquiry</Link>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <Link key={k.key} href={qs(k.key === "quoted" ? "open" : k.key)} className={`kpi ${k.sev}`}>
            <span className="kpi-label"><i aria-hidden />{k.label}</span>
            <b className="num">{k.value}</b>
            <small>{k.sub}</small>
          </Link>
        ))}
      </div>

      <section className="card" aria-labelledby="inq-h">
        <header className="card-h">
          <div className="min-w-0">
            <h2 id="inq-h">{t.label}</h2>
            <p>{t.hint}</p>
          </div>
          <nav className="seg" aria-label="Show">
            {TABS.map((x) => (
              <Link key={x.key} href={qs(x.key)} aria-current={tab === x.key ? "page" : undefined} scroll={false}>
                {x.label} <span>{count(x.key)}</span>
              </Link>
            ))}
          </nav>
        </header>
        <form className="border-b border-line px-4 py-3 sm:px-5" action="/inquiries">
          {tab !== "open" && <input type="hidden" name="show" value={tab} />}
          <input className="inp" type="search" name="q" defaultValue={q} placeholder="Search buyer, product, contact or ENQ number" aria-label="Search inquiries" enterKeyHint="search" />
        </form>

        {error && <div className="errbox m-4">{error.message}</div>}

        {rows.length === 0 ? (
          <p className="card-empty">
            {q ? "No inquiries match that search." : tab === "open" ? "No open inquiries. Log each buyer ask with New inquiry, so none is forgotten."
              : tab === "due" ? "Nothing to follow up today." : "Nothing here yet."}
          </p>
        ) : (
          <ul className="todo">
            {rows.map((i) => {
              const s = INQUIRY_STATUS[i.status];
              const isDue = due(i);
              const late = isDue && i.next_follow_up ? daysBetween(i.next_follow_up, today) : 0;
              return (
                <li key={i.id}>
                  <span className={`sev ${isDue ? "bad" : i.status === "quoted" ? "warn" : i.status === "converted" ? "ok" : ""}`} aria-hidden />
                  <div className="min-w-0">
                    <Link href={`/inquiries/${i.id}`} className="todo-title">
                      <span className="code">{i.inquiry_no}</span>{who(i)} · {i.product}{!i.buyer_id && <span className="chip ml-2 align-middle">New buyer</span>}
                    </Link>
                    <div className="todo-detail">
                      {[i.est_qty ? `${qty(i.est_qty)} ${i.unit}` : "", i.quoted_price != null ? `quoted ${money(i.quoted_price)}` : i.target_price != null ? `target ${money(i.target_price)}` : "",
                        i.merchandiser_id ? people.get(i.merchandiser_id) : "Not assigned", `${sourceLabel(i.source)} ${dayAt(i.created_at)}`].filter(Boolean).join(" · ")}
                      {i.status === "lost" && i.lost_reason && <> · {i.lost_reason}</>}
                    </div>
                    {(isDue || (i.next_follow_up && isOpenInquiry(i.status)) || i.order_id) && (
                      <div className="todo-links">
                        {isDue && <span className="chip bad">{late ? `Follow-up ${plural(late, "day")} late` : "Follow up today"}</span>}
                        {!isDue && i.next_follow_up && isOpenInquiry(i.status) && <span className="chip">Follow up {day(i.next_follow_up)}</span>}
                        {i.order_id && <Link href={`/orders/${i.order_id}`} className="chip ok code">{orderNo.get(i.order_id) ?? "Order"}</Link>}
                      </div>
                    )}
                  </div>
                  <div className="todo-chip"><span className={s?.cls}>{s?.label}</span></div>
                  <Link href={`/inquiries/${i.id}`} className="btn sm todo-act">{isDue ? "Follow up" : "Open"}</Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
