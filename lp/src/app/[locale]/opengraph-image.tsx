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

/* 実際に出るのは kk-web の一覧で176px、X のカードで500px 前後。
   その大きさで残るのはアイコンと名前と1行だけなので、それしか置かない。
   地はアプリのアイコンと同じ濃紺 */
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
  /* 見出しの書体はサイトと同じ IBM Plex Sans JP。使う文字だけに絞ったものを
     同梱している。文言を変えたら assets/README.md の手順で作り直す */
  const [icon, font] = await Promise.all([
    readFile(join(process.cwd(), "public/icon.png")),
    readFile(join(process.cwd(), "assets/IBMPlexSansJP-Bold-subset.ttf")),
  ]);
  const iconSrc = `data:image/png;base64,${icon.toString("base64")}`;

  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        flexDirection: "column",
        justifyContent: "center",
        background: DEEP,
        display: "flex",
        gap: 28,
        height: "100%",
        padding: "0 90px",
        width: "100%",
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: next/image is not available in ImageResponse */}
      <img alt="" height={300} src={iconSrc} width={300} />
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          textAlign: "center",
        }}
      >
        <div
          style={{
            color: PAPER,
            display: "flex",
            flexDirection: "column",
            fontSize: 92,
            fontWeight: 700,
            letterSpacing: -2,
            lineHeight: 1.1,
          }}
        >
          <div>Mac Classic</div>
          <div>Player</div>
        </div>
        <div style={{ color: SIGNAL, display: "flex", fontSize: 34, marginTop: 22 }}>
          {isJa
            ? "キーボードで動かす、macOS のプレイヤー"
            : "A macOS player you drive from the keyboard"}
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
