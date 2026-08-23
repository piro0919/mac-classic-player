import Image from "next/image";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { LanguageSwitch } from "./language-switch";

const REPO = "https://github.com/piro0919/mac-classic-player";
const DOWNLOAD = `${REPO}/releases/latest`;

const FORMATS = [".mov", ".mp4", ".webm", ".mp3", ".m4a", ".wav"];

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
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <Image
            alt=""
            className="rounded-[24%]"
            height={28}
            src="/icon.png"
            width={28}
          />
          <span className="font-bold text-sm tracking-tight">
            Mac Classic Player
          </span>
        </div>
        <LanguageSwitch />
      </header>

      {/* 見出しに窓を重ねる。文章より先に、押すものと映るものを見せる */}
      <section className="overflow-hidden px-6 pt-8 pb-16">
        <div className="mx-auto max-w-5xl">
          <h1 className="max-w-3xl text-balance font-display font-bold text-4xl leading-[1.15] tracking-tight sm:text-6xl">
            {t("hero.title")}
          </h1>

          <div className="mt-8 flex flex-wrap gap-2">
            {FORMATS.map((ext) => (
              <span
                className="cap px-3 py-1.5 font-mono text-ink-2 text-xs"
                key={ext}
              >
                {ext}
              </span>
            ))}
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)] lg:items-start">
            <div className="min-w-0">
              <p className="text-pretty text-ink-2 leading-relaxed">
                {t("hero.tagline")}
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <a
                  className="bg-signal px-7 py-3.5 font-bold text-deck transition hover:bg-ink"
                  href={DOWNLOAD}
                >
                  {t("hero.download")}
                </a>
                <a className="cap px-7 py-3.5 font-bold text-ink" href={REPO}>
                  {t("hero.source")}
                </a>
              </div>
              <p className="mt-5 text-ink-2 text-sm">{t("hero.note")}</p>
            </div>

            {/* 窓は右端で裁ち落とす。全体を収めると中央のスクショに戻る */}
            <div className="-mr-10 min-w-0 sm:-mr-16 lg:-mr-24">
              <Image
                alt={t("screens.window")}
                className="w-full"
                height={505}
                priority={true}
                quality={100}
                src="/screenshot-main.png"
                width={820}
              />
            </div>
          </div>
        </div>
      </section>

      {/* することは4つ。番号を振って並べる */}
      <section className="border-line border-t px-6 py-16">
        <div className="mx-auto grid max-w-5xl gap-x-12 gap-y-10 sm:grid-cols-2">
          {features.map((item, i) => (
            <div key={item.title}>
              <span className="font-mono text-signal text-xs">
                {String(i + 1).padStart(2, "0")}
              </span>
              <h2 className="mt-3 font-display font-bold text-xl">{item.title}</h2>
              <p className="mt-3 text-ink-2 leading-relaxed">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* このアプリの芯はキー操作なので、キートップそのものを並べる */}
      <section className="border-line border-t px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="font-display font-bold text-xl">{t("shortcuts.title")}</h2>
          <dl className="mt-8 grid gap-x-12 gap-y-3 sm:grid-cols-2">
            {keys.map((one) => (
              <div
                className="flex items-center gap-4 border-line border-b py-2.5"
                key={one.key}
              >
                <dt className="cap min-w-24 px-3 py-1.5 text-center font-bold font-mono text-sm">
                  {one.key}
                </dt>
                <dd className="text-ink-2">{one.action}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-8 text-ink-2 text-sm">{t("shortcuts.note")}</p>
        </div>
      </section>

      <section className="bg-deck-2 px-6 py-16">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-md text-balance font-display font-bold text-2xl leading-snug">
            {t("hero.title")}
          </p>
          <a
            className="shrink-0 bg-signal px-7 py-3.5 font-bold text-deck transition hover:bg-ink"
            href={DOWNLOAD}
          >
            {t("hero.download")}
          </a>
        </div>
      </section>

      <footer className="px-6 py-8 text-center text-ink-2 text-sm">
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
