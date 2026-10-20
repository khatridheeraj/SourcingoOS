import { redirect } from "next/navigation";
import { HelpChat, HelpPill } from "@/components/help/help-chat";
import { Toaster } from "@/components/toast";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

// A buyer's own page: only for buyer logins. Read-only, built for a phone first.
export default async function BuyerLayout({ children }: LayoutProps<"/buyer">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "buyer") redirect(me.role === "factory" ? "/factory" : "/today");
  const { data: counts } = await (await createClient()).rpc("help_counts");
  const unseen = Number((counts as { unseen?: number } | null)?.unseen ?? 0);

  return (
    <div className="flex min-h-full flex-col">
      <header className="fbar">
        <div className="brand"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>Buyer</small></div>
        <span className="hide-phone ml-auto text-[13px] text-muted">{me.fullName || me.email}</span>
        <div className="ml-auto sm:ml-0"><HelpPill label="Help" unseen={unseen} /></div>
        <form action="/auth/signout" method="post">
          <button className="btn ghost sm">Sign out</button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-[18px] px-4 pb-16 pt-5">{children}</main>
      {me.companyId && <HelpChat who="buyer" role={me.role} name={me.fullName ?? ""} userId={me.id} companyId={me.companyId} ownerName="Sourcingo" unseen={unseen} />}
      <Toaster />
    </div>
  );
}
