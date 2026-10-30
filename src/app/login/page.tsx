import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";
import { safeNext } from "@/lib/next-path";
import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error, next } = await searchParams;
  const to = safeNext(typeof next === "string" ? next : null);
  // Already signed in (an old bookmark, or the back button after signing in): straight to work.
  if (await getMe()) redirect(to);
  return (
    <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-4 py-16">
      <div className="panel !p-8 shadow-[var(--shadow-md)]">
        <div className="brand !p-0 mb-6"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>OS</small></div>
        <h1 className="text-[20px] tracking-tight">Sign in</h1>
        <p className="muted mb-6 mt-1 text-[13.5px]">We&apos;ll email you a link. No password needed.</p>
        <LoginForm linkError={error === "link"} next={to} />
      </div>
    </main>
  );
}
