"use client";

import { useState, useTransition } from "react";
import "./factory-bits.css";
import { toast } from "@/components/toast";

export type OrderRating = { order_id: string; score: number; comment: string | null; created_at: string };

const SAY = ["", "Poor", "Below what we expected", "Okay", "Good", "Excellent"];

// Under a PO whose goods have left: how did this order go? Five stars and a comment, private to Sourcingo. The buyer
// can change it for 30 days. In a team member's preview it only shows what the buyer gave.
export function RateOrder({ orderId, rating, canWrite, rate, today }: {
  orderId: string; rating: OrderRating | null; canWrite: boolean; today: string;
  rate: (orderId: string, score: number, comment: string) => Promise<{ error?: string }>;
}) {
  const [score, setScore] = useState(rating?.score ?? 0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState(rating?.comment ?? "");
  const [editing, setEditing] = useState(!rating);
  const [error, setError] = useState("");
  const [pending, start] = useTransition();
  const monthAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 29 * 86_400_000).toISOString().slice(0, 10);
  const editable = canWrite && (!rating || rating.created_at.slice(0, 10) >= monthAgo);

  if (!editing || !canWrite) {
    if (!rating) return canWrite ? null : <p className="rate-box muted text-[13px]">Not rated by the buyer yet.</p>;
    return (
      <div className="rate-box">
        <span className="stars" aria-label={`${rating.score} of 5`}>{"★".repeat(rating.score)}<s>{"★".repeat(5 - rating.score)}</s></span>
        <span className="text-[13px]">{rating.comment ? `“${rating.comment}”` : SAY[rating.score]}</span>
        {editable && <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>Change</button>}
      </div>
    );
  }

  function send(e: React.FormEvent) {
    e.preventDefault();
    if (!score) return setError("Pick 1 to 5 stars.");
    setError("");
    start(async () => {
      const r = await rate(orderId, score, comment);
      if (r.error) return setError(r.error);
      toast("Thank you. Only Sourcingo reads this.");
      setEditing(false);
    });
  }

  const shown = hover || score;
  return (
    <form className="rate-box rate-form" onSubmit={send} noValidate>
      <b className="text-[14px]">How did this order go?</b>
      <div className="rate-stars" role="radiogroup" aria-label="Stars" onMouseLeave={() => setHover(0)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" role="radio" aria-checked={score === n} aria-label={`${n} ${n === 1 ? "star" : "stars"}`}
            className={n <= shown ? "on" : ""} onMouseEnter={() => setHover(n)} onClick={() => setScore(n)}>★</button>
        ))}
        <span className="muted text-[13px]">{SAY[shown]}</span>
      </div>
      {score > 0 && (
        <>
          <textarea className="inp" rows={2} maxLength={600} value={comment} onChange={(e) => setComment(e.target.value)}
            placeholder={score <= 3 ? "What went wrong? We read every word." : "Anything to keep or improve? (optional)"} aria-label="Comment" />
          {error && <div className="errbox" role="alert">{error}</div>}
          <div className="row">
            <button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send rating"}</button>
            <small className="muted">Private to Sourcingo.</small>
          </div>
        </>
      )}
    </form>
  );
}
