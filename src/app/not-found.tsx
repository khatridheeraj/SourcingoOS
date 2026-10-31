import Link from "next/link";

// A web address that matches no screen at all (a typo, or an old link): the brand, plain words and a way in.
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-10">
      <div className="empty" role="status">
        <b>This page doesn&apos;t exist</b>
        The link may have a typo, or the page has moved.
        <div className="mt-3 flex justify-center">
          <Link href="/today" className="btn">Go to Sourcingo</Link>
        </div>
      </div>
    </main>
  );
}
