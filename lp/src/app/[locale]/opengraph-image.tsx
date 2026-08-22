import { ImageResponse } from "next/og";

export const alt = "Mac Classic Player";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const DECK = "#e7e5e0";
const CAP = "#f6f5f2";
const LINE = "#cbc7bf";
const INK = "#14181d";
const INK_2 = "#5b6167";
const SIGNAL = "#1f7d7d";

const KEYS = ["Space", "←", "→", "F", "O", "M"];

export default async function OgImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<ImageResponse> {
  const { locale } = await params;
  const isJa = locale === "ja";

  return new ImageResponse(
    <div
      style={{
        background: DECK,
        display: "flex",
        flexDirection: "column",
        height: "100%",
        justifyContent: "center",
        padding: "0 80px",
        width: "100%",
      }}
    >
      <div style={{ color: SIGNAL, fontSize: 20, letterSpacing: 6 }}>
        MAC CLASSIC PLAYER
      </div>
      <div
        style={{
          color: INK,
          display: "flex",
          flexDirection: "column",
          fontSize: 66,
          fontWeight: 700,
          lineHeight: 1.22,
          marginTop: 26,
        }}
      >
        {(isJa
          ? ["キーボードで動かす、", "macOS のプレイヤーです"]
          : ["A macOS player", "you drive from the keyboard"]
        ).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 14, marginTop: 46 }}>
        {KEYS.map((key) => (
          <div
            key={key}
            style={{
              alignItems: "center",
              background: CAP,
              border: `2px solid ${LINE}`,
              borderBottom: `8px solid ${LINE}`,
              borderRadius: 10,
              color: INK,
              display: "flex",
              fontSize: 32,
              justifyContent: "center",
              minWidth: 104,
              padding: "18px 22px",
            }}
          >
            {key}
          </div>
        ))}
      </div>

      <div style={{ color: INK_2, fontSize: 22, marginTop: 40 }}>
        {isJa
          ? "無料・オープンソース。Apple Silicon の Mac 向け。"
          : "Free and open source. For Apple Silicon Macs."}
      </div>
    </div>,
    { ...size },
  );
}
