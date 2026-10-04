import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { SettingsForm } from "@/components/settings-form";
import { getMe, roleLabel } from "@/lib/auth";
import { fmtDateTime } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "My settings · Sourcingo OS" };

export default async function Settings() {
  const me = await getMe();
  if (!me) redirect("/login");
  const supabase = await createClient();
  const { data: mine } = await supabase.from("feedback").select("id, kind, message, status, reply, created_at").eq("user_id", me.id).order("created_at", { ascending: false }).limit(50);
  return (
    <>
      <Head title="My settings" sub={`${me.fullName || me.email} · ${roleLabel(me.role)}`} />
      <SettingsForm language={me.language} digest={me.digest} phone={me.phone ?? ""} showDigest />
      <p className="text-[13px] text-muted"><Link className="link" href="/settings/digest">Preview my morning email</Link></p>
      {!!mine?.length && (
        <section className="panel" id="feedback">
          <h3>My feedback</h3>
          <ol className="hist">
            {mine.map((f) => (
              <li key={f.id}>
                <time>{fmtDateTime(f.created_at)} · {f.kind} · {f.status === "new" ? "sent" : f.status === "wontfix" ? "won't do" : f.status}</time>
                {f.message}
                {f.reply && <div className="mt-1 text-[13px] text-ok">Owner: {f.reply}</div>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
