import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Geist } from "next/font/google";
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
    icons: { icon: "/icon.png" },
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
    <html className={sans.variable} lang={locale}>
      <body className="font-[family-name:var(--font-sans)] antialiased">
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
        <Analytics />
      </body>
    </html>
  );
}
