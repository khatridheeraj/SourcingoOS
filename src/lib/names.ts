export const personName = (p: { full_name: string | null; email: string }) => p.full_name || p.email.split("@")[0];
export const NO_COMPANY = "00000000-0000-0000-0000-000000000000";
