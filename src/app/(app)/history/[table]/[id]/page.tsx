import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { History } from "@/components/history";
import { lower, TABLES, tableLabel } from "@/lib/activity";
import { loadWorld } from "@/lib/data";
import { isInternal } from "@/lib/roles";

export async function generateMetadata({ params }: PageProps<"/history/[table]/[id]">) {
  return { title: `History of ${decodeURIComponent((await params).id)} · Sourcingo OS` };
}

// The full history of any one record, for records without a screen of their own
// (inquiries, deleted rows, Tally records...). Access rules decide what shows.
export default async function RecordHistoryPage({ params }: PageProps<"/history/[table]/[id]">) {
  const { world: w, me } = await loadWorld();
  if (!me) redirect("/login");
  if (!isInternal(me.role)) redirect("/");
  const { table, id: raw } = await params;
  const id = decodeURIComponent(raw);
  const href = TABLES[table]?.href?.(id);
  const screen = href && !href.startsWith("/history/") ? href : null;
  return (
    <>
      <Head crumbs={me.role === "owner" ? <><Link className="link" href="/activity">Activity log</Link> › {tableLabel(table)}</> : tableLabel(table)}
        title={`History of ${lower(tableLabel(table))} ${id}`}
        sub="Every change to this record and the rows that belong to it, newest first. Entries are permanent.">
        {screen && <Link className="btn" href={screen}>Open {lower(tableLabel(table))}</Link>}
      </Head>
      <History table={table} id={id} w={w} open />
    </>
  );
}
