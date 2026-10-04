"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { decideGrn } from "../actions";

export function GrnDecision({ id, hasDcs }: { id: string; hasDcs: boolean }) {
  const { toast, confirm } = useFeedback();
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (d: "approved" | "rejected") =>
    start(async () => {
      const r = await decideGrn(id, d);
      toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
      if (r.ok) router.refresh();
    });
  return (
    <>
      {!hasDcs && (
        <button type="button" className="btn danger" disabled={pending} onClick={async () => {
          if (await confirm(`Reject ${id}? Its quantities won't count as received, and it can't be dispatched.`, "Reject", true)) run("rejected");
        }}>Reject</button>
      )}
      <button type="button" className="btn dark" disabled={pending} onClick={() => run("approved")}>Approve</button>
    </>
  );
}
