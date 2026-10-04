export type Role = "owner" | "manager" | "merchandiser" | "accounts";

export const ROLES: { value: Role; label: string; hint: string }[] = [
  { value: "owner", label: "Owner", hint: "Everything, including real buyer names and the team" },
  { value: "manager", label: "Manager", hint: "Orders and factories" },
  { value: "merchandiser", label: "Merchandiser", hint: "Orders and factories" },
  { value: "accounts", label: "Accounts", hint: "Orders and factories for now; payments when that area is added" },
];

export const roleLabel = (role: Role | null | undefined) => ROLES.find((r) => r.value === role)?.label ?? "Not added yet";
