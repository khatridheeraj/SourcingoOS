import { redirect } from "next/navigation";
import { Shell } from "@/components/sidebar";
import { getMe, roleLabel } from "@/lib/auth";
import { navCounts } from "@/lib/counts";
import { loadWorld } from "@/lib/data";
import { navFor, QUICK_ACTIONS } from "@/lib/nav";
import { isInternal, isOps } from "@/lib/roles";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role === "factory") redirect("/factory");
  if (me.role === "buyer") redirect("/buyer");
  const badges = isInternal(me.role) ? navCounts((await loadWorld()).world, me.role) : {};
  const who = `${me.fullName || me.email}${me.role ? ` · ${roleLabel(me.role)}` : ""}`;
  return (
    <Shell nav={navFor(me.role)} badges={badges} who={who} actions={isOps(me.role) ? QUICK_ACTIONS : []}>
      {children}
    </Shell>
  );
}
