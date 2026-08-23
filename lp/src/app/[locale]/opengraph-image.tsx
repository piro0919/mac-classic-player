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

/* 実在のアプリ（Linear / Arc / CleanShot / Setapp）の作りに合わせる。
   ブランド色の地に、アイコンと名前と短い一行だけ。説明文は入れない。
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
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/image is not available in ImageResponse */}
      <img alt="" height={200} src={iconSrc} width={200} />
      <div
        style={{
          color: PAPER,
          display: "flex",
          fontSize: 84,
          letterSpacing: -2,
          marginTop: 32,
        }}
      >
        Mac Classic Player
      </div>
      <div style={{ color: SIGNAL, display: "flex", fontSize: 32, marginTop: 18 }}>
        {isJa
          ? "macOS のための軽いメディアプレイヤー"
          : "A lightweight media player for macOS"}
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
