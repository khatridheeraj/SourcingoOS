import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { HelpChat, HelpPill } from "@/components/help/help-chat";
import { Toaster } from "@/components/toast";
import { createClient } from "@/lib/supabase/server";
import { LANG_COOKIE, langOf, words } from "./i18n";
import { LangSwitch } from "./lang-switch";
import { marketWords } from "./market-words";
import { FactoryTabs } from "./factory-tabs";

// A factory's own panel: only for factory logins. Built to be used on a phone on the factory floor.
export default async function FactoryLayout({ children }: LayoutProps<"/factory">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "factory") redirect(me.role === "buyer" ? "/buyer" : "/today");
  const lang = langOf((await cookies()).get(LANG_COOKIE)?.value);
  const w = words(lang);
  const supabase = await createClient();
  const [{ data: counts }, { data: open }] = await Promise.all([supabase.rpc("help_counts"), supabase.rpc("market_open_count")]);
  const unseen = Number((counts as { unseen?: number } | null)?.unseen ?? 0);

  return (
    <div className="flex min-h-full flex-col">
      <header className="fbar">
        <div className="brand"><span className="brand-mark" aria-hidden>S</span><span className="fbar-name">Sourcingo</span><small>{w.panel}</small></div>
        <span className="hide-phone ml-auto text-[13px] text-muted">{me.fullName || me.email}</span>
        <div className="ml-auto flex items-center gap-2 sm:ml-0"><HelpPill label={lang === "hi" ? "मदद" : "Help"} unseen={unseen} /><LangSwitch lang={lang} /></div>
        {/* A WhatsApp-link login has no email to sign back in with, so it has no Sign out: the link is the way in. */}
        {!me.email?.endsWith("@links.sourcingo.in") && (
          <form action="/auth/signout" method="post">
            <button className="btn ghost sm">{w.signOut}</button>
          </form>
        )}
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-[18px] px-4 pb-16 pt-5">
        {/* Its own orders, and the shop of styles Sourcingo is placing now. */}
        <FactoryTabs label={marketWords(lang).title} tabs={[{ href: "/factory", label: marketWords(lang).tabOrders }, { href: "/factory/market", label: marketWords(lang).tabShop, count: Number((open as number | null) ?? 0) }]} />
        {children}
      </main>
      {me.companyId && <HelpChat who="factory" role={me.role} name="" userId={me.id} companyId={me.companyId} lang={lang} unseen={unseen} />}
      <Toaster />
    </div>
  );
}
