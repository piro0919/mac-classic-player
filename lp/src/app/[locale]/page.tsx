import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitch } from "./language-switch";

const REPO = "https://github.com/piro0919/mac-classic-player";
const DOWNLOAD = `${REPO}/releases/latest`;

type Item = { title: string; body: string };
type Key = { key: string; action: string };

type PageProps = { params: Promise<{ locale: string }> };

export default async function Page({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations();
  const features = t.raw("features.items") as Item[];
  const keys = t.raw("shortcuts.items") as Key[];

  return (
    <>
      {/* 見出し。文章より先に、動いている実物を見せる */}
      <header className="brand px-6 pt-8 pb-0 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Image
              alt=""
              className="rounded-[24%]"
              height={32}
              src="/icon.png"
              width={32}
            />
            <span className="font-bold text-lg tracking-tight">
              Mac Classic Player
            </span>
          </div>
          <LanguageSwitch />
        </div>

        <div className="mx-auto mt-14 max-w-3xl text-center">
          <h1 className="text-balance font-bold text-4xl leading-tight tracking-tight sm:text-5xl">
            {t("hero.title")}
          </h1>
          <p className="mt-5 text-pretty text-lg text-white/85 leading-relaxed">
            {t("hero.tagline")}
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
            <a
              className="rounded-full bg-white px-8 py-3.5 font-bold text-abyss transition hover:bg-white/90"
              href={DOWNLOAD}
            >
              {t("hero.download")}
            </a>
            <a
              className="rounded-full border border-white/50 px-8 py-3.5 font-bold transition hover:bg-white/10"
              href={REPO}
            >
              {t("hero.source")}
            </a>
          </div>
          <p className="mt-4 text-sm text-white/60">{t("hero.note")}</p>
        </div>

        {/* 起動した直後の窓。これがそのまま再生画面になる */}
        <div className="mx-auto mt-14 max-w-4xl">
          <Image
            alt={t("screens.window")}
            className="w-full translate-y-px rounded-t-2xl"
            height={505}
            priority={true}
            quality={100}
            src="/screenshot-empty.png"
            width={820}
          />
        </div>
      </header>

      {/* することは4つ。枠で囲まず、青緑の罫だけで区切る */}
      <section className="px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-x-12 gap-y-10 sm:grid-cols-2">
          {features.map((item) => (
            <div className="border-signal border-l-2 pl-5" key={item.title}>
              <h2 className="font-bold text-xl">{item.title}</h2>
              <p className="mt-3 text-ink/70 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* このアプリの芯はキー操作なので、一覧を文字で置く */}
      <section className="border-line border-t px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-bold text-xl">{t("shortcuts.title")}</h2>
          <dl className="mt-8 grid gap-x-12 gap-y-4 sm:grid-cols-2">
            {keys.map((one) => (
              <div
                className="border-line flex items-baseline gap-4 border-b pb-3"
                key={one.key}
              >
                <dt className="min-w-24 font-bold text-sm tracking-tight">
                  {one.key}
                </dt>
                <dd className="text-ink/70">{one.action}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-ink/50 text-sm">{t("shortcuts.note")}</p>
        </div>
      </section>

      <footer className="border-line border-t px-6 py-10 text-center text-ink/60 text-sm">
        <a className="underline" href={REPO}>
          {t("footer.source")}
        </a>
        <span className="px-2">·</span>
        <Link className="underline" href="/privacy">
          {t("footer.privacy")}
        </Link>
      </footer>
    </>
  );
}
