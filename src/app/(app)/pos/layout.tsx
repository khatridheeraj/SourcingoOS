import { requireBuyerDetails } from "@/lib/auth";

// Only for people with Buyer details (Team switch); the database holds the same line.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireBuyerDetails();
  return children;
}
