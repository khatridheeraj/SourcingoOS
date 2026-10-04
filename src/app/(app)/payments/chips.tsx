import { CHEQUE_LABEL, type ChequeRow, type ChequeStatus, INVOICE_LABEL, type InvoiceRow } from "@/lib/payments";

const CHEQUE_TONE: Record<ChequeStatus, string> = { in_hand: "info", deposited: "warn", cleared: "ok", bounced: "bad", cancelled: "" };

export function ChequeChip({ c, today }: { c: Pick<ChequeRow, "status" | "cheque_date" | "stale">; today: string }) {
  if (c.stale) return <span className="chip bad">Expired</span>;
  if (c.status === "in_hand" && c.cheque_date <= today) return <span className="chip warn">Deposit now</span>;
  return <span className={`chip ${CHEQUE_TONE[c.status]}`}>{CHEQUE_LABEL[c.status]}</span>;
}

export function InvoiceChip({ i }: { i: Pick<InvoiceRow, "state" | "overdue"> }) {
  // Past due but a cheque is in: the money hinges on that cheque clearing.
  if (i.overdue && i.state === "covered") return <span className="chip warn" title="Past due. Waiting for the cheque to clear.">Not cleared yet</span>;
  if (i.overdue) return <span className="chip bad">Overdue</span>;
  const tone = { no_amount: "warn", paid: "ok", covered: "info", part: "warn", open: "" }[i.state];
  return <span className={`chip ${tone}`}>{INVOICE_LABEL[i.state]}</span>;
}
