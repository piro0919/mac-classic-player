import React, { Fragment } from "react";
import styles from "../styles/VideoPlayer.module.css";
import { type VideoItem } from "../types/videoTypes";

type TrackInfoOverlayProps = {
  currentTrack: null | VideoItem;
  infoVisible: boolean;
  setShowInfo: React.Dispatch<React.SetStateAction<boolean>>;
  showInfo: boolean;
};

const TrackInfoOverlay: React.FC<TrackInfoOverlayProps> = ({
  currentTrack,
  infoVisible,
  setShowInfo,
  showInfo,
}) => {
  if (!infoVisible || !currentTrack?.metadata) return null;

  // メタデータのフィールド定義
  const metadataFields: [string, string][] = [
    ["title", "Title"],
    ["artist", "Artist"],
    ["album", "Album"],
    ["genre", "Genre"],
    ["year", "Year"],
    ["composer", "Composer"],
    ["bpm", "BPM"],
  ];

  return (
    <div
      aria-label="Track Information"
      className={`${styles.overlay} ${!showInfo ? styles.hide : ""}`}
      onClick={() => setShowInfo(false)}
      role="dialog"
    >
      <div className={styles.helpBox} onClick={(e) => e.stopPropagation()}>
        <h2>Track Info</h2>
        <dl className={styles.list}>
          {metadataFields.map(([key, label]) => {
            const value = currentTrack.metadata?.common?.[key];

            if (!value) return null;

            return (
              <Fragment key={key}>
                <dt>{label}</dt>
                <dd>
                  {Array.isArray(value) ? value.join(", ") : String(value)}
                </dd>
              </Fragment>
            );
          })}
          {/* トラック番号の特別な表示 */}
          {currentTrack.metadata?.common?.track?.no && (
            <Fragment key="track">
              <dt>Track</dt>
              <dd>
                {currentTrack.metadata.common.track.no}
                {currentTrack.metadata.common.track.of
                  ? ` / ${currentTrack.metadata.common.track.of}`
                  : ""}
              </dd>
            </Fragment>
          )}
        </dl>
      </div>
    </div>
  );
};

export default TrackInfoOverlay;
