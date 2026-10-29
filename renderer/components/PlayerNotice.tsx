import {
  AlertTriangle,
  Check,
  Copy,
  RotateCcw,
  SkipForward,
} from "lucide-react";
import React, { useState } from "react";
import styles from "../styles/VideoPlayer.module.css";

export type Notice =
  | { fileName: string; kind: "playback-error"; message: string }
  | { kind: "engine-error"; message: string }
  | { kind: "mpv-missing" };

type PlayerNoticeProps = {
  hasNext: boolean;
  notice: Notice | null;
  onRetry: () => void;
  onSkip: () => void;
};

const INSTALL_COMMAND = "brew install mpv";
// 再生エンジン（mpv）が無いときや、ファイルを再生できなかったときの案内
const PlayerNotice: React.FC<PlayerNoticeProps> = ({
  hasNext,
  notice,
  onRetry,
  onSkip,
}) => {
  const [copied, setCopied] = useState(false);

  if (!notice) return null;

  return (
    <div
      className={styles.notice}
      onClick={(e) => e.stopPropagation()}
      role="alert"
    >
      <div className={styles.noticeCard}>
        <AlertTriangle className={styles.noticeIcon} size={28} />
        {notice.kind === "mpv-missing" && (
          <>
            <p className={styles.noticeTitle}>
              The mpv playback engine is not installed
            </p>
            <p className={styles.noticeHint}>
              Install it with Homebrew in Terminal, then press Retry:
            </p>
            <button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(INSTALL_COMMAND)
                  .then(() => setCopied(true));
              }}
              className={styles.noticeCommand}
              title="Copy"
            >
              <code>{INSTALL_COMMAND}</code>
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </button>
          </>
        )}
        {notice.kind === "engine-error" && (
          <>
            <p className={styles.noticeTitle}>
              The playback engine failed to start
            </p>
            <p className={styles.noticeError}>{notice.message}</p>
          </>
        )}
        {notice.kind === "playback-error" && (
          <>
            <p className={styles.noticeTitle}>Couldn&apos;t play this file</p>
            <p className={styles.noticeFile}>{notice.fileName}</p>
            <p className={styles.noticeError}>{notice.message}</p>
          </>
        )}
        <div className={styles.noticeActions}>
          <button className={styles.noticeButton} onClick={onRetry}>
            <RotateCcw size={14} />
            Retry
          </button>
          {notice.kind === "playback-error" && hasNext && (
            <button className={styles.noticeButton} onClick={onSkip}>
              <SkipForward size={14} />
              Next file
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerNotice;
