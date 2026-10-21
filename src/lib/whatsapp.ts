// WhatsApp wants the number with its country code and no signs; Indian numbers are usually saved without +91.
export function waNumber(phone: string | null | undefined): string {
  let d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  return d.length >= 11 ? d : "";
}

// A link that opens WhatsApp with the text ready: to the number when there is one, else to a chat the sender picks.
export const waLink = (text: string, phone?: string | null) => `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(text)}`;
