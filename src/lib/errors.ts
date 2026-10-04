// Turns database errors into words the team understands.
export function friendly(error: { message: string; code?: string } | null | undefined): string {
  if (!error) return "";
  const m = error.message;
  if (m.includes("orders_buyer_po_key")) return "This buyer PO is already in the system. Open the existing order instead.";
  if (m.includes("order_lines_style_key")) return "The same style and colour is on this order twice. Combine them into one line.";
  if (m.includes("buyers_code_key")) return "Another buyer already has this code.";
  if (m.includes("buyer_names_name_key")) return "Another buyer already has this name.";
  if (m.includes("factories_name_key")) return "A factory with this name already exists.";
  if (m.includes("buyers_code_check")) return "Use 2 to 20 capital letters, numbers or dashes for the code.";
  if (m.includes("qty_check") || m.includes("order_lines_qty")) return "Every line needs a quantity above zero.";
  if (m.includes("violates foreign key") && m.includes("buyer")) return "This buyer has orders, so it can't be deleted. Mark it inactive instead.";
  if (m.includes("violates foreign key") && m.includes("factor")) return "This factory is on orders, so it can't be deleted. Mark it inactive instead.";
  if (error.code === "42501" || m.includes("row-level security")) return "You don't have permission to do that.";
  return m;
}
