"use client";

import { useRouter } from "next/navigation";
import { LANG_COOKIE, type Lang } from "./i18n";

// हिंदी | English, remembered on this phone for a year.
export function LangSwitch({ lang }: { lang: Lang }) {
  const router = useRouter();
  const pick = (l: Lang) => {
    document.cookie = `${LANG_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <nav className="seg" aria-label="Language">
      <button type="button" aria-pressed={lang === "hi"} onClick={() => pick("hi")}>हिंदी</button>
      <button type="button" aria-pressed={lang === "en"} onClick={() => pick("en")}>English</button>
    </nav>
  );
}
