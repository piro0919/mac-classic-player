import type { MetadataRoute } from "next";
import { routing } from "@/i18n/routing";

const SITE_URL = "https://mcp.kkweb.io";

// 既定の言語は接頭辞なし。localePrefix: "as-needed" に合わせる
function href(locale: string, path: string): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  return `${SITE_URL}${prefix}${path}`;
}

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = [
    { changeFrequency: "monthly" as const, path: "", priority: 1 },
    { changeFrequency: "yearly" as const, path: "/privacy", priority: 0.3 },
  ];

  return pages.flatMap((page) =>
    routing.locales.map((locale) => ({
      alternates: {
        languages: {
          ...Object.fromEntries(
            routing.locales.map((one) => [one, href(one, page.path)]),
          ),
          // 言語を選べない利用者にどれを見せるかを決めておく
          "x-default": href(routing.defaultLocale, page.path),
        },
      },
      changeFrequency: page.changeFrequency,
      lastModified: new Date(),
      priority: page.priority,
      url: href(locale, page.path),
    })),
  );
}
