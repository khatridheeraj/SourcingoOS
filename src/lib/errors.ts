// Turns database errors into words the team understands.
export function friendly(error: { message: string; code?: string } | null | undefined): string {
  if (!error) return "";
  const m = error.message ?? "";
  if (!m && !error.code) return "Something went wrong. Try again.";
  if (m.includes("orders_buyer_po_key")) return "This buyer PO is already in the system. Open the existing order instead.";
  if (m.includes("order_lines_style_key")) return "The same style and colour is on this order twice. Combine them into one line.";
  if (m.includes("buyers_code_key")) return "Another buyer already has this code.";
  if (m.includes("buyer_names_name_key")) return "Another buyer already has this name.";
  if (m.includes("factories_name_key")) return "A factory with this name already exists.";
  if (m.includes("invoices_no_key")) return "That invoice number is already in the system. Open the existing invoice instead.";
  if (m.includes("dispatches_bill_key")) return "That factory bill number is already recorded.";
  if (m.includes("credit_notes_no_key")) return "That credit note number is already in the system.";
  if (m.includes("cheques_no_key")) return "This buyer's cheque with that number is already recorded.";
  if (m.includes("buyers_code_check")) return "Use 2 to 20 capital letters, numbers or dashes for the code.";
  if (m.includes("qc_fail_needs_notes")) return "Write what failed in the notes, so the factory knows what to fix.";
  if (m.includes("qc_defects_within_checked")) return "Defects can't be more than the pieces checked.";
  if (m.includes("qc_cancel_needs_reason")) return "Say why this QC check is being cancelled.";
  if (m.includes("orders_ship_after_po")) return "The ship date can't be before the PO date.";
  if (m.includes("qty_check") || m.includes("order_lines_qty")) return "Every line needs a quantity above zero.";
  if (m.includes("violates foreign key") && m.includes("buyer")) return "This buyer has orders, so it can't be deleted. Mark it inactive instead.";
  if (m.includes("violates foreign key") && m.includes("factor")) return "This factory is on orders, so it can't be deleted. Mark it inactive instead.";
  // The plan check lists what each style still needs; say it the way the team talks.
  if (m.startsWith("The plan is not complete yet. Missing: ")) {
    return "Not ready to approve yet. " + m.slice(39)
      .replaceAll("target after the PO target date: ", "set after the factory's finish date: ")
      .replaceAll("factory later than target: ", "factory's date later than ours: ")
      .replaceAll("target: ", "no target yet: ")
      .replaceAll("factory dates: ", "no factory date yet: ")
      .replaceAll(" | ", "; ");
  }
  if (error.code === "42501" || m.includes("row-level security")) return "You don't have permission to do that.";
  return m;
}

// What the browser itself says when the connection drops in the middle of a save: Chrome, Safari, Firefox, React Native.
export function isDropped(message: string): boolean {
  return /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?|network request failed|network error)$/i.test(message.trim());
}
export const DROPPED = "The connection dropped, so this may not have saved. Check the network and try again.";

// Said when a save reaches the server after the person was signed out (another tab, or the session ran out).
// The page stays as it is, so signing in again in a new tab and tapping the same button saves what was typed.
export const SIGNED_OUT = "You were signed out, so this didn't save. Sign in again in a new tab, then come back and tap this again.";
export const isSignedOut = (message: string) => message.trim() === SIGNED_OUT;

// The words to show for an error a save threw: a dropped connection in plain words, anything else as it came.
export function caught(e: unknown, fallback: string): string {
  if (!(e instanceof Error) || !e.message) return fallback;
  return isDropped(e.message) ? DROPPED : e.message;
}
