import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type Login = { email: string; user_id: string; factory: string } | null;

// A factory's WhatsApp link. It signs the phone in to that factory's panel, with no email or password.
// Someone already signed in as another person is asked first, so a team member opening it doesn't lose their own login.
export default async function FactoryLinkPage({ params, searchParams }: PageProps<"/f/[secret]">) {
  const { secret } = await params;
  const { lang, failed } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("factory_link_login", { p_secret: secret });
  const login = data as Login;
  const open = `/f/${encodeURIComponent(secret)}/open${lang === "hi" || lang === "en" ? `?lang=${lang}` : ""}`;
  const me = login ? await getMe() : null;
  if (login && me?.id === login.user_id) redirect("/factory");
  if (login && !me && !failed) redirect(open);

  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center px-4 py-16">
      <div className="panel !p-8 shadow-[var(--shadow-md)]">
        <div className="brand !p-0 mb-6"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>Factory</small></div>
        {!login ? (
          <>
            <h1 className="text-[20px] tracking-tight">This link no longer works</h1>
            <p className="muted mt-2 text-[14px]">Ask Sourcingo to send you the new link on WhatsApp.</p>
            <p className="muted mt-1 text-[14px]">यह लिंक अब नहीं चलता। Sourcingo से WhatsApp पर नया लिंक माँगें।</p>
          </>
        ) : failed ? (
          <>
            <h1 className="text-[20px] tracking-tight">Couldn&apos;t open {login.factory}&apos;s panel</h1>
            <p className="muted mt-2 text-[14px]">Check your internet and try again. / इंटरनेट देखकर फिर से खोलें।</p>
            <a className="btn primary mt-6 w-full" href={open}>Try again / फिर से खोलें</a>
          </>
        ) : (
          <>
            <h1 className="text-[20px] tracking-tight">Open {login.factory}&apos;s panel?</h1>
            <p className="muted mt-2 text-[14px]">
              This is {login.factory}&apos;s factory link. You are signed in as {me?.fullName || me?.email}; opening it signs you out of that account on this device.
            </p>
            <form action={open} method="post" className="mt-6 grid gap-2">
              <button className="btn primary w-full">Open {login.factory}&apos;s panel</button>
              <a className="btn w-full" href="/today">Stay signed in as myself</a>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
