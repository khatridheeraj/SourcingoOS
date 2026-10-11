export type Role = "owner" | "manager" | "merchandiser" | "accounts" | "quality" | "factory";

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Everything, including payments, real buyer names and the team" },
  { value: "manager", label: "Manager", hint: "Orders and factories, no payments" },
  { value: "merchandiser", label: "Merchandiser", hint: "Orders and factories, no payments" },
  { value: "accounts", label: "Accounts", hint: "Orders, factories and payments" },
  { value: "quality", label: "Quality", hint: "Records QC checks and photos, and enters done dates. Sees orders, no prices or payments" },
  { value: "factory", label: "Factory", hint: "A factory's own login. Enters that factory's TNA dates for its POs and sees nothing else" },
];

// Roles the owner can switch a staff member between (a factory login stays a factory login).
export const STAFF_ROLES = ROLES.filter((r) => r.value !== "factory");

export const roleLabel = (role: Role | null | undefined) => ROLES.find((r) => r.value === role)?.label ?? "Not added yet";

// Records, cancels and photographs QC checks.
export const canRecordQc = (role: Role | null | undefined) => role === "owner" || role === "quality";
// Changes orders, production and factories, and sees prices. Everyone except Quality.
export const canEditOrders = (role: Role | null | undefined) => !!role && role !== "quality" && role !== "factory";
// Enters done dates on the TNA: the orders team and Quality.
export const canEnterDone = (role: Role | null | undefined) => canEditOrders(role) || role === "quality";
