import Link from "next/link";

// What a buyer's record still lacks before a paper we issue can go out (from gapsFor() in src/lib/buyer-profile.ts),
// shown above the dispatch area and the export papers, with the way to fix it.
export function BuyerGaps({ buyerId, buyer, gaps, what }: { buyerId: string; buyer: string; gaps: string[]; what: string }) {
  if (!gaps.length) return null;
  return (
    <div className="warnbox stack gap-1" role="status">
      <b>{buyer}&apos;s details are missing for {what}</b>
      <ul className="list-disc pl-5">{gaps.map((g) => <li key={g}>{g.replace(/^Buyer: /, "")}</li>)}</ul>
      <Link className="link self-start" href={`/buyers/${buyerId}`}>Add them on {buyer}&apos;s record</Link>
    </div>
  );
}
