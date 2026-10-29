import {
  AlertTriangle,
  Check,
  Copy,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import React, { useState } from "react";
import { type ConversionState } from "../hooks/useMediaConversion";
import styles from "../styles/VideoPlayer.module.css";

type ConversionOverlayProps = {
  conversion: ConversionState;
  fileName: string;
  hasNext: boolean;
  onRetry: () => void;
  onSkip: () => void;
};

const INSTALL_COMMAND = "brew install ffmpeg";
// MKVなどの変換中の進み具合と、失敗したときの案内を表示する
const ConversionOverlay: React.FC<ConversionOverlayProps> = ({
  conversion,
  fileName,
  hasNext,
  onRetry,
  onSkip,
}) => {
  const [copied, setCopied] = useState(false);

  if (conversion.status === "idle") return null;

  if (conversion.status === "converting") {
    const percent = Math.round(conversion.progress * 100);
    const isTranscode = conversion.mode === "transcode";

    return (
      <div
        aria-live="polite"
        className={styles.conversion}
        onClick={(e) => e.stopPropagation()}
        role="status"
      >
        <div className={styles.conversionCard}>
          <p className={styles.conversionTitle}>
            {isTranscode ? "Converting video…" : "Preparing video…"}
          </p>
          <p className={styles.conversionFile}>{fileName}</p>
          <div
            aria-valuemax={100}
            aria-valuemin={0}
            aria-valuenow={percent}
            className={styles.conversionBar}
            role="progressbar"
          >
            <div
              className={styles.conversionBarFill}
              style={{ transform: `scaleX(${percent / 100})` }}
            />
          </div>
          <p className={styles.conversionHint}>
            {conversion.mode === null
              ? "Reading file…"
              : `${percent}% · ${
                  isTranscode
                    ? "This video's format needs a full conversion, which can take a while."
                    : "Repackaging only, this should be quick."
                }`}
          </p>
          <p className={styles.conversionNote}>
            Only the first time — next time it opens instantly.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={styles.conversion}
      onClick={(e) => e.stopPropagation()}
      role="alert"
    >
      <div className={styles.conversionCard}>
        <AlertTriangle className={styles.conversionIcon} size={28} />
        {conversion.ffmpegMissing ? (
          <>
            <p className={styles.conversionTitle}>
              ffmpeg is needed to play MKV files
            </p>
            <p className={styles.conversionHint}>
              Install it with Homebrew in Terminal, then press Retry:
            </p>
            <button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(INSTALL_COMMAND)
                  .then(() => setCopied(true));
              }}
              className={styles.conversionCommand}
              title="Copy"
            >
              <code>{INSTALL_COMMAND}</code>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </>
        ) : (
          <>
            <p className={styles.conversionTitle}>
              Couldn&apos;t convert this file
            </p>
            <p className={styles.conversionFile}>{fileName}</p>
            <p className={styles.conversionError}>{conversion.message}</p>
          </>
        )}
        <div className={styles.conversionActions}>
          <button className={styles.conversionButton} onClick={onRetry}>
            <RotateCcw size={14} />
            Retry
          </button>
          {hasNext && (
            <button className={styles.conversionButton} onClick={onSkip}>
              <SkipForward size={14} />
              Next file
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ConversionOverlay;
