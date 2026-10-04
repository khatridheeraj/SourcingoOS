import Link from "next/link";
import { type Alert, type Buyer, DC_LABEL, GRN_LABEL, type Grn, heldHours, SO_LABEL, TNA_LABEL, type World } from "@/lib/model";

type Status = keyof typeof SO_LABEL | keyof typeof TNA_LABEL | keyof typeof GRN_LABEL | keyof typeof DC_LABEL | "overdue";
const CHIP: Record<Status, [string, string]> = {
  draft: ["", "Draft"],
  tna_review: ["warn", "TNA review"],
  locked: ["lockd", "🔒 Locked"],
  shipped: ["ok", "Shipped"],
  pending: ["", "Pending"],
  in_progress: ["info", "In progress"],
  completed: ["ok", "Completed"],
  delayed: ["warn", "Delayed"],
  overdue: ["bad", "Overdue"],
  pending_approval: ["warn", "Pending approval"],
  approved: ["ok", "Approved"],
  rejected: ["bad", "Rejected"],
  dispatched: ["ok", "Dispatched"],
};

export function Chip({ status }: { status: Status }) {
  const [cls, label] = CHIP[status];
  return <span className={`chip ${cls}`}>{label}</span>;
}

export function Head({ crumbs, title, sub, children }: { crumbs?: React.ReactNode; title: React.ReactNode; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <>
      {crumbs && <div className="crumbs">{crumbs}</div>}
      <div className="head">
        <div className="grow">
          <h1>{title}</h1>
          {sub && <p>{sub}</p>}
        </div>
        {children}
      </div>
    </>
  );
}

export function Tile({ tone, label, value, note, money, href, alarm }: {
  tone?: "blue" | "yellow" | "green" | "pink"; label: string; value: React.ReactNode; note?: React.ReactNode; money?: boolean; href?: string; alarm?: boolean;
}) {
  const cls = `tile ${tone ?? ""} ${alarm ? "alarm" : ""}`;
  const body = (
    <>
      <span>{label}</span>
      <b className={money ? "money" : ""}>{value}</b>
      {note && <small>{note}</small>}
    </>
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Empty({ title, children, wide }: { title: string; children?: React.ReactNode; wide?: boolean }) {
  return (
    <div className="empty" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Problems({ errors, warnings }: { errors?: string[]; warnings?: string[] }) {
  return (
    <>
      {!!errors?.length && (
        <div className="errbox" role="alert">
          <b>Fix {errors.length === 1 ? "1 thing" : `${errors.length} things`} first</b>
          <ul>{errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {!!warnings?.length && (
        <div className="warnbox">
          <b>Check these</b>
          <ul>{warnings.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
    </>
  );
}

// Buyer code everywhere; the owner also sees the real name on hover.
export function BuyerCode({ buyer }: { buyer?: Buyer }) {
  if (!buyer) return <span className="code">—</span>;
  return buyer.real_name ? (
    <span className="code tip" title={buyer.real_name}>{buyer.code}</span>
  ) : (
    <span className="code">{buyer.code}</span>
  );
}

export function HoldChip({ w, g }: { w: World; g: Grn }) {
  if (g.status === "rejected") return null;
  const held = w.grnHeld(g);
  if (!held) return <Chip status="dispatched" />;
  const h = heldHours(g, w.now);
  if (h >= 24) return <span className="chip bad">Held {Math.floor(h)}h · over 24h</span>;
  const left = Math.max(0, Math.ceil(24 - h));
  return <span className={`chip ${h >= 12 ? "warn" : "info"}`}>{left}h left to dispatch</span>;
}

export function Progress({ cells }: { cells: string[] }) {
  if (!cells.length) return <span className="text-xs text-muted">—</span>;
  const done = cells.filter((c) => c === "c").length;
  return (
    <div className="prog" title={`${done} of ${cells.length} checkpoints complete`} aria-label={`${done} of ${cells.length} checkpoints complete`}>
      {cells.map((c, i) => <i key={i} className={c} />)}
    </div>
  );
}

export function AlertList({ alerts, limit, more }: { alerts: Alert[]; limit?: number; more?: React.ReactNode }) {
  if (!alerts.length) return <Empty title="All clear">Nothing overdue, waiting or held.</Empty>;
  const shown = limit ? alerts.slice(0, limit) : alerts;
  return (
    <>
      <div className="alerts">
        {shown.map((a, i) => (
          <div key={i} className={`alert ${a.sev}`}>
            <div>
              <div className="t">{a.t}</div>
              <div className="d">{a.d}</div>
            </div>
            <Link href={a.href} className="btn sm">Open</Link>
          </div>
        ))}
      </div>
      {limit && alerts.length > limit && <p className="mt-2 text-xs text-muted">+{alerts.length - limit} more {more}</p>}
    </>
  );
}

export function Pills({ items, current }: { items: { key: string; label: string; href: string; n?: number }[]; current: string }) {
  return (
    <nav className="filters" aria-label="Filter">
      {items.map((f) => (
        <Link key={f.key} href={f.href} className="pill" aria-current={f.key === current ? "page" : undefined}>
          {f.label}
          {!!f.n && <span className="ml-1.5 rounded-full bg-bad px-1.5 text-xs text-white">{f.n}</span>}
        </Link>
      ))}
    </nav>
  );
}

// File downloads from route handlers (a plain link, not client navigation).
export function Download({ href, children }: { href: string; children: React.ReactNode }) {
  return <a className="btn" href={href} download>{children}</a>;
}
