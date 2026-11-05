// The checks an inquiry must pass before it is saved, shared by the inquiry form (so the box is marked and focused
// before anything is sent) and the save (so it can't be skipped). Quantity and price are read the way people type
// them: "1,200", "1200 pcs", "Rs. 250", "₹ 1,250.50".
import { amountText } from "./payments.ts";

export type InquiryField = "buyer_id" | "prospect" | "product" | "est_qty" | "target_price" | "next_follow_up";
export type InquiryCheck = {
  buyer_id: string; prospect: string; product: string; est_qty: string; target_price: string; next_follow_up: string;
};

export const qtyText = (s: string) => s.replace(/[,\s]/g, "").replace(/(pcs|pieces|piece|pc|metres|metre|meters|meter|mtrs|mtr|m)$/i, "");
export const priceText = (s: string) => amountText(s);
const isDate = (d: string) => !d || /^\d{4}-\d{2}-\d{2}$/.test(d);

// newBuyer: the form's "A new buyer, not in the list" is picked. today: India date, to refuse a follow-up in the past
// (left out on edit, where an old follow-up date may stay as it was).
export function inquiryProblem(i: InquiryCheck, o: { newBuyer?: boolean; today?: string } = {}): { field: InquiryField; error: string } | null {
  if (!i.buyer_id && !i.prospect.trim()) {
    return o.newBuyer ? { field: "prospect", error: "Type the new buyer's name." } : { field: "buyer_id", error: "Pick the buyer, or choose \"A new buyer\" and type the name." };
  }
  if (!i.product.trim()) return { field: "product", error: "Say what the buyer is asking for." };
  const qty = qtyText(i.est_qty);
  if (qty && !(/^\d+$/.test(qty) && Number(qty) > 0)) return { field: "est_qty", error: "The quantity must be a whole number above zero, like 1200." };
  if (i.target_price.trim() && (!priceText(i.target_price) || /-\s*\d/.test(i.target_price))) return { field: "target_price", error: "The target price must be a number, like 250 or 250.50." };
  if (!isDate(i.next_follow_up)) return { field: "next_follow_up", error: "Enter the follow-up as a date." };
  if (o.today && i.next_follow_up && i.next_follow_up < o.today) return { field: "next_follow_up", error: "The follow-up can't be in the past. Pick today or a later day." };
  return null;
}
