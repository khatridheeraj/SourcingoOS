import Link from "next/link";
import { roleLabel, type Me } from "@/lib/auth";
import { isInternal } from "@/lib/roles";

export function AppHeader({ me }: { me: Me }) {
  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Link href="/" className="flex-1 text-2xl font-bold">
        Sourcingo <span className="text-sm uppercase tracking-widest text-muted">OS</span>
      </Link>
      <nav className="flex gap-4 text-sm font-semibold text-accent">
        {isInternal(me.role) && <Link href="/setup">Buyers &amp; factories</Link>}
        {me.role === "owner" && <Link href="/team">People &amp; roles</Link>}
      </nav>
      <span className="text-sm text-muted">
        {me.fullName || me.email}
        {me.role ? ` · ${roleLabel(me.role)}` : ""}
      </span>
      <form action="/auth/signout" method="post">
        <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">Sign out</button>
      </form>
    </header>
  );
}
