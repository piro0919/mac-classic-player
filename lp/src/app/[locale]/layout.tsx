import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist, IBM_Plex_Sans_JP } from "next/font/google";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import type { ReactNode } from "react";
import { routing } from "@/i18n/routing";
import "./globals.css";

const sans = Geist({
  display: "swap",
  subsets: ["latin"],
  variable: "--font-sans",
});

/* 見出しの書体。機械の刻印に近い、字幅の揃った日本語ゴシックを当てる。
   日本語は unicode-range で百件以上に割れるので preload は切る。
   切らないと使わない範囲まで先読みして 1ページで 1.5MB 取りに行く */
const display = IBM_Plex_Sans_JP({
  display: "swap",
  preload: false,
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "700"],
});

type LayoutProps = {
  children: ReactNode;
  params: Promise<{ locale: string }>;
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: Omit<LayoutProps, "children">): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta" });
  const path = locale === routing.defaultLocale ? "/" : `/${locale}`;

  return {
    alternates: {
      canonical: path,
      languages: Object.fromEntries(
        routing.locales.map((one) => [
          one,
          one === routing.defaultLocale ? "/" : `/${one}`,
        ]),
      ),
    },
    description: t("description"),
    icons: {
      // 16/32 は絵柄を寄せた別ファイルにしている。宣言しないと 512 の
      // アプリアイコンが縮小されて、小さいときに何の絵か分からなくなる
      icon: [
        { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
        { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
        { url: "/icon.png", sizes: "512x512", type: "image/png" },
      ],
    },
    metadataBase: new URL("https://mcp.kkweb.io"),
    openGraph: {
      description: t("description"),
      siteName: "Mac Classic Player",
      title: t("title"),
      type: "website",
      url: path,
    },
    title: t("title"),
    twitter: {
      card: "summary_large_image",
      description: t("description"),
      title: t("title"),
    },
  };
}

export default async function Layout({ children, params }: LayoutProps) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }
  setRequestLocale(locale);

  return (
    <html className={`${sans.variable} ${display.variable}`} lang={locale}>
      <body className="font-[family-name:var(--font-sans)] antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
