import { routing } from "./routing";

/**
 * その言語で公開されている経路。
 * localePrefix は "as-needed" なので、既定の言語だけ接頭辞が付かない。
 * `/en` は実体ではなく `/` へ 307 で飛ぶ URL なので、canonical と
 * hreflang がそこを指してはいけない。
 */
export function localePath(locale: string, path = ""): string {
  const prefix = locale === routing.defaultLocale ? "" : `/${locale}`;

  return `${prefix}${path}` || "/";
}

/** Open Graph の og:locale は language_TERRITORY 形式。"en" や "ja" は仕様外。 */
export function ogLocale(locale: string): string {
  return locale === "ja" ? "ja_JP" : "en_US";
}

/** その言語以外の og:locale:alternate。 */
export function ogAlternateLocales(locale: string): string[] {
  return routing.locales.filter((one) => one !== locale).map(ogLocale);
}

/**
 * hreflang の一覧。x-default は既定の言語に向ける。
 * 言語を選べない利用者に、どれを見せるかを決めておく。
 */
export function languageAlternates(path = ""): Record<string, string> {
  return {
    ...Object.fromEntries(
      routing.locales.map((one) => [one, localePath(one, path)]),
    ),
    "x-default": localePath(routing.defaultLocale, path),
  };
}
