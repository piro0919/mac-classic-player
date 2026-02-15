# <img src="./assets/icon.png" alt="App icon" width="32" style="vertical-align: middle; margin-right: 8px;" /> Mac Classic Player

> A lightweight, keyboard-friendly media player for macOS — inspired by Media Player Classic. This player offers a rich set of keyboard shortcuts for enhanced control and accessibility.

---

**Mac Classic Player** (a.k.a **MCP**) is a minimalist and responsive video and audio player built for macOS, featuring:

- 🎥 MPC-inspired UI
- ⌨️ Full keyboard control (seek, volume, fullscreen, playlist, help, and more)
- 🧭 Drag & drop or one-click file loading
- 💾 Auto-save volume and window size
- 🖥 Native `.mov`, `.mp4`, `.webm`, and audio formats like `.mp3`, `.m4a`, `.wav` support (with `.hevc` planned)

---

## 🚀 Features

| Feature                    | Description                           |
| -------------------------- | ------------------------------------- |
| 🔄 Play / Pause            | Spacebar or click anywhere            |
| ⏹ Stop                    | Resets to beginning                   |
| ↔ Seek                    | Arrow keys, or click-and-drag slider  |
| 🔊 Volume control          | Mouse or keyboard ↑↓ keys             |
| 🔁 Playlist support        | Multiple file queue with looping      |
| 🖱 Drag & Drop             | or click to open local files          |
| ⌨️ File Open Shortcut      | `O` via menu or hotkey                |
| 🖥 Fullscreen toggle       | `F` key or button (with icon change)  |
| 💾 Persistent state        | Volume & window size remembered       |
| 🎵 Audio support           | Supports `.mp3`, `.m4a`, `.wav`, etc. |
| ❓ Keyboard Shortcuts Help | `?` key to toggle overlay             |
| 🧾 Track Info Overlay      | `i` key or button to toggle metadata  |
| 🔢 Percentage Seek         | `0`–`9` keys to jump to 0%–90%        |

---

## 🛠 Installation

[⬇ Download the latest version](https://github.com/piro0919/mac-classic-player/releases/latest)

Or build it locally:

```bash
git clone https://github.com/piro0919/mac-classic-player
cd mac-classic-player
npm install
npm run dev
```

---

## 📸 Preview

<table align="center">
  <tr>
    <td><img src="./assets/screenshot-main.png" alt="Screenshot: video playing" width="300" /></td>
    <td><img src="./assets/screenshot-audio.png" alt="Screenshot: audio file playback" width="300" /></td>
  </tr>
  <tr>
      <td><img src="./assets/screenshot-shortcuts.png" alt="Screenshot: shortcuts overlay" width="300" /></td>
<td><img src="./assets/screenshot-empty.png" alt="Screenshot: empty startup" width="300" /></td>
</tr>
<tr>
  <td><img src="./assets/screenshot-info.png" alt="Screenshot: track info overlay" width="300" /></td>
  <td>
  </td>
  </tr>
</table>

---

## 📝 License

MIT — Feel free to fork and extend!

---

## 🙌 Credits

Built with ❤️ using [Tauri](https://tauri.app/), [React](https://react.dev), and [lucide-react](https://lucide.dev)

Inspired by [Media Player Classic](https://mpc-hc.org/)
