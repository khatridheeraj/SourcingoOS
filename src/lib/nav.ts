import type { Role } from "@/lib/roles";

const OPS: Role[] = ["owner", "merchandiser", "manager", "qc"];
const INTERNAL: Role[] = [...OPS, "accounts"];

export type QuickAction = { href: string; icon: string; tone: string; label: string; sub: string };

// Shown on Shortcuts and in the + menu.
export const QUICK_ACTIONS: QuickAction[] = [
  { href: "/inquiries#new", icon: "+", tone: "", label: "Log inquiry", sub: "Buyer inquiry and follow-up" },
  { href: "/samples/new", icon: "✂", tone: "r", label: "Log sample", sub: "Buyer sample with its due date" },
  { href: "/orders/new", icon: "S", tone: "k", label: "New sales order", sub: "Buyer PO, styles and TNA" },
  { href: "/grn/new", icon: "G", tone: "g", label: "Create GRN", sub: "Goods received from a factory" },
  { href: "/dc/new", icon: "D", tone: "o", label: "Create delivery challan", sub: "Invoice and dispatch to buyer" },
  { href: "/tna/all", icon: "T", tone: "p", label: "Update TNA", sub: "Checkpoint status on running orders" },
];

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
    { href: "/samples", label: "Samples", roles: INTERNAL, badge: "samples" },
    { href: "/orders", label: "Sales orders", roles: INTERNAL, badge: "review" },
  ] },
  { title: "Styles", items: [{ href: "/styles", label: "Style catalogue", roles: INTERNAL }] },
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
    { href: "/reports", label: "Reports & exports", roles: INTERNAL },
    { href: "/buyer-view", label: "Buyer view", roles: OPS },
  ] },
];

export const navFor = (role: Role | null) =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => role && i.roles.includes(role)) })).filter((g) => g.items.length);
