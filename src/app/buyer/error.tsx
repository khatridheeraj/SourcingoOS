"use client";

import { PageError } from "@/components/page-error";

export default function BuyerError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <PageError error={error} retry={retry} home="/buyer" />;
}
