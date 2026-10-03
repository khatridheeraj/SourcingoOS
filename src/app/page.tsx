import { createClient } from "@/lib/supabase/server";

const ROLE_LABEL: Record<string, string> = {
  owner: "Owner",
  merchandiser: "Merchandiser",
  manager: "Merchandiser manager",
  qc: "QC",
  accounts: "Accounts",
  factory: "Factory",
  buyer: "Buyer",
};

export default async function Home() {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  const { data: profile } = await supabase
    .from("profiles")
    .select("email, full_name, role, active")
    .eq("id", claims?.claims.sub ?? "")
    .maybeSingle();

  const approved = profile?.active && profile.role;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-10">
      <header className="flex items-center gap-3">
        <h1 className="flex-1 text-2xl font-bold">
          Sourcingo <span className="text-sm uppercase tracking-widest text-muted">OS</span>
        </h1>
        <span className="text-sm text-muted">
          {profile?.full_name || profile?.email}
          {approved ? ` · ${ROLE_LABEL[profile.role!]}` : ""}
        </span>
        <form action="/auth/signout" method="post">
          <button className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold">Sign out</button>
        </form>
      </header>

      {approved ? (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-lg font-bold">You&apos;re signed in</h2>
          <p className="text-muted">Inquiries, sales orders, TNA and the warehouse screens are being moved here next.</p>
        </section>
      ) : (
        <section className="rounded-xl bg-warn-soft p-5 text-warn">
          <h2 className="text-lg font-bold">Waiting for approval</h2>
          <p>Your account is set up. Dheeraj needs to give you a role before you can see any orders.</p>
        </section>
      )}
    </main>
  );
}
