export type Role = "owner" | "manager" | "merchandiser" | "accounts" | "quality";

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Everything, including payments, real buyer names and the team" },
  { value: "manager", label: "Manager", hint: "Orders and factories, no payments" },
  { value: "merchandiser", label: "Merchandiser", hint: "Orders and factories, no payments" },
  { value: "accounts", label: "Accounts", hint: "Orders, factories and payments" },
  { value: "quality", label: "Quality", hint: "Records QC checks and photos. Sees orders, no prices or payments" },
];

export const roleLabel = (role: Role | null | undefined) => ROLES.find((r) => r.value === role)?.label ?? "Not added yet";

// Records, cancels and photographs QC checks.
export const canRecordQc = (role: Role | null | undefined) => role === "owner" || role === "quality";
// Changes orders, production and factories, and sees prices. Everyone except Quality.
export const canEditOrders = (role: Role | null | undefined) => !!role && role !== "quality";
