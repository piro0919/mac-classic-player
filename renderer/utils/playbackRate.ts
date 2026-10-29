// 選択可能な再生速度（昇順）
export const PLAYBACK_RATES = [
  0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3,
] as const;

export const DEFAULT_PLAYBACK_RATE = 1;

/**
 * 現在の速度から1段階上げる/下げる
 * @param current 現在の再生速度
 * @param direction 1: 速く / -1: 遅く
 * @returns 新しい再生速度
 */
export function stepPlaybackRate(current: number, direction: -1 | 1): number {
  if (direction > 0) {
    return (
      PLAYBACK_RATES.find((rate) => rate > current + 0.001) ??
      PLAYBACK_RATES[PLAYBACK_RATES.length - 1]
    );
  }

  return (
    [...PLAYBACK_RATES].reverse().find((rate) => rate < current - 0.001) ??
    PLAYBACK_RATES[0]
  );
}

/**
 * 不正な値（localStorageの破損など）を既定値に戻す
 * @param value 保存されていた値
 * @returns 有効な再生速度
 */
export function sanitizePlaybackRate(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value >= PLAYBACK_RATES[0] &&
    value <= PLAYBACK_RATES[PLAYBACK_RATES.length - 1]
    ? value
    : DEFAULT_PLAYBACK_RATE;
}

// 表示用: 1 → "1×", 1.5 → "1.5×"
export function formatPlaybackRate(rate: number): string {
  return `${Number(rate.toFixed(2))}×`;
}
