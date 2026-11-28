import { requireBuyerDetails } from "@/lib/auth";

// Claims are the buyer's: people with Buyer details decide them, and Quality reads them for the goods.
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireBuyerDetails({ quality: true });
  return children;
}
