import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";

// A factory's own panel: only for factory logins.
export default async function FactoryLayout({ children }: LayoutProps<"/factory">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "factory") redirect("/");

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <b className="font-display text-lg tracking-tight">Sourcingo</b>
            <span className="text-[10.5px] uppercase tracking-widest text-muted">Factory panel</span>
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted">
            <span className="hidden sm:inline">{me.fullName || me.email}</span>
            <form action="/auth/signout" method="post">
              <button className="font-semibold text-accent">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-[18px] px-4 pb-16 pt-5">{children}</main>
    </div>
  );
}
