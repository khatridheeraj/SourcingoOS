import { redirect } from "next/navigation";
import { getMe } from "@/lib/auth";

// Plain A4 pages for printing or saving as PDF. No menus.
export default async function PrintLayout({ children }: LayoutProps<"/">) {
  const me = await getMe();
  if (!me?.role) redirect("/login");
  return <div className="print-page">{children}</div>;
}
