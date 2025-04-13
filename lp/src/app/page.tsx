"use client";
import Image from "next/image";
import styles from "./page.module.css";
import { Download, Github } from "lucide-react";
import { motion } from "framer-motion";

export default function Home() {
  return (
    <div className={styles.page}>
      <motion.main
        className={styles.main}
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Image
          className={styles.logo}
          src="/screenshot-empty.png"
          alt="Mac Classic Player UI"
          width={800}
          height={450}
          priority
        />
        <div className={styles.titleRow}>
          <Image
            src="/icon.png"
            alt="App icon"
            width={48}
            height={48}
            className={styles.icon}
          />
          <h1 className={styles.title}>Mac Classic Player</h1>
        </div>
        <p className={styles.subtitle}>
          A lightweight, keyboard-friendly media player for macOS — inspired by
          Media Player Classic.
        </p>
        <ul className={styles.features}>
          <li>🎥 MPC-inspired minimalist UI</li>
          <li>⌨️ Full keyboard control</li>
          <li>🖱 Drag & Drop or one-click file loading</li>
          <li>💾 Persistent volume & window size</li>
          <li>🎵 Supports video and audio formats</li>
          <li>🧾 View track metadata overlay</li>
        </ul>
        <div className={styles.cta}>
          <a
            className={styles.button}
            href="https://github.com/piro0919/mac-classic-player/releases/latest"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={16} />
            Download for macOS
          </a>
          <a
            className={styles.button}
            href="https://github.com/piro0919/mac-classic-player"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Github size={16} />
            View on GitHub
          </a>
        </div>
      </motion.main>
      <section className={styles.section}>
        <div className={styles.featureGrid}>
          <div className={styles.featureItem}>
            <h3>🧼 Minimal UI</h3>
            <p>No clutter. Just your content.</p>
          </div>
          <div className={styles.featureItem}>
            <h3>⌨️ Full Keyboard Control</h3>
            <p>Pause, seek, volume — all via keyboard.</p>
          </div>
          <div className={styles.featureItem}>
            <h3>⚡ Fast & Lightweight</h3>
            <p>Launches instantly. Plays immediately.</p>
          </div>
        </div>
      </section>
      <section className={styles.section}>
        <div className={styles.screenshotRow}>
          <Image
            className={styles.screenshotImage}
            src="/screenshot-main.png"
            alt="Playing a video"
            width={600}
            height={338}
          />
          <motion.div
            className={styles.screenshotText}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            <h3>Clean Playback</h3>
            <p>Drop a file in and it just plays. No menus, no fuss.</p>
          </motion.div>
        </div>
        <div className={styles.screenshotRow}>
          <motion.div
            className={styles.screenshotText}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            <h3>Audio Mode</h3>
            <p>Perfect for playing audio-only files. No distractions.</p>
          </motion.div>
          <Image
            className={styles.screenshotImage}
            src="/screenshot-audio.png"
            alt="Audio mode"
            width={600}
            height={338}
          />
        </div>
        <div className={styles.screenshotRow}>
          <Image
            className={styles.screenshotImage}
            src="/screenshot-shortcuts.png"
            alt="Shortcut overlay"
            width={600}
            height={338}
          />
          <motion.div
            className={styles.screenshotText}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            <h3>Shortcut Overlay</h3>
            <p>
              Press <code>?</code> to see all keyboard shortcuts instantly.
            </p>
          </motion.div>
        </div>
        <div className={styles.screenshotRow}>
          <motion.div
            className={styles.screenshotText}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            <h3>Instant Startup</h3>
            <p>Opens instantly to a clean window. Ready when you are.</p>
          </motion.div>
          <Image
            className={styles.screenshotImage}
            src="/screenshot-empty.png"
            alt="Empty window on startup"
            width={600}
            height={338}
          />
        </div>
        <div className={styles.screenshotRow}>
          <Image
            className={styles.screenshotImage}
            src="/screenshot-info.png"
            alt="Track info overlay"
            width={600}
            height={338}
          />
          <motion.div
            className={styles.screenshotText}
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            viewport={{ once: true }}
          >
            <h3>Track Info Overlay</h3>
            <p>
              Press <code>i</code> to view detailed metadata like artist, album,
              genre, and more.
            </p>
          </motion.div>
        </div>
      </section>
      <footer className={styles.footer}>
        <span>Free & Open Source — Made for macOS</span>
        <span>
          &copy; 2025{" "}
          <a
            href="https://kk-web.link/"
            target="_blank"
            rel="noopener noreferrer"
          >
            kk-web
          </a>
        </span>
      </footer>
    </div>
  );
}
