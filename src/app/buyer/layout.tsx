import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";

// A buyer's own page: only for buyer logins. Read-only, built for a phone first.
export default async function BuyerLayout({ children }: LayoutProps<"/buyer">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "buyer") redirect(me.role === "factory" ? "/factory" : "/today");

  return (
    <div className="flex min-h-full flex-col">
      <header className="fbar">
        <div className="brand"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>Buyer</small></div>
        <span className="hide-phone ml-auto text-[13px] text-muted">{me.fullName || me.email}</span>
        <form action="/auth/signout" method="post" className="ml-auto sm:ml-0">
          <button className="btn ghost sm">Sign out</button>
        </form>
      </header>
      <main className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col gap-[18px] px-4 pb-16 pt-5">{children}</main>
    </div>
  );
}
