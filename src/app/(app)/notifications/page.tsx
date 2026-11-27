import Link from "next/link";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { isPartner } from "@/lib/auth-roles";
import { bellItem, type BellRow, byDay } from "@/lib/bell";
import { createClient } from "@/lib/supabase/server";
import { EveningSwitch } from "./evening-switch";
import { MarkSeen } from "./seen";
import "@/components/ops.css";

const time = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

// One bell for changes: what moved on the orders in the last 14 days, newest first, never your own doing.
export default async function NotificationsPage() {
  const me = await getMe();
  if (!me?.role || !me.companyId || isPartner(me.role)) redirect("/");
  const supabase = await createClient();
  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase.rpc("bell", { p_limit: 150 }),
    supabase.from("member_settings").select("evening_email").eq("company_id", me.companyId).eq("user_id", me.id).maybeSingle(),
  ]);
  const items = ((data ?? []) as BellRow[]).map(bellItem);
  const fresh = items.filter((i) => i.fresh).length;
  const days = byDay(items);

  return (
    <div className="bell-page">
      <div className="head">
        <div className="grow">
          <h1>Notifications</h1>
          <p>{fresh ? `${fresh} new since you last looked.` : "You're up to date."} The last 14 days on every order, without your own changes.</p>
        </div>
      </div>
      <MarkSeen fresh={fresh} />
      {error && <p className="errbox">Couldn&apos;t load notifications: {error.message}</p>}
      {days.length ? days.map((g) => (
        <section key={g.label} className="bell-day">
          <h2 className="bell-day-h">{g.label}</h2>
          <ul className="card bell-list">
            {g.items.map((it, i) => (
              <li key={`${it.at}-${i}`}>
                <Link href={it.href} className="bell-row" data-fresh={it.fresh || undefined}>
                  <span className={`bell-dot ${it.tone}`} aria-hidden />
                  <span className="grow min-w-0">
                    <span className="bell-title">{it.title}</span>
                    {it.detail && <span className="bell-detail">{it.detail}</span>}
                  </span>
                  <time className="bell-time num" dateTime={it.at}>{time.format(new Date(it.at))}</time>
                  {it.fresh && <span className="sr-only">New</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )) : !error && (
        <div className="empty"><b>Nothing new in the last 14 days</b>Buyer messages, QC results, factory replies and tags on your orders show up here.</div>
      )}
      <div className="panel bell-settings">
        <EveningSwitch on={settings?.evening_email ?? true} />
      </div>
    </div>
  );
}
