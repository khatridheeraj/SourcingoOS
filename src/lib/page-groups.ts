import type { PageTab } from "@/components/page-tabs";

// The menu's merged places and the pages inside each, by who sees them.
export const HOME_TABS: PageTab[] = [{ href: "/today", label: "To do" }, { href: "/calendar", label: "Calendar" }, { href: "/updates", label: "Chase and updates" }];
// Quality has no chase list.
export const HOME_TABS_QUALITY: PageTab[] = [{ href: "/today", label: "To do" }, { href: "/calendar", label: "Calendar" }, { href: "/calendar/visits", label: "Visit plan" }];
export const MONEY_TABS: PageTab[] = [{ href: "/payments", label: "Payments" }, { href: "/payables", label: "Bills to pay" }, { href: "/payments/cash", label: "Cash ahead" }, { href: "/tally", label: "Tally" }];
export const INBOX_TABS: PageTab[] = [{ href: "/pos", label: "Buyer POs" }, { href: "/inquiries", label: "Inquiries" }];
export const REPORT_TABS: PageTab[] = [{ href: "/reports", label: "Numbers" }, { href: "/brief", label: "Morning brief" }];
// The owner and managers also see the team board and the week in review.
export const REPORT_TABS_LEAD: PageTab[] = [{ href: "/reports", label: "Numbers" }, { href: "/reports/week", label: "Week" }, { href: "/reports/team", label: "Team" }, { href: "/brief", label: "Morning brief" }];
export const reportTabs = (role: string | null | undefined) => (role === "owner" || role === "manager" ? REPORT_TABS_LEAD : REPORT_TABS);
