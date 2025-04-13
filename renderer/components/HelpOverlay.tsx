import React, { Fragment } from "react";
import styles from "../styles/VideoPlayer.module.css";

type HelpOverlayProps = {
  helpVisible: boolean;
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>;
  shortcuts: [string, string][];
  showHelp: boolean;
};

const HelpOverlay: React.FC<HelpOverlayProps> = ({
  helpVisible,
  setShowHelp,
  shortcuts,
  showHelp,
}) => {
  if (!helpVisible) return null;

  return (
    <div
      aria-label="Keyboard Shortcuts Help"
      className={`${styles.overlay} ${!showHelp ? styles.hide : ""}`}
      onClick={() => setShowHelp(false)}
      role="dialog"
    >
      <div className={styles.helpBox} onClick={(e) => e.stopPropagation()}>
        <h2>Keyboard Shortcuts</h2>
        <dl className={styles.list}>
          {shortcuts.map(([key, desc]) => (
            <Fragment key={key}>
              <dt>
                <span className={styles.key}>{key}</span>
              </dt>
              <dd>{desc}</dd>
            </Fragment>
          ))}
        </dl>
      </div>
    </div>
  );
};

export default HelpOverlay;
