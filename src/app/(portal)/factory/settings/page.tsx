import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { SettingsForm } from "@/components/settings-form";
import { getMe } from "@/lib/auth";
import { tr } from "@/lib/i18n";

export const metadata = { title: "Settings · Sourcingo" };

export default async function FactorySettings() {
  const me = await getMe();
  if (me?.role !== "factory") redirect("/");
  return (
    <>
      <Head title={tr(me.language)("My settings")} sub={me.fullName || me.email} />
      <SettingsForm language={me.language} digest={me.digest} phone={me.phone ?? ""} showDigest={false} hi={me.language === "hi"} />
    </>
  );
}
