import { useClickOutside } from "@mantine/hooks";
import { Captions, Check, FilePlus2 } from "lucide-react";
import React, { useState } from "react";
import { type MpvTrack, type TrackId } from "../hooks/useMpvPlayer";
import styles from "../styles/VideoPlayer.module.css";
import { trackDetail, trackTitle } from "../utils/trackLabel";

type TrackMenuProps = {
  audioId: TrackId;
  disabled: boolean;
  onOpenSubtitleFile: () => void;
  onSelectAudio: (id: TrackId) => void;
  onSelectSubtitle: (id: TrackId) => void;
  subtitleId: TrackId;
  tracks: MpvTrack[];
};

type OptionProps = {
  detail?: string;
  label: string;
  onSelect: () => void;
  selected: boolean;
};

const TrackOption: React.FC<OptionProps> = ({
  detail,
  label,
  onSelect,
  selected,
}) => (
  <button
    aria-checked={selected}
    className={`${styles.trackOption} ${selected ? styles.trackOptionActive : ""}`}
    onClick={onSelect}
    role="menuitemradio"
  >
    <span className={styles.trackCheck}>{selected && <Check size={14} />}</span>
    <span className={styles.trackText}>
      <span className={styles.trackName}>{label}</span>
      {detail && <span className={styles.trackDetail}>{detail}</span>}
    </span>
  </button>
);
// 音声トラックと字幕を選ぶメニュー
const TrackMenu: React.FC<TrackMenuProps> = ({
  audioId,
  disabled,
  onOpenSubtitleFile,
  onSelectAudio,
  onSelectSubtitle,
  subtitleId,
  tracks,
}) => {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false));
  const audioTracks = tracks.filter((t) => t.type === "audio");
  const subtitleTracks = tracks.filter((t) => t.type === "sub");

  return (
    <div className={styles.settingsWrap} ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Audio and subtitles"
        className={`${styles.iconButton} ${open ? styles.iconButtonActive : ""}`}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        title="Audio & subtitles (B / C)"
      >
        <Captions size={20} />
      </button>
      {open && (
        <div
          className={`${styles.settingsMenu} ${styles.trackMenu}`}
          role="menu"
        >
          <p className={styles.menuLabel}>
            Audio
            <span className={styles.menuHint}>B</span>
          </p>
          {audioTracks.length === 0 ? (
            <p className={styles.trackEmpty}>No audio tracks</p>
          ) : (
            audioTracks.map((track) => (
              <TrackOption
                detail={trackDetail(track)}
                key={`a${track.id}`}
                label={trackTitle(track)}
                onSelect={() => onSelectAudio(track.id)}
                selected={audioId === track.id}
              />
            ))
          )}
          <hr className={styles.menuDivider} />
          <p className={styles.menuLabel}>
            Subtitles
            <span className={styles.menuHint}>C</span>
          </p>
          <TrackOption
            label="Off"
            onSelect={() => onSelectSubtitle("no")}
            selected={subtitleId === "no"}
          />
          {subtitleTracks.map((track) => (
            <TrackOption
              detail={trackDetail(track)}
              key={`s${track.id}`}
              label={trackTitle(track)}
              onSelect={() => onSelectSubtitle(track.id)}
              selected={subtitleId === track.id}
            />
          ))}
          <button
            onClick={() => {
              onOpenSubtitleFile();
              setOpen(false);
            }}
            className={styles.menuItem}
            role="menuitem"
          >
            <FilePlus2 size={15} />
            Load subtitle file…
          </button>
        </div>
      )}
    </div>
  );
};

export default TrackMenu;
