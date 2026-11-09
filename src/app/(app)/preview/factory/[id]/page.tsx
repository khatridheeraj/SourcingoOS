import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { canEditOrders, getMe } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FactoryView } from "../../../../factory/factory-view";
import { LANG_COOKIE, langOf } from "../../../../factory/i18n";
import { LangSwitch } from "../../../../factory/lang-switch";
import { FactoryLink } from "../../../factories/factory-link";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// "See what they see": a factory's own panel, exactly as its WhatsApp link opens it, looked at from inside the app,
// in Hindi or English. Nothing on it can be pressed, and nobody is signed out.
export default async function FactoryPreviewPage({ params }: PageProps<"/preview/factory/[id]">) {
  const { id } = await params;
  const me = await getMe();
  if (!me?.companyId) redirect("/login");
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const { data: f } = await supabase.from("factories").select("id, name, phone, active").eq("company_id", me.companyId).eq("id", id).maybeSingle();
  if (!f) notFound();
  const lang = langOf((await cookies()).get(LANG_COOKIE)?.value);

  return (
    <>
      <div className="preview-bar">
        <div>
          <span className="eyebrow">See what they see</span>
          <h2>{f.name}&apos;s panel</h2>
          <p>This is exactly what {f.name} sees when they open their link. Buttons are switched off here.</p>
        </div>
        <div className="preview-acts">
          <LangSwitch lang={lang} />
          {canEditOrders(me.role) && f.active && <FactoryLink factoryId={f.id} name={f.name} phone={f.phone} size="md" seePage={false} />}
          <Link className="btn" href="/factories">All factories</Link>
        </div>
      </div>
      <div className="preview-ro" aria-label={`${f.name}'s panel`}>
        <FactoryView preview={f.id} />
      </div>
    </>
  );
}
