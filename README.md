# CaptionHarvest

**YouTube Playlist → Captions in minutes.**

Paste a YouTube playlist URL, fetch transcripts for every video concurrently, and download a ZIP of SRT/VTT/TXT files with a CSV manifest. No API key, no quota, no third-party services.

---

## Features

- **Playlist extraction** — handles YouTube's modern `lockupViewModel` structure with InnerTube continuation pagination (tested at 315-video scale)
- **Concurrent fetching** — worker pool with exponential backoff + jitter, throttling every 40 videos
- **Smart track selection** — 5-phase preference: manual → auto-generated → auto-translated → any manual → any auto, with language prefix matching (`en` matches `en-US`)
- **3 output formats** — SRT, VTT (WebVTT), and TXT
- **Per-video source badge** — see whether captions are manual, auto-generated, or translated
- **Inline transcript preview** — click any captured video to view its transcript in a side panel, with format toggle and download-as dropdown
- **Search inside transcripts** — find which videos mention a specific topic across 300+ transcripts with context snippets
- **Search by title/ID** — filter the results table by video title or ID
- **Single-file exports** — download `all_transcripts.txt` or `all_transcripts.json` for LLM/RAG pipelines
- **Copy all transcripts** — copy all captured text to clipboard with one click, with real word/character counts
- **Filename patterns** — choose how files are named: verbose, title-only, position, or videoId
- **Cookie support** — paste your YouTube cookies (raw or Netscape `cookies.txt`) to bypass age restrictions & improve success rates
- **Re-run failed videos** — retry just the blocked/failed videos without re-scanning the entire playlist
- **Standalone CLI script** — download a zero-dependency Python script that replicates the full pipeline
- **Job persistence** — refreshes restore your last job from localStorage
- **Job history** — switch between past extraction jobs and delete old ones
- **Dark mode** — toggleable, with full dark-theme support

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Browser    │◄────│   Next.js    │     │  Transcript      │
│  (React 19)  │     │  :3000       │     │  Service (Bun)   │
│              │     │  API routes  │     │  :3003           │
│ socket.io ◄──┼─────┤  (download,  │     │  socket.io path  │
│  client      │     │   preview,   │     │  "/"             │
│              │     │   search,    │     │                  │
│              │     │   combined)  │     │  Playlist extr.  │
│              │     │              │     │  Transcript      │
│              │     │              │     │  fetch + package │
└──────────────┘     └──────────────┘     └──────────────────┘
                                                    │
                                           ┌────────▼────────┐
                                           │  /tmp/playlist-  │
                                           │  captions/<job>/ │
                                           │  (shared volume) │
                                           └─────────────────┘
```

- **Next.js** serves the frontend and hosts API routes for downloads, previews, search, and combined exports
- **Transcript service** (Bun) handles playlist extraction, concurrent transcript fetching, and ZIP packaging — communicates via socket.io for real-time progress
- **Shared filesystem** (`/tmp/playlist-captions/`) bridges downloads between the two services

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.3
- Node.js >= 18 (for Next.js)

### Install & Run

```bash
# Clone the repo
git clone <your-repo-url>
cd captionharvest

# Install dependencies
bun install

# Install transcript service dependencies
cd mini-services/transcript-service
bun install
cd ../..

# Start the transcript service (port 3003)
cd mini-services/transcript-service && bun run dev &

# Start the Next.js dev server (port 3000)
bun run dev
```

Open **http://localhost:3000** in your browser.

> **Note:** By default the frontend connects directly to `localhost:3003`. If you prefer the Caddy gateway (port 81), install [Caddy](https://caddyserver.com/), run `caddy run`, and browse to `http://localhost:81`.

---

## Usage

1. **Paste a YouTube playlist URL** — any public playlist URL works
2. **Choose options** (optional):
   - **Languages** — select caption languages (e.g., English, Hindi). Multi-select supported
   - **Workers** — concurrency slider (higher = faster, but more aggressive on YouTube)
   - **Output formats** — SRT, VTT, and/or TXT
   - **Filename pattern** — how individual files are named
   - **Cookies** — paste YouTube cookies to bypass bot detection and age-restrictions
3. **Click "Extract Captions"** — watch real-time progress in the dashboard
4. **Download** — once complete, download the ZIP (per-video files), combined exports (TXT/JSON), or the standalone CLI script

### Working Around Bot Detection

YouTube may block cloud/datacenter IPs. Three solutions:

| Solution | Difficulty | Effectiveness |
|----------|-----------|--------------|
| **Run locally** | Easy | Best — residential IPs work perfectly |
| **Paste cookies** | Easy | Bypasses age-restrictions, helps with rate limits |
| **Residential proxies** | Advanced | Works when the IP itself is flagged |

---

## Standalone CLI Script

For environments where Node.js/Bun isn't available, click **"Download captionharvest.py"** from the app, or generate it:

```bash
python captionharvest.py "PLAYLIST_URL" [output_dir] \
  --languages en,hi \
  --workers 5 \
  --cookies cookies.txt
```

The script is a single Python 3 file with **zero external dependencies** (stdlib only). It replicates the full pipeline: playlist extraction, transcript fetching, SRT/TXT/JSON/CSV output, ZIP packaging, cookie support, and resume capability.

---

## API Routes

| Route | Description |
|-------|-------------|
| `GET /api/download/[jobId]` | Download `captions.zip` |
| `GET /api/manifest/[jobId]` | Download `manifest.csv` |
| `GET /api/combined/[jobId]?format=txt\|json` | Download combined exports |
| `GET /api/transcript/[jobId]/[videoId]?format=srt\|vtt\|txt` | Single transcript JSON |
| `GET /api/all-text/[jobId]` | Combined text with word/char counts |
| `GET /api/search/[jobId]?q=query` | Full-text search across transcripts |
| `GET /api/cli-script` | Generate standalone Python CLI script |

---

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `start` | Client → Server | Start a new extraction job |
| `cancel` | Client → Server | Cancel a running job |
| `join` | Client → Server | Re-join an existing job (for persistence) |
| `retry-failed` | Client → Server | Re-run non-ok videos |
| `list-jobs` | Client → Server | Fetch job history |
| `delete-job` | Client → Server | Delete a past job |
| `job:created` | Server → Client | Job initialized with ID |
| `job:playlist` | Server → Client | Playlist extracted (total count) |
| `job:progress` | Server → Client | Progress update (stats) |
| `video:start` | Server → Client | A video is being fetched |
| `video:result` | Server → Client | A video finished (result) |
| `job:log` | Server → Client | Log line |
| `job:done` | Server → Client | Job complete |
| `job:error` | Server → Client | Job failed |
| `job:cancelled` | Server → Client | Job cancelled |
| `job:snapshot` | Server → Client | Full job state (for persistence) |
| `jobs:list` | Server → Client | Job history list |
| `job:deleted` | Server → Client | Job was deleted |

---

## Tech Stack

- **Frontend:** Next.js 16, React 19, TypeScript, Tailwind CSS 4, shadcn/ui, Framer Motion, socket.io-client, next-themes
- **Backend:** Bun, socket.io, custom YouTube extractor (InnerTube API), youtube-transcript (fallback), archiver
- **Database:** None (in-memory job store + filesystem for outputs; Prisma/SQLite scaffold is unused)

---

## Known Limitations

- **Bot detection:** YouTube blocks many cloud/datacenter IPs. The tool works best from a residential internet connection. Cookies and residential proxies are documented workarounds
- **In-memory jobs:** The transcript service keeps the last 30 jobs in memory. A service restart clears all jobs
- **Caption availability:** Not all YouTube videos have captions enabled. The tool accurately reports `no-captions`, `blocked`, and `failed` statuses per video

---

## License

MIT
