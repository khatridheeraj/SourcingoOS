import { day, SHIP_QC } from "./format.ts";

// Shipping goes by each style's latest final QC or re-check: by check date, then by when it was entered (the database's
// final_qc_passed_shipping). A check entered late with the wrong date, such as a first inspection's Fail typed in days
// after the re-check's Pass with today's date, quietly becomes the latest and blocks the goods. Before such a check is
// saved, say which result shipping will go by.
export type ShipQcStyle = { style: string; latest?: { result: string; on: string } };

export function shipQcNote(styles: ShipQcStyle[], kind: string, result: string, on: string): string {
  if (!SHIP_QC.includes(kind) || (result !== "pass" && result !== "fail") || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return "";
  const word = (r: string) => (r === "pass" ? "Pass" : "Fail");
  const flips = styles.filter((s) => s.latest && s.latest.result !== result);
  if (!flips.length) return "";
  // The same date counts as later: the newer entry wins a tie.
  const after = flips.filter((s) => on >= s.latest!.on);
  // A Pass after a Fail is the normal re-check: nothing to warn about. A Fail after a Pass blocks the goods.
  if (after.length && result === "fail") {
    const s = after[0];
    const who = after.length === 1 ? s.style : `${after.length} styles`;
    return `Shipping will go by this Fail for ${who}, not the Pass of ${day(s.latest!.on)}. Entering an older inspection? Set the day it was done.`;
  }
  const s = flips.find((x) => on < x.latest!.on);
  if (!s) return "";
  return `The ${word(s.latest!.result)} of ${day(s.latest!.on)} on ${s.style} is later, so shipping still goes by it.`;
}
