import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center px-4 py-16">
      <div className="panel !p-8 shadow-[var(--shadow-md)]">
        <div className="brand !p-0 mb-6"><span className="brand-mark" aria-hidden>S</span>Sourcingo<small>OS</small></div>
        <h1 className="text-[20px] tracking-tight">Sign in</h1>
        <p className="muted mb-6 mt-1 text-[13.5px]">We&apos;ll email you a link. No password needed.</p>
        <LoginForm linkError={error === "link"} />
      </div>
    </main>
  );
}
