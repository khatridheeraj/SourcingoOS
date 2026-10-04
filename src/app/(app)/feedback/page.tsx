import { redirect } from "next/navigation";
import { Empty, Head, Pills } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";
import { FeedbackAnswer } from "./row";

export const metadata = { title: "Feedback · Sourcingo OS" };

type Row = { id: number; user_id: string; kind: string; message: string; page: string | null; status: string; reply: string | null; created_at: string };
const KIND = { problem: ["bad", "Problem"], idea: ["info", "Idea"], question: ["warn", "Question"] } as Record<string, [string, string]>;

// Everything the team sends with the Feedback button, while they test the app.
export default async function FeedbackInbox({ searchParams }: PageProps<"/feedback">) {
  const me = await getMe();
  if (me?.role !== "owner") redirect("/");
  const sp = await searchParams;
  const f = ["open", "all"].includes(String(sp.show)) ? String(sp.show) : "open";
  const supabase = await createClient();
  const { data } = await supabase.from("feedback").select("*").order("created_at", { ascending: false }).limit(500);
  const { world: w } = await loadWorld();
  const all = (data ?? []) as Row[];
  const list = f === "all" ? all : all.filter((x) => x.status === "new" || x.status === "planned");
  return (
    <>
      <Head crumbs="Setup › Feedback" title="Feedback" sub="Problems, ideas and questions from the team, sent from any screen. Reply and they're notified." />
      <Pills current={f} items={[{ key: "open", label: "Open", href: "/feedback?show=open", n: all.filter((x) => x.status === "new").length }, { key: "all", label: "All", href: "/feedback?show=all" }]} />
      {list.length ? (
        <div className="stack">
          {list.map((x) => (
            <article key={x.id} className="card stack" style={{ gap: 8 }}>
              <div className="row">
                <span className={`chip ${KIND[x.kind]?.[0] ?? ""}`}>{KIND[x.kind]?.[1] ?? x.kind}</span>
                <b className="grow">{w.personName(x.user_id)}</b>
                <span className="text-xs text-muted">{fmtDateTime(x.created_at)}{x.page && <> · on <a className="link" href={x.page}>{x.page}</a></>}</span>
              </div>
              <p className="whitespace-pre-line text-[14px]">{x.message}</p>
              <FeedbackAnswer id={x.id} status={x.status} reply={x.reply ?? ""} />
            </article>
          ))}
        </div>
      ) : (
        <Empty title="Nothing open">When someone taps Feedback, it shows here.</Empty>
      )}
    </>
  );
}
