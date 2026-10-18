import { redirect } from "next/navigation";

// The orders list lives at the home of the app; a typed or bookmarked /orders goes there.
export default async function OrdersIndex({ searchParams }: PageProps<"/orders">) {
  const sp = await searchParams;
  const q = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" ? [[k, v]] : [])));
  redirect(q.size ? `/?${q}` : "/");
}
