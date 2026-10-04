import { redirect } from "next/navigation";

// All TNA is now the "Update by order" view of TNA.
export default async function AllTna({ searchParams }: PageProps<"/tna/all">) {
  const { so } = await searchParams;
  redirect(`/tna?view=orders${so ? `&so=${encodeURIComponent(String(so))}` : ""}`);
}
