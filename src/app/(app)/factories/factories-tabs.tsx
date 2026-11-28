import Link from "next/link";

// Factories has four views: what each factory is making, styles open for factory quotes, quality by factory, and the list.
export function FactoriesTabs({ at, count }: { at: "work" | "market" | "quality" | "list"; count?: number }) {
  return (
    <nav className="seg" aria-label="Show">
      <Link href="/factories" aria-current={at === "work" ? "page" : undefined}>Work</Link>
      <Link href="/factories/market" aria-current={at === "market" ? "page" : undefined}>Quotes</Link>
      <Link href="/factories/quality" aria-current={at === "quality" ? "page" : undefined}>Quality</Link>
      <Link href="/factories?view=list" aria-current={at === "list" ? "page" : undefined}>Factory list{count != null && <span>{count}</span>}</Link>
    </nav>
  );
}
