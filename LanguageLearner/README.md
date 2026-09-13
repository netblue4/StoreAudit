# Language Learner — Cycling Language Loop 🚲🎧

A mobile-friendly **Progressive Web App** for hands-free language practice while
cycling. It reads each phrase aloud in **English → German → French** using your
device's built-in text-to-speech, and — crucially — responds to **Bluetooth
headset media buttons** so you can skip phrases without touching your phone.

- **Double-tap** your earphones (*Next Track*) → jump to the **next phrase** and start reading it.
- **Single-tap** (*Play/Pause*) → pause or resume the sequence.

No build step, no dependencies, no server-side code. Just static files.

---

## Features

- **Home screen** listing every topic from `phrases.json`.
- **Player screen** showing the English, German and French text, with the line
  currently being spoken highlighted.
- **Play / Pause / Next / Previous** on-screen controls (big, glove-friendly targets).
- **Multi-language TTS queue**: English (`en-US`) → 1 s pause → German (`de-DE`)
  → 1 s pause → French (`fr-FR`) → 2 s pause → auto-advance to the next phrase.
- **"Loop topic"** toggle to repeat a topic continuously on a long ride.
- **OS media / Bluetooth headset controls** via the Media Session API.
- **Installable PWA** with offline caching (service worker).
- Keyboard shortcuts on desktop: **Space** = play/pause, **←/→** = prev/next.

---

## How the headset controls actually work

This is the tricky part the spec calls out, so here's the design:

Hardware media keys (including the double-tap "next" gesture on Bluetooth
earbuds) are only delivered to a web page that owns an **active OS Media
Session**. A Media Session only exists while the page is **playing real audio** —
and the Web Speech API's `speechSynthesis` does **not** count as media.

So the app plays a **silent, looping WAV clip** (generated in-code as a `data:`
URI, volume 0) the moment you press Play. That holds the Media Session open, and
we register handlers on it:

```js
navigator.mediaSession.setActionHandler('nexttrack',     next);      // double-tap
navigator.mediaSession.setActionHandler('previoustrack', previous);
navigator.mediaSession.setActionHandler('play',  play);             // single-tap
navigator.mediaSession.setActionHandler('pause', pause);            // single-tap
```

Now a double-tap on the earbuds fires `nexttrack` → we cancel the current
utterance, advance the phrase index, and immediately start speaking the new
phrase. Single-tap toggles play/pause. The phrase title also shows up on the
device's lock-screen media widget.

> The first Play must come from an on-screen tap — browsers require a user
> gesture before audio (and therefore the media session) can start. After that,
> the headset buttons take over.

---

## Running it

Because it uses `fetch()` and a service worker, serve it over http(s) — opening
`index.html` directly from the filesystem (`file://`) won't load `phrases.json`.

```bash
# from the project folder
python3 -m http.server 8080
# then open http://localhost:8080 on your phone (same Wi-Fi) or desktop
```

Or deploy the folder to any static host (GitHub Pages, Netlify, Vercel, …) and
open it on your phone. On Android Chrome / iOS Safari, use **"Add to Home
Screen"** to install it as a standalone app.

### GitHub Pages
Push these files to a repo and enable Pages (Settings → Pages → deploy from
branch). The app is entirely static, so it works as-is.

---

## Editing the phrases

All content lives in **`phrases.json`**:

```json
{
  "courseTitle": "Cycling Language Loop",
  "lessons": [
    {
      "topic": "Ordering Coffee",
      "items": [
        { "id": "2-1", "english": "…", "german": "…", "french": "…" }
      ]
    }
  ]
}
```

Add topics or phrases and reload — no code changes needed.

---

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Home + Player screens |
| `styles.css` | Dark, high-contrast, mobile-first styling |
| `app.js` | TTS queue state machine + Media Session / headset bridge |
| `phrases.json` | The course content |
| `manifest.webmanifest` | PWA metadata |
| `sw.js` | Offline caching service worker |
| `icons/` | App icons |

---

## Browser support & notes

- Best on **Chrome / Edge (Android & desktop)** and **Safari (iOS/macOS)**, which
  support both the Web Speech API and the Media Session API.
- Available TTS voices depend on the device. If a German or French voice isn't
  installed, the OS may fall back to a default voice — install the language pack
  in your system settings for correct pronunciation.
- On mobile, locking the screen can suspend speech synthesis in some browsers.
  For the most reliable hands-free ride, keep the screen on (or mounted) — the
  silent-audio session keeps media-key control working in the background where
  the OS permits it.
