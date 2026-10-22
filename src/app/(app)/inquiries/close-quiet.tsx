"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "@/components/toast";
import { setInquiryStatus } from "./actions";

// One tap closes an inquiry that has gone quiet, as lost for no reply. It can be opened again from its page.
export function CloseQuiet({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn sm" disabled={pending} onClick={() => start(async () => {
      const res = await setInquiryStatus(id, "lost", { lost_reason: "No reply from the buyer" });
      if (res.error) return toast(res.error, "bad");
      toast("Closed. Open it again from its page if they come back.");
      router.refresh();
    })}>
      {pending ? "Closing…" : "Close"}
    </button>
  );
}
