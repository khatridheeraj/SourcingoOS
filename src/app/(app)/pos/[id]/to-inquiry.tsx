"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { inquiryFromEmail } from "../../inquiries/actions";

// An email that isn't a PO but a buyer asking for prices or samples becomes an inquiry, with the email kept on it.
export function ToInquiry({ id }: { id: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn" disabled={pending} onClick={() => start(async () => {
        setError("");
        const res = await inquiryFromEmail(id);
        if (res.error || !res.id) return setError(res.error ?? "It didn't save. Try again.");
        router.push(`/inquiries/${res.id}`);
      })}>
        {pending ? "Making it…" : "It's an inquiry"}
      </button>
      {error && <span className="text-[13px] font-semibold text-bad" role="alert">{error}</span>}
    </>
  );
}
