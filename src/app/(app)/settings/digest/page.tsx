import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadBooks, loadWorld } from "@/lib/data";
import { buildDigest } from "@/lib/digest";
import { isFinance, isInternal } from "@/lib/roles";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Morning email · Sourcingo OS" };

// Exactly what tomorrow's 08:30 email would say, from today's data.
export default async function DigestPreview() {
  const me = await getMe();
  if (!me || !isInternal(me.role)) redirect("/");
  const { world } = await loadWorld();
  const books = isFinance(me.role) ? (await loadBooks()).books : null;
  const supabase = await createClient();
  const { data: notes } = await supabase.from("notifications").select("title, body, href, created_at")
    .gte("created_at", new Date(world.now - 864e5).toISOString()).order("created_at", { ascending: false });
  const d = buildDigest(world, { id: me.id, full_name: me.fullName, email: me.email, role: me.role, active: true }, books, notes ?? []);
  return (
    <>
      <Head crumbs={<Link className="link" href="/settings">My settings</Link>} title="Your morning email" sub={`Subject: ${d.subject}${me.digest ? "" : " · It's switched off for you in My settings."}`} />
      <iframe title="Morning email preview" srcDoc={d.html} className="w-full rounded-xl border border-line bg-white" style={{ height: "75vh" }} />
    </>
  );
}
