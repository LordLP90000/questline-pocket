# Questline Pocket

A personal, phone-only version of [Questline](https://github.com/LordLP90000/Achievement-Tracker): set a big
**goal**, break it into **steps** you tick off, and follow your progress on a **timeline** from the day you started
to the goal itself.

- **No server, no API, no account.** Everything you enter stays in the browser storage of your phone.
- **Works offline** and installs to your home screen like an app (iPhone and Android).
- Just the core: goals, steps (with optional due date and note) and the timeline — no XP, ranks, gambles or share
  cards.
- Built from the approved Questline design (colours, type, components, light and dark, iOS and Android looks), so it
  feels like the real app.

## Put it on your phone

The app is a set of static files. GitHub Pages serves them over HTTPS, which phones need to install a web app and run
it offline. Your goals are never uploaded: Pages only hosts the code.

1. Push this folder to a public GitHub repository (e.g. `questline-pocket`).
2. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main`,
   folder `/ (root)` → Save.** After a minute the app is at `https://<user>.github.io/questline-pocket/`.
3. Open that address on your phone and install it:
   - **iPhone:** in **Safari**, tap **Share** → **Add to Home Screen**. From then on, always open it from the home
     screen: the installed app keeps its own storage, separate from Safari.
   - **Android:** in **Chrome**, open **⋮** → **Install app** (or **Add to Home screen**).

Try it on the computer first with `npm run serve` (http://127.0.0.1:8080). `npm run serve -- --lan` also shows an
address a phone on the same Wi-Fi can open for a quick look; without HTTPS it can't be installed or work offline.

## Your data

- Goals live in this browser's `localStorage` on the phone. Clearing the browser's website data, deleting the
  home-screen app or losing the phone deletes them.
- **Settings → Download a backup** saves a JSON file (on iPhone through the share sheet: *Save to Files*).
  **Restore a backup** reads one back and replaces what is on the phone, after asking. Make a backup now and then.
- Installed apps ask the browser to keep their data (Settings shows *Kept safe from clean-up*).
- Open in two windows at once (on Android, a Chrome tab next to the installed app share their storage)? Each window
  picks up the other's changes, and a save based on outdated data is refused rather than written over newer data.
- Data that can't be read is never overwritten: it is put aside (Settings offers it as a download) and the app starts
  empty with a notice. If there is no room to put it aside, the app saves nothing until you download it or choose to
  start fresh.

## How it works

| File | What it does |
|------|--------------|
| `js/model.js` | Goals and steps as pure, immutable functions: create, edit, tick off, reorder, the timeline, what's due today. A goal is reached when it has steps and every one is done; undoing a step or adding one opens it again. |
| `js/dates.js` | Calendar dates `YYYY-MM-DD`, ported from the Questline backend (`src/domain/dates.ts`), so daylight saving time never shifts a day. |
| `js/validate.js` | Strict checks for backups and stored data: only known fields, valid dates, safe IDs, size limits. |
| `js/store.js` | Loading and saving in `localStorage`. |
| `js/ui.js`, `js/screens.js` | Components and screens as HTML strings, adapted from the Questline design package; every text you type is escaped. |
| `js/app.js` | Navigation (in step with the history, so Android's back gesture works), forms, undo, backups. |
| `sw.js`, `manifest.webmanifest` | Offline cache and home-screen install. |
| `css/` | Design tokens, base styles and components copied from the design package, plus `app.css` for the real phone screen (safe areas). |

The page loads nothing from the internet (a Content Security Policy enforces it), sends nothing anywhere and has no
analytics.

## Development

Requires Node.js 22 or later; there are no dependencies to install.

| Command | Purpose |
|---------|---------|
| `npm test` | Unit tests: model, dates, formats, backups, storage, offline files, icons |
| `npm run e2e` | Plays the main flows in headless Edge or Chrome on an emulated iPhone and Android phone (light and dark, offline start, backups) and saves screenshots to `.e2e/` |
| `npm run serve` | Serves the app at http://127.0.0.1:8080 (`-- --lan` for the local network) |
| `npm run icons` | Redraws the app icons in `icons/` |

To publish a change, bump `VERSION` in both `sw.js` and `js/app.js` (a test checks they match), then push: installed
apps fetch the new version in the background and use it from their next start.

## Licences

The Fraunces font (SIL Open Font License 1.1) and the Lucide icons (ISC) — see `LICENSES/`. The design comes from
the Questline design package.
