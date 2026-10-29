import Link from "next/link";

// A blocker that names something missing elsewhere comes with a link straight to where it is fixed.
export function fixFor(error: string, orderId: string, factoryId?: string): { href: string; label: string } | null {
  if (/buyer's PO isn't on file/i.test(error)) return { href: `/orders/${orderId}#details-po`, label: "Add the buyer's PO" };
  if (/factory's email/i.test(error)) return factoryId ? { href: `/orders/${orderId}/factory-po/${factoryId}#po-details`, label: "Add the factory's email" } : { href: "/factories", label: "Open Factories" };
  if (/style photo first/i.test(error)) return { href: `/orders/${orderId}#tna`, label: "Add the photos" };
  if (/^Not ready to approve yet/.test(error)) return { href: `/orders/${orderId}#tna`, label: "Open the plan" };
  if (/ship date first/i.test(error)) return { href: `/orders/${orderId}#details`, label: "Set the ship date" };
  return null;
}

export function ErrorFix({ error, orderId, factoryId, className }: { error: string; orderId: string; factoryId?: string; className?: string }) {
  const fix = fixFor(error, orderId, factoryId);
  return (
    <p className={className ?? "text-[13px] font-semibold text-bad"} role="alert">
      {error}
      {fix && <>{" "}<Link href={fix.href} className="link">{fix.label}</Link></>}
    </p>
  );
}
