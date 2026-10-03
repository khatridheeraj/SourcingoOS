import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/app-header";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const me = await getMe();
  if (!me) redirect("/login");

  let waiting = 0;
  if (me.role === "owner") {
    const supabase = await createClient();
    const { count } = await supabase.from("profiles").select("id", { count: "exact", head: true }).eq("active", false);
    waiting = count ?? 0;
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <AppHeader me={me} />

      {waiting > 0 && (
        <Link href="/team" className="rounded-xl bg-accent-soft p-4 font-semibold">
          {waiting === 1 ? "1 person is" : `${waiting} people are`} waiting for you to approve them →
        </Link>
      )}

      {me.role ? (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">You&apos;re signed in</h2>
          <p className="text-muted">Inquiries, sales orders, TNA and the warehouse screens are being moved here next.</p>
        </section>
      ) : (
        <section className="rounded-xl bg-warn-soft p-5 text-warn">
          <h2 className="text-lg font-bold">Waiting for approval</h2>
          <p>Your account is set up. The owner needs to give you a role before you can see any orders.</p>
        </section>
      )}
    </main>
  );
}
