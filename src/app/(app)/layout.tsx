import Link from "next/link";
import { redirect } from "next/navigation";
import { Nav } from "@/components/nav";
import { canEditOrders, getMe, roleLabel } from "@/lib/auth";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me) redirect("/login");

  const items = [
    { href: "/", label: "Orders" },
    ...(canEditOrders(me.role) ? [{ href: "/buyers", label: "Buyers" }, { href: "/factories", label: "Factories" }] : []),
    ...(me.role === "owner" || me.role === "accounts" ? [{ href: "/payments", label: "Payments" }] : []),
    ...(me.role === "owner" ? [{ href: "/team", label: "Team" }] : []),
  ];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex w-full max-w-[1180px] flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <Link href="/" className="flex items-baseline gap-2">
            <b className="font-display text-lg tracking-tight">Sourcingo</b>
            <span className="text-[10.5px] uppercase tracking-widest text-muted">OS</span>
          </Link>
          {me.role && <Nav items={items} />}
          <div className="ml-auto flex items-center gap-3 text-xs text-muted">
            <span className="hidden sm:inline">{me.fullName || me.email} · {roleLabel(me.role)}{me.companyName && ` · ${me.companyName}`}</span>
            <form action="/auth/signout" method="post">
              <button className="font-semibold text-accent">Sign out</button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-[1180px] flex-1 flex-col gap-[18px] px-4 pb-16 pt-5">
        {me.role ? children : (
          <div className="empty mt-10">
            <b>You haven&apos;t been added to a company yet</b>
            You are signed in as {me.email}. Ask the owner to add this email in Team, then refresh this page.
          </div>
        )}
      </main>
    </div>
  );
}
