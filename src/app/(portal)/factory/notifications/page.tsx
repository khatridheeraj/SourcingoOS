import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { NotificationList, type Note } from "@/components/notification-list";
import { getMe } from "@/lib/auth";
import { tr } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Notifications · Sourcingo" };

export default async function FactoryNotifications() {
  const me = await getMe();
  if (me?.role !== "factory") redirect("/");
  const t = tr(me.language);
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, kind, title, body, href, created_at, read_at").order("created_at", { ascending: false }).limit(100);
  return (
    <>
      <Head title={t("Notifications")} />
      <NotificationList notes={(data ?? []) as Note[]} hi={me.language === "hi"} />
    </>
  );
}
