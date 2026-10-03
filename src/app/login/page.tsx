import { LoginForm } from "./login-form";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-4 py-16">
      <h1 className="text-2xl font-bold">
        Sourcingo <span className="text-sm uppercase tracking-widest text-muted">OS</span>
      </h1>
      <LoginForm linkError={error === "link"} />
    </main>
  );
}
