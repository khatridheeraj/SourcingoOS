"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useFeedback } from "@/components/feedback";
import { deleteQc } from "../actions";

export function DeleteQc({ id }: { id: string }) {
  const { toast, confirm } = useFeedback();
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button type="button" className="btn danger" disabled={pending} onClick={async () => {
      if (!(await confirm(`Delete ${id} and its photos? Use this only for a mistake.`, "Delete", true))) return;
      start(async () => {
        const r = await deleteQc(id);
        toast(r.error ?? r.ok ?? "", r.error ? "bad" : undefined);
        if (!r.error) router.push("/qc");
      });
    }}>Delete</button>
  );
}
