import { Head } from "@/components/bits";
import { NotificationList, type Note } from "@/components/notification-list";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Notifications · Sourcingo OS" };

export default async function Notifications() {
  const supabase = await createClient();
  const { data } = await supabase.from("notifications").select("id, kind, title, body, href, created_at, read_at").order("created_at", { ascending: false }).limit(200);
  return (
    <>
      <Head title="Notifications" sub="What happened on your orders, inquiries and samples. Your morning email sums these up." />
      <NotificationList notes={(data ?? []) as Note[]} />
    </>
  );
}
