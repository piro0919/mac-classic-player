import { type MpvTrack } from "../hooks/useMpvPlayer";

// MKVでよく使われる ISO 639-2/B（書誌用）コードを、表示名が引ける形に直す
const BIBLIOGRAPHIC: Record<string, string> = {
  alb: "sq",
  arm: "hy",
  baq: "eu",
  bur: "my",
  chi: "zh",
  cze: "cs",
  dut: "nl",
  fre: "fr",
  geo: "ka",
  ger: "de",
  gre: "el",
  ice: "is",
  mac: "mk",
  mao: "mi",
  may: "ms",
  per: "fa",
  rum: "ro",
  slo: "sk",
  tib: "bo",
  wel: "cy",
};

let displayNames: Intl.DisplayNames | null | undefined;

/// 言語コード（"spa", "en", "pt-BR" など）を表示名にする。わからなければコードのまま
export const languageName = (code: string | undefined): string | undefined => {
  if (!code || code === "und") return undefined;

  if (displayNames === undefined) {
    try {
      displayNames = new Intl.DisplayNames(undefined, { type: "language" });
    } catch {
      displayNames = null;
    }
  }

  const normalized = BIBLIOGRAPHIC[code.toLowerCase()] ?? code;

  try {
    const name = displayNames?.of(normalized);

    if (name && name.toLowerCase() !== normalized.toLowerCase()) {
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
  } catch {
    // 不正なコード
  }

  return code;
};

const CHANNELS: Record<number, string> = {
  1: "Mono",
  2: "Stereo",
  6: "5.1",
  8: "7.1",
};

/// トラックの表示名（例: "Español — Doblaje"、"Track 3"）
export const trackTitle = (track: MpvTrack): string => {
  const language = languageName(track.lang);
  const parts = [language, track.title].filter(
    (part, index, all): part is string => !!part && all.indexOf(part) === index,
  );

  if (parts.length > 0) return parts.join(" — ");

  if (track.external && track["external-filename"]) {
    return track["external-filename"].split("/").pop() || `Track ${track.id}`;
  }

  return `Track ${track.id}`;
};

// コーデック名を見慣れた表記にする
const CODEC_NAMES: Record<string, string> = {
  aac: "AAC",
  ac3: "AC-3",
  dts: "DTS",
  dvb_subtitle: "DVB",
  dvd_subtitle: "VobSub",
  eac3: "E-AC-3",
  flac: "FLAC",
  hdmv_pgs_subtitle: "PGS",
  mov_text: "TX3G",
  mp3: "MP3",
  opus: "Opus",
  subrip: "SRT",
  truehd: "TrueHD",
  vorbis: "Vorbis",
  webvtt: "WebVTT",
};

/// トラックの補足（例: "AC-3 · 5.1 · Default"）
export const trackDetail = (track: MpvTrack): string => {
  const channels = track["demux-channel-count"];
  const parts = [
    track.codec
      ? (CODEC_NAMES[track.codec] ?? track.codec.toUpperCase())
      : undefined,
    channels ? (CHANNELS[channels] ?? `${channels} ch`) : undefined,
    track.forced ? "Forced" : undefined,
    track.default ? "Default" : undefined,
    track.external ? "External" : undefined,
  ];

  return parts.filter(Boolean).join(" · ");
};
