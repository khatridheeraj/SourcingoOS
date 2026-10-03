import Link from "next/link";
import { roleLabel, type Me } from "@/lib/auth";

export function AppHeader({ me }: { me: Me }) {
  return (
    <header className="flex flex-wrap items-center gap-3">
      <Link href="/" className="flex-1 text-2xl font-bold">
        Sourcingo <span className="text-sm uppercase tracking-widest text-muted">OS</span>
      </Link>
      {me.role === "owner" && (
        <Link href="/team" className="text-sm font-semibold text-accent">
          People &amp; roles
        </Link>
      )}
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
