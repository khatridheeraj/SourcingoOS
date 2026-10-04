import Link from "next/link";
import { redirect } from "next/navigation";
import { Feedback } from "@/components/feedback";
import { getMe } from "@/lib/auth";

// A light, phone-first frame for factory and buyer logins.
export default async function PortalLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");
  if (me.role !== "factory" && me.role !== "buyer") redirect("/");
  const home = me.role === "factory" ? "/factory" : "/buyer";
  return (
    <Feedback>
      <header className="sticky top-0 z-30 border-b border-line bg-background">
        <div className="mx-auto flex w-full max-w-[920px] items-center gap-3 px-4 py-3">
          <Link href={home} className="flex items-baseline gap-2">
            <b className="font-display text-xl tracking-tight">Sourcingo</b>
            <span className="text-[10.5px] uppercase tracking-widest text-muted">{me.role === "factory" ? "Factory" : "Buyer"}</span>
          </Link>
          <span className="ml-auto truncate text-[12.5px] text-muted">{me.fullName || me.email}</span>
          <form action="/auth/signout" method="post">
            <button className="btn sm">Sign out</button>
          </form>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[920px] flex-col gap-[18px] px-4 pb-[72px] pt-5">{children}</main>
    </Feedback>
  );
}
