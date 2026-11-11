import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { getMe } from "@/lib/auth";
import { LANG_COOKIE, langOf } from "../../i18n";
import { loadMarket } from "../load";
import { MarketStyleView } from "../market-style";

export default async function FactoryMarketStylePage({ params }: PageProps<"/factory/market/[id]">) {
  const { id } = await params;
  const [{ styles }, me, lang] = await Promise.all([loadMarket(), getMe(), cookies().then((c) => langOf(c.get(LANG_COOKIE)?.value))]);
  const s = styles.find((x) => x.id === id);
  if (!s) notFound();
  return <MarketStyleView s={s} lang={lang} canQuote={me?.role === "factory"} />;
}
