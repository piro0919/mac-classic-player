import type { Metadata } from "next";
import Link from "next/link";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "What Mac Classic Player does and does not send anywhere. No analytics, no accounts, and your files never leave your Mac.",
  alternates: { canonical: "/privacy" },
};

export default function Privacy() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Privacy Policy</h1>
        <p className={styles.updated}>Last updated: August 22, 2026</p>

        <p>
          Mac Classic Player has no analytics, no crash reporting, no accounts,
          and no server of mine behind it. There isn&apos;t much to tell — but
          &quot;we don&apos;t collect anything&quot; would be sloppy, because
          the app does talk to two places. Here is all of it.
        </p>

        <h2>Your files stay on your Mac</h2>
        <p>
          Whatever you open is read from disk and played locally. Large files
          are served through a small HTTP server the app runs on your own
          machine, bound to 127.0.0.1 so nothing outside your Mac can reach it.
          No file, filename, or path is ever uploaded.
        </p>

        <h2>Cover artwork is looked up at Apple</h2>
        <p>
          When an audio file carries artist or album tags, the app sends those
          two pieces of text to Apple&apos;s public iTunes Search API to find
          cover art, along with a country code taken from your system language.
          Nothing else goes with it — not the filename, not the path, not any
          identifier for you or your Mac.
        </p>
        <p>
          This happens automatically and there is currently no switch to turn it
          off. If that bothers you, the request only fires for files that
          actually have artist or album tags, and video files without those tags
          never trigger it. Apple&apos;s handling of the request is covered by
          their own privacy policy.
        </p>

        <h2>Update checks go to GitHub</h2>
        <p>
          The app checks for new versions by fetching a small file from its
          GitHub Releases page. GitHub sees the request the way it sees any
          download, including your IP address, and that is covered by
          GitHub&apos;s privacy policy. Nothing about your library is included.
        </p>

        <h2>What is stored on your Mac</h2>
        <p>
          The list of recently opened files and the window position are written
          to a folder inside your own Library directory. They never leave the
          machine, and deleting the app&apos;s support folder clears them.
        </p>

        <h2>You can check all of this</h2>
        <p>
          The app is open source under the MIT license, so none of the above has
          to be taken on trust.{" "}
          <a href="https://github.com/piro0919/mac-classic-player">
            Read the source
          </a>{" "}
          or open an issue there if something looks wrong.
        </p>

        <h2>Changes</h2>
        <p>
          If the app ever starts doing something new with data, this page gets
          updated before that version ships.
        </p>

        <p className={styles.back}>
          <Link href="/">← Back to Mac Classic Player</Link>
        </p>
      </main>
    </div>
  );
}
