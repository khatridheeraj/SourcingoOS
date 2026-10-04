export type Role = "owner" | "merchandiser" | "manager" | "qc" | "accounts" | "factory" | "buyer";

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Everything, including locks, approvals and real buyer names" },
  { value: "manager", label: "Merchandiser manager", hint: "Runs orders and manages factories" },
  { value: "merchandiser", label: "Merchandiser", hint: "Inquiries, sales orders and TNA" },
  { value: "qc", label: "QC", hint: "Runs orders and records quality checks" },
  { value: "accounts", label: "Accounts", hint: "Payments and cheques; reads orders, GRNs and challans" },
  { value: "factory", label: "Factory", hint: "Factory portal: only their own orders" },
  { value: "buyer", label: "Buyer", hint: "Buyer portal: only their own orders" },
];

export const roleLabel = (role: Role | null | undefined) => ROLES.find((r) => r.value === role)?.label ?? "No role";

export const INTERNAL_ROLES: Role[] = ["owner", "merchandiser", "manager", "qc", "accounts"];
export const isInternal = (role: Role | null | undefined) => !!role && INTERNAL_ROLES.includes(role);
export const canManageFactories = (role: Role | null | undefined) => role === "owner" || role === "manager";
export const OPS_ROLES: Role[] = ["owner", "merchandiser", "manager", "qc"];
export const isOps = (role: Role | null | undefined) => !!role && OPS_ROLES.includes(role);
export const FINANCE_ROLES: Role[] = ["owner", "accounts"];
export const isFinance = (role: Role | null | undefined) => !!role && FINANCE_ROLES.includes(role);
