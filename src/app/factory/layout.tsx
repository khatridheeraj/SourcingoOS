import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { Toaster } from "@/components/toast";

// A factory's own panel: only for factory logins. Built to be used on a phone on the factory floor.
export default async function FactoryLayout({ children }: LayoutProps<"/factory">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "factory") redirect("/");

  return (
    <div className="flex min-h-full flex-col">
      <header className="fbar">
        <div className="brand"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>Factory</small></div>
        <span className="hide-phone ml-auto text-[13px] text-muted">{me.fullName || me.email}</span>
        <form action="/auth/signout" method="post" className="ml-auto sm:ml-0">
          <button className="btn ghost sm">Sign out</button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-[18px] px-4 pb-16 pt-5">{children}</main>
      <Toaster />
    </div>
  );
}
