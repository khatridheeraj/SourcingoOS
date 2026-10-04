import Link from "next/link";
import { redirect } from "next/navigation";
import { Head } from "@/components/bits";
import { getMe } from "@/lib/auth";
import { loadWorld } from "@/lib/data";
import { isOps } from "@/lib/roles";
import { sampleOptions } from "../options";
import { SampleForm } from "../sample-form";

export const metadata = { title: "Log sample · Sourcingo OS" };

export default async function NewSample() {
  const me = await getMe();
  if (!me || !isOps(me.role)) redirect("/samples");
  const { world: w } = await loadWorld();
  return (
    <>
      <Head crumbs={<>Sales › <Link className="link" href="/samples">Samples</Link> › New</>} title="Log a sample"
        sub="Log it the day it arrives. The due date drives every reminder, so take it from the buyer." />
      <section className="panel">
        <SampleForm {...sampleOptions(w)} today={w.today} meId={me.id} isOwner={me.role === "owner"} />
      </section>
      <p className="text-xs text-muted">You can add the buyer&apos;s photos and references on the next screen.</p>
    </>
  );
}
