import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Login = { email: string; user_id: string } | null;

// A buyer's status link. It opens the buyer's live order status on any phone, with no email or password.
// Someone already signed in as another person is asked first, so a team member opening it doesn't lose their own login.
export default async function BuyerLinkPage({ params, searchParams }: PageProps<"/s/[secret]">) {
  const { secret } = await params;
  const { failed } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("buyer_link_login", { p_secret: secret });
  const login = data as Login;
  const open = `/s/${encodeURIComponent(secret)}/open`;
  const me = login ? await getMe() : null;
  if (login && me?.id === login.user_id) redirect("/buyer");
  if (login && !me && !failed) redirect(open);

  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-4 py-16">
      <div className="panel !p-8 shadow-[var(--shadow-md)]">
        <div className="brand !p-0 mb-6"><span className="brand-mark" aria-hidden>S</span>Sourcingo</div>
        {!login ? (
          <>
            <h1 className="text-[20px] tracking-tight">This link no longer works</h1>
            <p className="muted mt-2 text-[14px]">Ask your Sourcingo contact for the new link.</p>
          </>
        ) : failed ? (
          <>
            <h1 className="text-[20px] tracking-tight">Couldn&apos;t open your order status</h1>
            <p className="muted mt-2 text-[14px]">Check your internet connection and try again.</p>
            <a className="btn primary mt-6 w-full" href={open}>Try again</a>
          </>
        ) : (
          <>
            <h1 className="text-[20px] tracking-tight">Open this buyer&apos;s order status?</h1>
            <p className="muted mt-2 text-[14px]">
              You are signed in as {me?.fullName || me?.email}. Opening a buyer&apos;s status link signs you out of that account on this device.
            </p>
            <form action={open} method="post" className="mt-6 grid gap-2">
              <button className="btn primary w-full">Open order status</button>
              <a className="btn w-full" href="/today">Stay signed in as myself</a>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
