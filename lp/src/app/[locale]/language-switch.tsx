"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

/// 言語の切り替え。既定が英語なので、日本語話者が辿り着ける入口が要る
export function LanguageSwitch() {
  const locale = useLocale();
  const t = useTranslations("language");
  const pathname = usePathname();

  return (
    <div className="flex items-center gap-1 rounded-full border border-white/40 p-1 text-sm">
      {(["en", "ja"] as const).map((target) => (
        <Link
          className={`rounded-full px-3 py-1 font-bold transition ${
            locale === target
              ? "bg-white text-[var(--color-abyss)]"
              : "text-white/70 hover:text-white"
          }`}
          href={pathname}
          key={target}
          locale={target}
        >
          {t(target)}
        </Link>
      ))}
    </div>
  );
}
