// The Sourcingo Guarantee for a factory: for each order it makes, what it is owed for its goods and the day it is paid by,
// counted from the day its goods pass Sourcingo's Final QC. Never the buyer, the buyer's price or another factory.
import { dayNear as day, money, todayIST } from "@/lib/format";
import { factoryPay, type GuaranteeTerms } from "@/lib/guarantee";
import type { Lang } from "./i18n";

export type FactoryGuaranteeData = {
  shown: boolean; terms?: GuaranteeTerms;
  orders?: { order_id: string; order_no: string; status: string; cost: number; passed_on: string | null; paid: number }[];
};

const WORDS = {
  en: {
    title: "Paid soon after QC",
    sub: (n: number) => `Sourcingo pays you within ${n} days of your goods passing our Final QC.`,
    preview: "Preview: the factory sees this once the Sourcingo Guarantee is turned on.",
    waiting: "Paid after your goods pass Final QC",
    payBy: (d: string) => `Passed. Paid by ${d}`,
    late: (d: string) => `Due since ${d}. Sourcingo will pay it now`,
    paid: "Paid",
    paidPart: (m: string) => `${m} paid`,
    help: "Amounts are your PO value for the pieces on each order. Payments still come through Sourcingo's accounts as usual; claims for faults found later come off as debit notes.",
    how: "How this works",
  },
  hi: {
    title: "QC के बाद जल्दी पेमेंट",
    sub: (n: number) => `आपका माल Sourcingo के फाइनल QC में पास होने के ${n} दिन के अंदर पेमेंट।`,
    preview: "प्रीव्यू: Sourcingo गारंटी चालू होने पर फैक्ट्री को यह दिखेगा।",
    waiting: "माल फाइनल QC में पास होने के बाद पेमेंट",
    payBy: (d: string) => `पास हुआ। ${d} तक पेमेंट`,
    late: (d: string) => `${d} से बाकी। Sourcingo अभी पेमेंट करेगा`,
    paid: "पेमेंट हो गया",
    paidPart: (m: string) => `${m} मिला`,
    help: "रकम हर ऑर्डर के पीस की आपकी PO कीमत है। पेमेंट पहले की तरह Sourcingo के अकाउंट्स से आते हैं; बाद में मिली खराबी के क्लेम डेबिट नोट से कटते हैं।",
    how: "यह कैसे काम करता है",
  },
};

export function FactoryGuarantee({ data, lang, preview }: { data: FactoryGuaranteeData | null; lang: Lang; preview: boolean }) {
  const w = WORDS[lang];
  const orders = (data?.orders ?? []).filter((o) => Number(o.cost) > 0);
  if (!data?.shown || !data.terms || !orders.length) return null;
  const t = data.terms;
  const today = todayIST();
  return (
    <section className="card fmoney" aria-labelledby="fguar-h">
      <header className="card-h">
        <div>
          <h2 id="fguar-h">{w.title}</h2>
          <p>{w.sub(t.pay_days)}</p>
          {preview && !t.live && <p className="muted text-[12.5px]">{w.preview}</p>}
        </div>
      </header>
      <div className="fmoney-part">
        <ul>
          {orders.map((o) => {
            const s = factoryPay(o, t, today);
            return (
              <li key={o.order_id}>
                <span className="fmoney-id">
                  <b className="code">{o.order_no}</b>
                  <small className={s.state === "paid" ? "text-ok" : s.state === "late" ? "text-bad" : undefined}>
                    {s.state === "paid" ? w.paid : s.state === "waiting" ? w.waiting : s.state === "late" ? w.late(day(s.due, today)) : w.payBy(day(s.due, today))}
                  </small>
                </span>
                <span className="fmoney-amt num">
                  <b>{money(s.state === "paid" ? s.amount : s.left)}</b>
                  {s.paid > 0 && s.state !== "paid" && <small>{w.paidPart(money(s.paid))}</small>}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
      <details className="howto fmoney-help">
        <summary>{w.how}</summary>
        <p>{w.help}</p>
      </details>
    </section>
  );
}
