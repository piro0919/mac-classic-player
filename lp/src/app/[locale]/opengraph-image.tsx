import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { routing } from "@/i18n/routing";

export const alt = "Mac Classic Player";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/* ビルド時に焼く。動的なままだと public/ が関数側に含まれず、
   本番で icon.png を読めずに 500 になる */
export function generateStaticParams(): { locale: string }[] {
  return routing.locales.map((locale) => ({ locale }));
}

/* 実在のアプリに合わせる。Linear と Setapp はアイコンと名前を横に並べ、
   Arc と CleanShot はアイコンだけ。縦に積んでいるものは無かった。
   色はアイコンから取った濃紺と青緑 */
const DEEP = "#0d161e";
const PAPER = "#f2f4f5";
const SIGNAL = "#3fb6b6";

export default async function OgImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ImageResponse> {
  const { locale } = await params;
  const isJa = locale === "ja";
  const [icon, font] = await Promise.all([
    readFile(join(process.cwd(), "public/icon.png")),
    readFile(join(process.cwd(), "assets/IBMPlexSansJP-Bold-subset.ttf")),
  ]);
  const iconSrc = `data:image/png;base64,${icon.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: DEEP,
        display: "flex",
        gap: 44,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/image is not available in ImageResponse */}
      <img alt="" height={190} src={iconSrc} width={190} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div
          style={{
            color: PAPER,
            display: "flex",
            fontSize: 64,
            letterSpacing: -1.5,
            whiteSpace: "nowrap",
          }}
        >
          Mac Classic Player
        </div>
        <div style={{ color: SIGNAL, display: "flex", fontSize: 30, marginTop: 18 }}>
          {isJa
            ? "macOS のための軽いメディアプレイヤー"
            : "A lightweight media player for macOS"}
        </div>
      </div>
    </div>,
    {
      ...size,
      fonts: [
        { data: font, name: "IBM Plex Sans JP", style: "normal", weight: 700 },
      ],
    },
  );
}
