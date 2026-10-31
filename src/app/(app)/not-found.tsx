import Link from "next/link";

// An order, PO, invoice or inquiry that isn't there: deleted, or a link with a typo. Said in plain words inside the
// app, with a way on, instead of a bare "404".
export default function NotFound() {
  return (
    <div className="empty mt-6" role="status">
      <b>This isn&apos;t here any more</b>
      It was deleted, or the link is wrong. If a PO was deleted by mistake, the owner can bring it back from Orders, Cancelled.
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <Link href="/?status=cancelled#deleted" className="btn">Orders, Cancelled</Link>
        <Link href="/today" className="btn ghost">Go to Home</Link>
      </div>
    </div>
  );
}
