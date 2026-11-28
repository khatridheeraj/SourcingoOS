export type Role = "owner" | "manager" | "merchandiser" | "accounts" | "quality" | "factory" | "buyer";

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Everything, including payments, real buyer names and the team" },
  { value: "manager", label: "Manager", hint: "Orders and factories, no payments" },
  { value: "merchandiser", label: "Merchandiser", hint: "Orders and factories, no payments" },
  { value: "accounts", label: "Accounts", hint: "Orders, factories and payments" },
  { value: "quality", label: "Quality", hint: "Visits the factories and posts live updates on every production step, records QC checks with photos. Sees orders, no prices or payments" },
  { value: "factory", label: "Factory", hint: "A factory's own login. Enters its TNA dates and marks steps done with photos for its POs, and sees nothing else" },
  { value: "buyer", label: "Buyer", hint: "A buyer's own login. Follows its own orders: styles, steps, ship dates and final QC. No factories, no prices" },
];

// Roles the owner can switch a staff member between (factory and buyer logins stay what they are).
export const STAFF_ROLES = ROLES.filter((r) => r.value !== "factory" && r.value !== "buyer");
// Logins for people outside the team, each with its own page.
export const isPartner = (role: Role | null | undefined) => role === "factory" || role === "buyer";

export const roleLabel = (role: Role | null | undefined) => ROLES.find((r) => r.value === role)?.label ?? "Not added yet";

// Records, cancels and photographs QC checks.
export const canRecordQc = (role: Role | null | undefined) => role === "owner" || role === "quality";
// Changes orders, production and factories, and sees prices. Everyone except Quality.
export const canEditOrders = (role: Role | null | undefined) => !!role && role !== "quality" && !isPartner(role);
// Enters done dates on the TNA: the orders team and Quality.
export const canEnterDone = (role: Role | null | undefined) => canEditOrders(role) || role === "quality";

// Switches the owner sets per person on Team. Anything not set follows the role.
export type PermKey = "money" | "export" | "buyers";
export type Perms = Partial<Record<PermKey, boolean>>;
export const PERMS: { key: PermKey; label: string; hint: string }[] = [
  { key: "money", label: "Money", hint: "Bills, invoices, cheques, payments and Tally: sees and records them" },
  { key: "export", label: "Download data", hint: "Excel downloads of orders, factories, buyers and the activity log" },
  { key: "buyers", label: "Buyer details", hint: "Buyer names, contacts, messages, buyer emails, inquiries and selling prices. Without it, orders show the buyer's code only" },
];
const PERM_DEFAULT: Record<PermKey, Role[]> = {
  money: ["owner", "accounts"], export: ["owner", "accounts"], buyers: ["owner", "manager", "merchandiser", "accounts"],
};
// The same rule as my_perm() in the database: the owner always, partner logins never, otherwise the switch or the role.
export function can(who: { role: Role | null; perms?: Perms } | null | undefined, key: PermKey) {
  if (!who?.role || isPartner(who.role)) return false;
  if (who.role === "owner") return true;
  return who.perms?.[key] ?? PERM_DEFAULT[key].includes(who.role);
}
