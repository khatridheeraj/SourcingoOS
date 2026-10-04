import type { Role } from "@/lib/roles";

const OPS: Role[] = ["owner", "merchandiser", "manager", "qc"];
const INTERNAL: Role[] = [...OPS, "accounts"];

export type NavItem = { href: string; label: string; roles: Role[]; badge?: string };
export type NavGroup = { title: string; items: NavItem[] };

// Mirrors the module list of the original single-page tool.
export const NAV: NavGroup[] = [
  { title: "", items: [
    { href: "/", label: "Shortcuts", roles: INTERNAL },
    { href: "/dashboard", label: "Ops dashboard", roles: OPS, badge: "alerts" },
  ] },
  { title: "Sales", items: [
    { href: "/inquiries", label: "Inquiries", roles: OPS, badge: "inquiries" },
    { href: "/orders", label: "Sales orders", roles: OPS, badge: "review" },
  ] },
  { title: "Styles", items: [{ href: "/styles", label: "Style catalogue", roles: OPS }] },
  { title: "Manufacturing", items: [
    { href: "/tna", label: "TNA dashboard", roles: OPS },
    { href: "/tna/all", label: "All TNA", roles: OPS },
  ] },
  { title: "Warehouse", items: [
    { href: "/grn", label: "GRN", roles: INTERNAL, badge: "grn" },
    { href: "/dc", label: "Delivery challans", roles: INTERNAL, badge: "dc" },
  ] },
  { title: "CRM", items: [
    { href: "/setup", label: "Buyers & factories", roles: INTERNAL },
    { href: "/team", label: "People & roles", roles: ["owner"] },
  ] },
  { title: "Reports", items: [
    { href: "/reports", label: "Reports & exports", roles: OPS },
    { href: "/buyer-view", label: "Buyer view", roles: OPS },
  ] },
];

export const navFor = (role: Role | null) =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => role && i.roles.includes(role)) })).filter((g) => g.items.length);
