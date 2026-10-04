import { redirect } from "next/navigation";
import { Shell } from "@/components/sidebar";
import { getMe, roleLabel } from "@/lib/auth";
import { navCounts } from "@/lib/counts";
import { navFor } from "@/lib/nav";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  const badges = await navCounts(me.role);
  const who = `${me.fullName || me.email}${me.role ? ` · ${roleLabel(me.role)}` : ""}`;
  return <Shell nav={navFor(me.role)} badges={badges} who={who}>{children}</Shell>;
}
