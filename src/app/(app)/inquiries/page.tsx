import Link from "next/link";
import { redirect } from "next/navigation";
import { inputCls, panelCls } from "@/components/ui";
import { getMe } from "@/lib/auth";
import { todayIST } from "@/lib/format";
import { isOps } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";
import { InquiryCard, STATUS, type Inquiry } from "./inquiry-card";
import { NewInquiry } from "./new-inquiry";

export const metadata = { title: "Inquiries · Sourcingo OS" };

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "due", label: "Follow-up due" },
  { key: "all", label: "All" },
  ...Object.entries(STATUS).map(([key, s]) => ({ key, label: s.label })),
];

export default async function InquiriesPage({ searchParams }: PageProps<"/inquiries">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (!isOps(me.role)) redirect("/");
  const isOwner = me.role === "owner";

  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.status) ? String(sp.status) : "open";
  const q = String(sp.q ?? "").trim().toLowerCase();
  const today = todayIST();

  const supabase = await createClient();
  const [inquiries, followups, buyers, registry, people] = await Promise.all([
    supabase
      .from("inquiries")
      .select("id, buyer_id, contact_person, contact_email, product_type, est_qty, unit, budget_inr, merchandiser_id, status, next_follow_up, notes, created_at, so_id")
      .order("created_at", { ascending: false }),
    supabase.from("inquiry_followups").select("id, inquiry_id, note, created_at, created_by").order("created_at", { ascending: false }),
    supabase.from("buyers").select("id, code").order("code"),
    isOwner ? supabase.from("buyer_registry").select("buyer_id, real_name") : Promise.resolve({ data: [] as { buyer_id: string; real_name: string }[], error: null }),
    supabase.from("profiles").select("id, full_name, email, role, active"),
  ]);
  const error = inquiries.error || followups.error || buyers.error || registry.error || people.error;

  const realName = new Map((registry.data ?? []).map((r) => [r.buyer_id, r.real_name]));
  const code = new Map((buyers.data ?? []).map((b) => [b.id, b.code]));
  const label = (id: string) => (isOwner && realName.has(id) ? `${code.get(id)} · ${realName.get(id)}` : code.get(id) ?? "Unknown buyer");
  const nameOf = (id: string | null) => {
    if (id === me.id) return "You";
    const p = (people.data ?? []).find((x) => x.id === id);
    return p ? p.full_name || p.email : "Someone";
  };
  const merchandisers = (people.data ?? [])
    .filter((p) => p.active && ["merchandiser", "manager", "owner"].includes(p.role ?? ""))
    .map((p) => ({ id: p.id, label: p.full_name || p.email }));

  const all: Inquiry[] = (inquiries.data ?? []).map((i) => ({
    ...i,
    buyerLabel: label(i.buyer_id),
    followups: (followups.data ?? []).filter((f) => f.inquiry_id === i.id).map((f) => ({ id: f.id, note: f.note, created_at: f.created_at, by: nameOf(f.created_by) })),
  }));
  const isOpen = (i: Inquiry) => i.status === "new" || i.status === "quoted";
  const shown = all
    .filter((i) =>
      filter === "all" ? true : filter === "open" ? isOpen(i) : filter === "due" ? isOpen(i) && !!i.next_follow_up && i.next_follow_up <= today : i.status === filter,
    )
    .filter((i) => !q || [i.id, i.buyerLabel, i.product_type, i.contact_person, i.contact_email].join(" ").toLowerCase().includes(q));
  const dueCount = all.filter((i) => isOpen(i) && !!i.next_follow_up && i.next_follow_up <= today).length;

  const href = (status: string) => `/inquiries?status=${status}${q ? `&q=${encodeURIComponent(q)}` : ""}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-bold">Inquiries</h1>
        <p className="text-muted">Log every buyer inquiry, assign it, and follow up until it becomes an order.</p>
      </div>
      {error && <p className="rounded-lg bg-warn-soft p-4 text-warn">Couldn&apos;t load everything: {error.message}</p>}

      <section className={panelCls}>
        <h2 className="mb-3 font-bold">Log a new inquiry</h2>
        <NewInquiry buyers={(buyers.data ?? []).map((b) => ({ id: b.id, label: label(b.id) }))} merchandisers={merchandisers} isOwner={isOwner} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-bold">All inquiries</h2>
          <form action="/inquiries" className="w-full sm:w-64">
            <input type="hidden" name="status" value={filter} />
            <input name="q" defaultValue={q} placeholder="Search code, product, contact" aria-label="Search inquiries" className={inputCls} />
          </form>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Filter inquiries">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={href(f.key)}
              aria-current={f.key === filter ? "page" : undefined}
              className={`rounded-lg border px-3 py-1 text-sm font-semibold ${f.key === filter ? "border-foreground bg-foreground text-background" : "border-line text-muted"}`}
            >
              {f.label}
              {f.key === "due" && dueCount > 0 && <span className="ml-1.5 rounded-full bg-bad px-1.5 text-xs text-white">{dueCount}</span>}
            </Link>
          ))}
        </nav>
        {shown.length ? (
          shown.map((i) => <InquiryCard key={i.id} inq={i} merchandisers={merchandisers} today={today} />)
        ) : (
          <div className="rounded-xl border-2 border-dashed border-line p-8 text-center text-muted">
            <b className="block text-foreground">{all.length ? "No inquiries match" : "No inquiries yet"}</b>
            {all.length ? "Try another filter or search." : "Log the first one with the form above."}
          </div>
        )}
      </section>
    </div>
  );
}
