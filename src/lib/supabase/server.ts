import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// `headers` adds request headers, such as the one that asks the read functions for a buyer's or factory's preview.
export async function createClient(headers?: Record<string, string>) {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      ...(headers ? { global: { headers } } : {}),
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Called from a Server Component, where cookies are read-only. The proxy refreshes the session.
          }
        },
      },
    },
  );
}
