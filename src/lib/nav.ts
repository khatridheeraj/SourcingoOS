import type { Role } from "@/lib/roles";

const OPS: Role[] = ["owner", "merchandiser", "manager", "qc"];
const INTERNAL: Role[] = [...OPS, "accounts"];
const FINANCE: Role[] = ["owner", "accounts"];

// Paused while the team starts small (reset in place, 2026-10-04): these screens
// stay built and still open by URL, but are left out of menus, tiles and alerts.
// Remove a path from here to bring that screen back.
const PAUSED = ["/cleanup", "/pos", "/inquiries", "/styles", "/tna", "/fpos", "/qc", "/grn", "/dc", "/reports", "/feedback", "/notifications"];
const root = (href: string) => "/" + (href.split(/[?#]/)[0].split("/")[1] ?? "");
export const isLive = (href: string) => !PAUSED.includes(root(href));

export type QuickAction = { href: string; icon: string; tone: string; label: string; sub: string };

// Shown on Shortcuts and in the + menu.
const ALL_QUICK_ACTIONS: QuickAction[] = [
  { href: "/inquiries#new", icon: "+", tone: "", label: "Log inquiry", sub: "Buyer inquiry and follow-up" },
  { href: "/samples/new", icon: "✂", tone: "r", label: "Log sample", sub: "Buyer sample with its due date" },
  { href: "/orders/new", icon: "S", tone: "k", label: "New sales order", sub: "Buyer PO, styles and TNA" },
  { href: "/grn/new", icon: "G", tone: "g", label: "Create GRN", sub: "Goods received from a factory" },
  { href: "/dc/new", icon: "D", tone: "o", label: "Create delivery challan", sub: "Invoice and dispatch to buyer" },
  { href: "/tna?view=orders", icon: "T", tone: "p", label: "Update TNA", sub: "Checkpoint status on running orders" },
  { href: "/qc/new", icon: "Q", tone: "g", label: "Record QC", sub: "Inline, mid-line or final inspection" },
];
export const QUICK_ACTIONS = ALL_QUICK_ACTIONS.filter((a) => isLive(a.href));

// For Accounts and the owner.
export const FINANCE_ACTIONS: QuickAction[] = [
  { href: "/payments/cheques/new", icon: "₹", tone: "g", label: "Record cheque", sub: "Cheque received from a buyer" },
  { href: "/payments/invoices/new", icon: "I", tone: "k", label: "Add invoice", sub: "Buyer invoice to collect" },
];

export type NavItem = { href: string; label: string; roles: Role[]; badge?: string };
export type NavGroup = { title: string; items: NavItem[] };

// Grouped by the flow of an order: sell, make, ship, collect.
export const NAV: NavGroup[] = [
  { title: "", items: [
    { href: "/", label: "My day", roles: INTERNAL, badge: "alerts" },
    { href: "/cleanup", label: "Fix my data", roles: OPS, badge: "cleanup" },
  ] },
  { title: "Sales", items: [
    { href: "/pos", label: "POs received", roles: OPS, badge: "pos" },
    { href: "/inquiries", label: "Inquiries & costing", roles: OPS, badge: "inquiries" },
    { href: "/orders", label: "Sales orders", roles: OPS, badge: "review" },
    { href: "/samples", label: "Samples", roles: OPS, badge: "samples" },
    { href: "/styles", label: "Style catalogue", roles: INTERNAL },
  ] },
  { title: "Production", items: [
    { href: "/tna", label: "TNA", roles: OPS },
    { href: "/fpos", label: "Factory POs", roles: INTERNAL, badge: "fpos" },
    { href: "/qc", label: "QC inspections", roles: INTERNAL, badge: "qc" },
  ] },
  { title: "Warehouse", items: [
    { href: "/grn", label: "GRN", roles: INTERNAL, badge: "grn" },
    { href: "/dc", label: "Delivery challans", roles: INTERNAL, badge: "dc" },
  ] },
  { title: "Finance", items: [{ href: "/payments", label: "Payments", roles: FINANCE, badge: "payments" }] },
  { title: "Reports", items: [
    { href: "/reports", label: "Reports & exports", roles: INTERNAL },
    { href: "/reports/scorecards", label: "Scorecards", roles: OPS },
  ] },
  { title: "Setup", items: [
    { href: "/setup", label: "Master data", roles: ["owner"] },
    { href: "/team", label: "People", roles: ["owner"] },
    { href: "/feedback", label: "Feedback", roles: ["owner"], badge: "feedback" },
  ] },
];

export const navFor = (role: Role | null) =>
  NAV.map((g) => ({ ...g, items: g.items.filter((i) => role && i.roles.includes(role) && isLive(i.href)) })).filter((g) => g.items.length);
