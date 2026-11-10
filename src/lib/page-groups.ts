import type { PageTab } from "@/components/page-tabs";

// The menu's merged places and the pages inside each, by who sees them.
export const HOME_TABS: PageTab[] = [{ href: "/today", label: "To do" }, { href: "/calendar", label: "Calendar" }, { href: "/updates", label: "Chase and updates" }];
// Quality has no chase list.
export const HOME_TABS_QUALITY: PageTab[] = [{ href: "/today", label: "To do" }, { href: "/calendar", label: "Calendar" }];
export const MONEY_TABS: PageTab[] = [{ href: "/payments", label: "Payments" }, { href: "/payables", label: "Bills to pay" }, { href: "/payments/cash", label: "Cash ahead" }, { href: "/tally", label: "Tally" }];
export const INBOX_TABS: PageTab[] = [{ href: "/pos", label: "Buyer POs" }, { href: "/inquiries", label: "Inquiries" }];
export const REPORT_TABS: PageTab[] = [{ href: "/reports", label: "Numbers" }, { href: "/brief", label: "Morning brief" }];
