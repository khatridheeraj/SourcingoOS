import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, Head, Pills, Tile } from "@/components/bits";
import { ClickRow, SearchParamInput } from "@/components/feedback";
import { fmtDateTime, todayIST } from "@/lib/format";
import { addDays, fmtDay, isoIST, money, nf } from "@/lib/model";
import { isOps } from "@/lib/roles";
import { gmailLink, loadPos, PO_STATUS, poQty, poValue } from "./data";
import { PoActions } from "./po-actions";

export const metadata = { title: "POs received · Sourcingo OS" };

const FILTERS = [
  { key: "open", label: "To work" }, { key: "new", label: "New" }, { key: "in_progress", label: "In progress" },
  { key: "converted", label: "Converted" }, { key: "rejected", label: "Rejected" }, { key: "all", label: "All" },
];

export default async function PosPage({ searchParams }: PageProps<"/pos">) {
  const { me, pos, buyer, error } = await loadPos();
  if (!me) redirect("/login");
  if (!isOps(me.role)) redirect("/");
  const sp = await searchParams;
  const filter = FILTERS.some((f) => f.key === sp.status) ? String(sp.status) : "open";
  const q = String(sp.q ?? "").trim().toLowerCase();
  const today = todayIST();
  const week = addDays(today, -6);

  const open = pos.filter((p) => p.status === "new" || p.status === "in_progress");
  const stale = pos.filter((p) => p.status === "new" && isoIST(p.received_at) < today);
  const list = pos
    .filter((p) => filter === "all" || (filter === "open" ? p.status === "new" || p.status === "in_progress" : p.status === filter))
    .filter((p) => {
      if (!q) return true;
      const b = buyer(p.buyer_id);
      return [p.id, p.po_number, b.code, b.real_name, p.sender_name, p.sender_email, p.so_id, p.inquiry_id, p.attachments.join(" "),
        p.lines.map((l) => [l.style_code, l.description, l.colour].join(" ")).join(" ")].join(" ").toLowerCase().includes(q);
    });
  const href = (s: string) => `/pos?status=${s}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const count = (s: string) => (s === "new" ? pos.filter((p) => p.status === "new").length : 0);

  return (
    <>
      <Head crumbs="Sales › POs received" title="POs received" sub="Every buyer PO that arrives by email. Open an inquiry to work it, convert it to a sales order, or reject it." />
      {error && <p className="errbox">Couldn&apos;t load everything: {error.message}</p>}
      <div className="tiles">
        <Tile tone="blue" label="To work" value={open.length} note={`${pos.filter((p) => p.status === "new").length} new · ${pos.filter((p) => p.status === "in_progress").length} in progress`} href={href("open")} />
        <Tile alarm={stale.length > 0} label="New since yesterday or earlier" value={stale.length} note={stale.length ? "Pick these up first" : "All picked up"} href={href("new")} />
        <Tile tone="green" label="Converted to sales orders" value={pos.filter((p) => p.status === "converted").length} href={href("converted")} />
        <Tile tone="pink" label="Received this week" value={pos.filter((p) => isoIST(p.received_at) >= week).length} note="Last 7 days" />
      </div>
      <div className="row">
        <SearchParamInput placeholder="Search PO no, buyer, sender, style" />
        <Pills current={filter} items={FILTERS.map((f) => ({ ...f, href: href(f.key), n: count(f.key) }))} />
      </div>
      {!pos.length ? (
        <Empty title="No POs received yet">Buyer POs picked up from email appear here automatically.</Empty>
      ) : !list.length ? (
        <Empty title="No POs match">Try another filter or search.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="tbl">
            <thead>
              <tr><th>PO</th><th>Buyer</th><th>PO date</th><th>Delivery</th><th>Lines</th><th>From</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const b = buyer(p.buyer_id);
                const value = poValue(p);
                const mail = gmailLink(p.email_thread_id);
                const late = p.delivery_date && p.delivery_date < today && p.status !== "converted" && p.status !== "rejected";
                return (
                  <ClickRow key={p.id} href={`/pos/${p.id}`}>
                    <td>
                      <Link href={`/pos/${p.id}`} className="code font-semibold text-accent">#{p.po_number}</Link>
                      <br /><span className="text-xs text-muted">{p.id} · {fmtDateTime(p.received_at)}</span>
                    </td>
                    <td>{b.real_name ? <span className="code tip" title={b.real_name}>{b.code}</span> : <span className="code">{b.code}</span>}</td>
                    <td className="num whitespace-nowrap">{fmtDay(p.po_date)}</td>
                    <td className={`num whitespace-nowrap ${late ? "text-bad" : ""}`}>{fmtDay(p.delivery_date)}</td>
                    <td className="whitespace-nowrap">
                      {p.lines.length ? (
                        <>
                          {p.lines.length} style{p.lines.length === 1 ? "" : "s"}
                          {poQty(p) > 0 && <> · <b className="num">{nf(poQty(p))} {p.order_type === "fabric" ? "m" : "pcs"}</b></>}
                          {value != null && value > 0 && <span className="block text-xs text-muted">{money(value, p.currency ?? "INR")}</span>}
                        </>
                      ) : <span className="text-xs text-muted">In the PDF</span>}
                    </td>
                    <td>
                      <span>{p.sender_name || p.sender_email || "—"}</span>
                      <span className="block text-xs text-muted">
                        {mail && <a className="link" href={mail} target="_blank" rel="noreferrer">Open email</a>}
                        {mail && p.attachments.length > 0 && " · "}
                        {p.attachments.length > 0 && `${p.attachments.length} attachment${p.attachments.length === 1 ? "" : "s"}`}
                      </span>
                    </td>
                    <td>
                      <span className={`chip ${PO_STATUS[p.status][0]}`}>{PO_STATUS[p.status][1]}</span>
                      {p.status === "rejected" && p.reject_reason && <span className="block max-w-[180px] truncate text-xs text-muted" title={p.reject_reason}>{p.reject_reason}</span>}
                    </td>
                    <td><PoActions compact po={p} /></td>
                  </ClickRow>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
