import type { FactoryInput } from "./actions";
import { MOBILE_MSG, mobileOk } from "@/lib/po-details";

// The checks a factory must pass before it is saved. The form runs them first, so the message shows under the
// field at once; the save runs them again.
export function checkFactory(f: FactoryInput): { error: string; field: keyof FactoryInput } | null {
  if (!f.name.trim()) return { error: "Enter the factory's name.", field: "name" };
  if (!mobileOk(f.phone)) return { error: MOBILE_MSG, field: "phone" };
  const email = f.email.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email doesn't look right. It looks like name@factory.com.", field: "email" };
  const gstin = f.gstin.replace(/\s+/g, "").toUpperCase();
  if (gstin && !/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin)) return { error: "That GSTIN doesn't look right. It has 15 letters and numbers, like 08ABCDE1234F1Z5.", field: "gstin" };
  return null;
}
