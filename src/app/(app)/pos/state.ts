// How each incoming PO's state shows.
export const STATE: Record<string, { label: string; cls: string }> = {
  receiving: { label: "Arriving", cls: "chip" },
  reading: { label: "AI reading…", cls: "chip info" },
  to_check: { label: "To check", cls: "chip warn" },
  failed: { label: "Couldn't read", cls: "chip bad" },
  added: { label: "Added", cls: "chip ok" },
  not_po: { label: "Set aside", cls: "chip" },
};
