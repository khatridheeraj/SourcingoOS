import { cookies } from "next/headers";
import { LANG_COOKIE, langOf } from "../i18n";
import { loadMarket } from "./load";
import { MarketShop } from "./market-shop";

export default async function FactoryMarketPage() {
  const [{ styles, error }, lang] = await Promise.all([loadMarket(), cookies().then((c) => langOf(c.get(LANG_COOKIE)?.value))]);
  return (
    <>
      {error && <div className="errbox">{error}</div>}
      <MarketShop styles={styles} lang={lang} />
    </>
  );
}
