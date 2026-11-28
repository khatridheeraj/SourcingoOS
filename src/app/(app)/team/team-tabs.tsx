import Link from "next/link";

// Team has two views for the owner: the people and what each may see, and the company's data (downloads, backups, alerts).
export function TeamTabs({ at }: { at: "people" | "data" }) {
  return (
    <nav className="seg self-start" aria-label="Show">
      <Link href="/team" aria-current={at === "people" ? "page" : undefined}>People</Link>
      <Link href="/team/data" aria-current={at === "data" ? "page" : undefined}>Data</Link>
    </nav>
  );
}
