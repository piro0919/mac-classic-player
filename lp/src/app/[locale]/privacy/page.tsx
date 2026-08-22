import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { routing } from "@/i18n/routing";

type Section = { title: string; body: string };

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "privacy" });

  return {
    alternates: {
      canonical:
        locale === routing.defaultLocale ? "/privacy" : `/${locale}/privacy`,
    },
    description: t("intro"),
    title: t("title"),
  };
}

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("privacy");
  const sections = t.raw("sections") as Section[];

  return (
    <main className="px-6 py-16">
      <div className="mx-auto max-w-2xl">
        <h1 className="font-bold text-3xl tracking-tight">{t("title")}</h1>
        <p className="mt-2 text-ink/50 text-sm">{t("updated")}</p>
        <p className="mt-8 text-ink/80 leading-relaxed">{t("intro")}</p>

        {sections.map((section) => (
          <section className="mt-10" key={section.title}>
            <h2 className="font-bold text-xl">{section.title}</h2>
            <p className="mt-3 text-ink/70 leading-relaxed">{section.body}</p>
          </section>
        ))}

        <p className="border-line mt-16 border-t pt-6 text-ink/60 text-sm">
          <Link className="underline" href="/">
            ← {t("back")}
          </Link>
        </p>
      </div>
    </main>
  );
}
