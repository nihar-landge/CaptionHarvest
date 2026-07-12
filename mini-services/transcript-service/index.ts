/**
 * YouTube Playlist Transcript Extractor — mini-service
 *
 - socket.io server (path "/") for real-time progress
 *  - HTTP routes for ZIP / manifest download
 *  - Playlist extraction via ytpl (no API key, no quota)
 *  - Concurrent transcript fetching with:
 *      - primary: youtube-transcript package
 *      - fallback: manual scrape of ytInitialPlayerResponse caption tracks
 *    - exponential backoff + jitter on transient errors
 *      - throttling (small sleep every N videos)
 *  - SRT + TXT output, ZIP packaging via archiver, CSV manifest
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { Server, Socket } from 'socket.io'
import path from 'path'
import os from 'os'
import fs from 'fs'
import fsp from 'fs/promises'
import crypto from 'crypto'
import { YoutubeTranscript } from 'youtube-transcript'
import archiver from 'archiver'
import { extractPlaylist } from './extractor'

// Shared output directory. The Next.js app reads generated ZIP/CSV files from
// here via its /api/download and /api/manifest routes (same machine, same FS).
// NOTE: socket.io with path "/" intercepts all HTTP on this port, so HTTP
// download routes cannot live here — they are served by the Next.js app.
export const CAPTIONS_DIR = process.env.CAPTIONS_DIR || path.join(os.tmpdir(), 'playlist-captions')

const PORT = 3003

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
export type VideoStatus = 'ok' | 'failed' | 'skipped' | 'no-captions' | 'blocked' | 'processing'

export type FilenamePattern = 'verbose' | 'title' | 'position' | 'videoId'

export interface PlaylistVideo {
  id: string
  title: string
  position: number
  author?: string
  lengthSeconds?: number
}

export interface VideoResult {
  video: PlaylistVideo
  status: VideoStatus
  error?: string
  fileSize?: number
  snippetCount?: number
  language?: string
  captionSource?: 'manual' | 'auto' | 'translated' | 'unknown'
  durationMs?: number
}

export interface JobStats {
  total: number
  done: number
  ok: number
  failed: number
  skipped: number
  noCaptions: number
  blocked: number
}

export interface Job {
  id: string
  url: string
  languages: string[]
  workers: number
  formats: ('srt' | 'txt' | 'vtt')[]
  filenamePattern: FilenamePattern
  cookies?: string
  status: 'queued' | 'extracting' | 'fetching' | 'packaging' | 'done' | 'error' | 'cancelled'
  playlistTitle?: string
  videos: PlaylistVideo[]
  results: VideoResult[]
  stats: JobStats
  startedAt: number
  finishedAt?: number
  zipPath?: string
  manifestPath?: string
  cancelFlag: boolean
  outDir: string
}

// ----------------------------------------------------------------------------
// Job store
// ----------------------------------------------------------------------------
const JOBS = new Map<string, Job>()

// ----------------------------------------------------------------------------
// Logging helpers
// ----------------------------------------------------------------------------
function log(jobId: string, level: 'info' | 'warn' | 'error', message: string, io?: Server) {
  const line = `[${new Date().toISOString()}] [${jobId.slice(0, 8)}] ${level.toUpperCase()} ${message}`
  console.log(line)
  if (io) {
    io.to(`job:${jobId}`).emit('job:log', { jobId, level, message, ts: Date.now() })
  }
}

// ----------------------------------------------------------------------------
// SRT / TXT writers
// ----------------------------------------------------------------------------
function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  const ms = Math.round((seconds - Math.floor(seconds)) * 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`
}

interface Snippet {
  text: string
  start: number
  duration: number
}

function writeSrt(snippets: Snippet[]): string {
  let out = ''
  snippets.forEach((sn, i) => {
    const idx = i + 1
    const start = formatTimestamp(sn.start)
    const end = formatTimestamp(sn.start + sn.duration)
    out += `${idx}\n${start} --> ${end}\n${sn.text}\n\n`
  })
  return out
}

function writeVtt(snippets: Snippet[]): string {
  // WebVTT format: "WEBVTT" header, timestamps use "." instead of "," as ms separator
  let out = 'WEBVTT\n\n'
  snippets.forEach((sn, i) => {
    const idx = i + 1
    const start = formatTimestamp(sn.start).replace(',', '.')
    const end = formatTimestamp(sn.start + sn.duration).replace(',', '.')
    out += `${idx}\n${start} --> ${end}\n${sn.text}\n\n`
  })
  return out
}

function writeTxt(snippets: Snippet[]): string {
  // Join snippet texts, collapse whitespace, keep readable sentence breaks
  return snippets
    .map((s) => s.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+([.,!?;:])/g, '$1')
}

// ----------------------------------------------------------------------------
// Transcript fetching
//   primary: manual scrape of ytInitialPlayerResponse (full control over track
//            selection: manual → auto-generated → auto-translated; gives accurate
//            source attribution)
//   fallback: youtube-transcript package (handles some edge cases the scrape misses)
// ----------------------------------------------------------------------------
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

/**
 * Fallback fetcher using the `youtube-transcript` package. Tries each requested
 * language, then no-language (lets the package pick the default track — often the
 * auto-generated one). Source attribution is 'unknown' because the package doesn't
 * expose which track kind it picked.
 */
async function fetchTranscriptViaPackage(videoId: string, languages: string[], cookies?: string): Promise<FetchedTranscript> {
  let lastErr: unknown
  const mapRaw = (raw: any[]) =>
    raw.map((r) => ({
      text: (r.text || '')
        .replace(/&amp;/g, '&')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/<[^>]+>/g, ''),
      start: Number(r.offset ?? 0),
      duration: Number(r.duration ?? 0),
    }))
  for (const lang of languages) {
    try {
      const raw = await YoutubeTranscript.fetchTranscript(videoId, { lang })
      if (raw && raw.length > 0) {
        return { snippets: mapRaw(raw), source: 'unknown', languageCode: lang }
      }
    } catch (e) {
      lastErr = e
    }
  }
  // No-language: package picks the default track (often auto-generated)
  try {
    const raw = await YoutubeTranscript.fetchTranscript(videoId)
    if (raw && raw.length > 0) {
      return { snippets: mapRaw(raw), source: 'unknown' }
    }
  } catch (e) {
    lastErr = e
  }
  throw lastErr ?? new Error('No transcript found via package fetcher')
}

interface CaptionTrack {
  baseUrl: string
  languageCode: string
  kind?: string
  name?: { simpleText?: string; runs?: { text: string }[] }
  vssId?: string
  isTranslatable?: boolean
}

interface PickedTrack {
  track: CaptionTrack
  source: 'manual' | 'auto' | 'translated'
}

/**
 * Pick the best caption track, preferring (in order):
 *   1. Manually-authored captions in a requested language (exact, then prefix match)
 *   2. Auto-generated (ASR) captions in a requested language (exact, then prefix match)
 *   3. Auto-translated captions derived from a requested language's base track
 *   4. Any manual track, then any auto track (language-agnostic fallback)
 *
 * `lang` prefix matching means "en" matches "en", "en-US", "en-GB", etc.
 */
function pickTrack(tracks: CaptionTrack[], languages: string[]): PickedTrack | null {
  if (tracks.length === 0) return null
  const lc = (s: string) => (s || '').toLowerCase()
  const matches = (track: CaptionTrack, lang: string) => {
    const code = lc(track.languageCode)
    return code === lc(lang) || code.startsWith(lc(lang) + '-')
  }
  const isAuto = (t: CaptionTrack) => t.kind === 'asr' || (t.vssId && t.vssId.startsWith('a.'))

  // Phase 1: manual tracks in requested languages
  for (const lang of languages) {
    const t =
      tracks.find((x) => matches(x, lang) && !isAuto(x)) ||
      tracks.find((x) => matches(x, lang) && !isAuto(x)) // (kept for clarity)
    if (t) return { track: t, source: 'manual' }
  }
  // Phase 2: auto-generated (ASR) tracks in requested languages
  for (const lang of languages) {
    const t = tracks.find((x) => matches(x, lang) && isAuto(x))
    if (t) return { track: t, source: 'auto' }
  }
  // Phase 3: auto-translated — find a translatable base track whose translation
  // language matches a requested language. YouTube exposes translation languages
  // on the tracklist; we request the translation by appending &tlang=<lang> to a
  // base track's baseUrl. Prefer a manual base, then an auto base.
  const translationLangs = tracks[0]?.name ? languages : languages
  for (const base of [...tracks.filter((t) => !isAuto(t)), ...tracks.filter((t) => isAuto(t))]) {
    if (!base.isTranslatable) continue
    for (const lang of translationLangs) {
      // Build a synthetic track that points to the translated URL
      const tlang = lc(lang)
      // Only add if no native track already serves this language
      const nativeExists = tracks.some((x) => matches(x, lang))
      if (nativeExists) continue
      return {
        track: {
          ...base,
          languageCode: lang,
          baseUrl: `${base.baseUrl}&tlang=${tlang}`,
          kind: 'translation',
        },
        source: 'translated',
      }
    }
  }
  // Phase 4: any manual track
  const anyManual = tracks.find((t) => !isAuto(t))
  if (anyManual) return { track: anyManual, source: 'manual' }
  // Phase 5: any auto track
  const anyAuto = tracks.find((t) => isAuto(t))
  if (anyAuto) return { track: anyAuto, source: 'auto' }
  return null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)))
}

// Parse JSON3 caption format into snippets
function parseJson3(json: any): Snippet[] {
  const events = json?.events ?? []
  const snippets: Snippet[] = []
  for (const ev of events) {
    if (!ev.segs) continue
    const text = ev.segs.map((s: any) => s.utf8 ?? '').join('').replace(/\n/g, ' ')
    const clean = decodeEntities(text).replace(/<[^>]+>/g, '').trim()
    if (!clean) continue
    const start = Number(ev.tStartMs ?? 0) / 1000
    const duration = Number(ev.dDurationMs ?? 0) / 1000
    snippets.push({ text: clean, start, duration: duration || 2 })
  }
  return snippets
}

// Parse YouTube XML caption format (timedtext) into snippets
function parseXml(xml: string): Snippet[] {
  const snippets: Snippet[] = []
  const re = /<text\s+([^>]*)>([\s\S]*?)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || ''
    const raw = m[2] || ''
    const startMatch = attrs.match(/start="([\d.]+)"/)
    const durMatch = attrs.match(/dur="([\d.]+)"/)
    const start = startMatch ? parseFloat(startMatch[1]) : 0
    const duration = durMatch ? parseFloat(durMatch[1]) : 2
    const text = decodeEntities(raw).replace(/<[^>]+>/g, '').replace(/\n/g, ' ').trim()
    if (text) snippets.push({ text, start, duration })
  }
  return snippets
}

interface FetchedTranscript {
  snippets: Snippet[]
  source: 'manual' | 'auto' | 'translated' | 'unknown'
  languageCode?: string
}

/**
 * Scrape the watch page for ytInitialPlayerResponse, read captionTracks, pick the
 * best track (manual → auto-generated → auto-translated), and fetch its content.
 * This is the PRIMARY strategy because it gives full control over track selection
 * and accurate source attribution (manual vs auto-generated).
 */
async function fetchTranscriptManualScrape(
  videoId: string,
  languages: string[],
  cookies?: string
): Promise<FetchedTranscript> {
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`
  const headers: Record<string, string> = {
    'User-Agent': UA,
    'Accept-Language': 'en-US,en;q=0.9',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
  if (cookies) headers['Cookie'] = cookies
  const res = await fetch(watchUrl, { headers })
  if (!res.ok) throw new Error(`watch page HTTP ${res.status}`)
  const html = await res.text()
  // Find ytInitialPlayerResponse
  const marker = 'ytInitialPlayerResponse'
  const idx = html.indexOf(marker)
  if (idx === -1) throw new Error('ytInitialPlayerResponse not found')
  const eq = html.indexOf('{', idx)
  if (eq === -1) throw new Error('player response JSON start not found')
  // Brace-matching extraction (respects strings + escapes)
  let depth = 0
  let end = -1
  let inStr = false
  let esc = false
  for (let i = eq; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) { esc = false; continue }
      if (c === '\\') { esc = true; continue }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') { inStr = true; continue }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) { end = i + 1; break }
    }
  }
  if (end === -1) throw new Error('player response JSON end not found')
  let player: any
  try {
    player = JSON.parse(html.slice(eq, end))
  } catch {
    throw new Error('player response JSON parse failed')
  }
  const playability = player?.playabilityStatus?.status
  const playabilityReason =
    player?.playabilityStatus?.reason ||
    player?.playabilityStatus?.errorScreen?.playerErrorMessageRenderer?.reason?.simpleText
  if (playability && playability !== 'OK') {
    // LOGIN_REQUIRED / UNPLAYABLE / AGE_CHECK etc. — usually bot-detection on cloud IPs
    throw new Error(
      `YouTube playability: ${playability}${playabilityReason ? ' — ' + playabilityReason : ''}. ` +
        `This is typically bot-detection on datacenter IPs; run from a residential connection or use proxies.`
    )
  }
  const tracks: CaptionTrack[] =
    player?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? []
  if (tracks.length === 0) throw new Error('No caption tracks available (captions may be disabled on this video)')
  const picked = pickTrack(tracks, languages)
  if (!picked) throw new Error('No matching caption track for the requested languages')
  const { track, source } = picked

  // Fetch the caption track. Try json3 first (cleanest), then vtt, then xml.
  const base = track.baseUrl
  const urls = [
    `${base}${base.includes('?') ? '&' : '?'}fmt=json3`,
    `${base}${base.includes('?') ? '&' : '?'}fmt=vtt`,
    base, // default (xml)
  ]
  const capHeaders: Record<string, string> = { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }
  if (cookies) capHeaders['Cookie'] = cookies
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: capHeaders })
      if (!r.ok) continue
      const body = await r.text()
      if (!body || body.trim().length === 0) continue
      if (body.trim().startsWith('{') || u.includes('fmt=json3')) {
        try {
          const j = JSON.parse(body)
          const sn = parseJson3(j)
          if (sn.length > 0) return { snippets: sn, source, languageCode: track.languageCode }
        } catch {
          // fall through to xml/vtt parse
        }
      }
      if (body.includes('<text')) {
        const sn = parseXml(body)
        if (sn.length > 0) return { snippets: sn, source, languageCode: track.languageCode }
      }
      if (body.includes('WEBVTT')) {
        const sn = parseVtt(body)
        if (sn.length > 0) return { snippets: sn, source, languageCode: track.languageCode }
      }
    } catch {
      // try next url
    }
  }
  throw new Error('All caption fetch attempts returned empty')
}

function parseVtt(vtt: string): Snippet[] {
  const lines = vtt.split(/\r?\n/)
  const snippets: Snippet[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const m = line.match(/(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/)
    if (m) {
      const start = parseInt(m[1]) * 3600 + parseInt(m[2]) * 60 + parseInt(m[3]) + parseInt(m[4]) / 1000
      const end = parseInt(m[5]) * 3600 + parseInt(m[6]) * 60 + parseInt(m[7]) + parseInt(m[8]) / 1000
      const textLines: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '') {
        textLines.push(lines[i].replace(/<[^>]+>/g, ''))
        i++
      }
      const text = decodeEntities(textLines.join(' ')).replace(/\s+/g, ' ').trim()
      if (text) snippets.push({ text, start, duration: Math.max(0.5, end - start) })
    }
    i++
  }
  return snippets
}

/**
 * Fetch a transcript for a single video.
 *
 * Strategy:
 *   1. Primary: manual scrape of the watch page → ytInitialPlayerResponse →
 *      pickTrack (manual → auto-generated → auto-translated) → fetch caption
 *      content. Gives accurate source attribution.
 *   2. Fallback: the `youtube-transcript` package (handles some parsing edge cases
 *      the scrape might miss). Source attribution is 'unknown'.
 *
 * Retries with exponential backoff on transient errors (rate-limit / network).
 * Hard errors (bot-block / no-captions / disabled) break out immediately.
 */
async function fetchTranscriptWithRetry(
  videoId: string,
  languages: string[],
  cookies?: string,
  maxRetries = 3
): Promise<FetchedTranscript> {
  const scrapeErrs: unknown[] = []
  let hardErr: unknown = null // a definitive (non-transient) scrape error
  let rateLimited = false
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fetchTranscriptManualScrape(videoId, languages, cookies)
    } catch (e: any) {
      scrapeErrs.push(e)
      const msg = String(e?.message ?? e)
      // Hard errors that won't resolve with retries:
      //  - bot-block (LOGIN_REQUIRED / Sign in to confirm / playability)
      //  - genuine "no captions / disabled / no matching track"
      if (
        /playability|Sign in|LOGIN_REQUIRED|not a bot|ip.*blocked|request.*blocked/i.test(msg) ||
        /No caption tracks|No matching caption|captions may be disabled|transcript.*(disabled|not found)/i.test(msg)
      ) {
        hardErr = e
        break
      }
      // HTTP 429 (rate-limited) — transient but needs longer backoff
      if (/HTTP 429|Too Many Requests|429/i.test(msg)) {
        rateLimited = true
        if (attempt < maxRetries - 1) {
          // Longer backoff for rate-limiting: 2s, 5s, 10s + jitter
          const wait = [2000, 5000, 10000][attempt] + Math.random() * 1000
          await sleep(wait)
          continue
        }
        hardErr = e // exhausted retries on 429 — treat as a definitive block
        break
      }
      // Other transient (network / parse hiccup): backoff and retry
      if (attempt < maxRetries - 1) {
        const wait = Math.min(8000, 600 * 2 ** attempt) + Math.random() * 500
        await sleep(wait)
      }
    }
  }
  // Fallback: the youtube-transcript package. If it also fails, prefer the
  // scrape's diagnostic error (distinguishes bot-block from no-captions).
  try {
    return await fetchTranscriptViaPackage(videoId, languages, cookies)
  } catch (packageErr: any) {
    // If the scrape hit a definitive error (bot-block / no-captions), surface it —
    // it's more diagnostic than the package's generic "disabled" message.
    if (hardErr) throw hardErr
    // Otherwise prefer the last scrape error if it exists (still more specific),
    // else fall back to the package error.
    const lastScrape = scrapeErrs[scrapeErrs.length - 1]
    if (lastScrape) throw lastScrape
    throw packageErr
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function safeName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120)
  return cleaned || 'untitled'
}

/**
 * Build the base filename (without extension) for a video, based on the job's
 * filename pattern:
 *  - 'verbose':  "001 Video Title [videoId]" (default — sortable + identifiable)
 *  - 'title':    "Video Title" (clean, human-readable)
 *  - 'position': "001" (just the zero-padded position — sortable, minimal)
 *  - 'videoId':  "videoId" (just the YouTube ID — stable, no sanitization needed)
 */
function buildBaseName(video: PlaylistVideo, pattern: FilenamePattern): string {
  switch (pattern) {
    case 'title':
      return safeName(video.title)
    case 'position':
      return String(video.position + 1).padStart(3, '0')
    case 'videoId':
      return video.id
    case 'verbose':
    default:
      return `${String(video.position + 1).padStart(3, '0')} ${safeName(video.title)} [${video.id}]`
  }
}

// ----------------------------------------------------------------------------
// Concurrency pool
// ----------------------------------------------------------------------------
async function runPool<T, R>(
  items: T[],
  workers: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: () => void
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  let completed = 0
  const total = items.length
  async function worker() {
    while (cursor < items.length) {
      const myIndex = cursor++
      if (myIndex >= items.length) break
      try {
        results[myIndex] = await fn(items[myIndex], myIndex)
      } catch (e) {
        // Pool-level error wrapper: store as undefined, caller handles per-item
        results[myIndex] = e as any
      }
      completed++
      onProgress?.()
      // Throttle: every 40 completions, pause a little to be nice to YouTube
      if (completed % 40 === 0 && completed < total) {
        await sleep(800)
      }
    }
  }
  const pool = Array.from({ length: Math.min(workers, items.length) }, () => worker())
  await Promise.all(pool)
  return results
}

// ----------------------------------------------------------------------------
// Playlist extraction (delegates to the robust extractor module)
// ----------------------------------------------------------------------------
async function extractPlaylistRobust(
  url: string,
  onProgress: (msg: string) => void
): Promise<{ title: string; videos: PlaylistVideo[] }> {
  const { title, videos } = await extractPlaylist(url, { onProgress })
  return { title, videos }
}

// ----------------------------------------------------------------------------
// Per-video processing
// ----------------------------------------------------------------------------
async function processVideo(
  job: Job,
  video: PlaylistVideo,
  io: Server
): Promise<VideoResult> {
  const start = Date.now()
  try {
    const fetched = await fetchTranscriptWithRetry(video.id, job.languages, job.cookies)
    if (!fetched.snippets || fetched.snippets.length === 0) {
      const res: VideoResult = { video, status: 'no-captions', error: 'Empty transcript', durationMs: Date.now() - start }
      return res
    }
    const snippets = fetched.snippets
    // Write files
    const baseName = buildBaseName(video, job.filenamePattern)
    const written: string[] = []
    if (job.formats.includes('srt')) {
      const srtPath = path.join(job.outDir, `${baseName}.srt`)
      await fsp.writeFile(srtPath, writeSrt(snippets), 'utf-8')
      written.push(srtPath)
    }
    if (job.formats.includes('vtt')) {
      const vttPath = path.join(job.outDir, `${baseName}.vtt`)
      await fsp.writeFile(vttPath, writeVtt(snippets), 'utf-8')
      written.push(vttPath)
    }
    if (job.formats.includes('txt')) {
      const txtPath = path.join(job.outDir, `${baseName}.txt`)
      await fsp.writeFile(txtPath, writeTxt(snippets), 'utf-8')
      written.push(txtPath)
    }
    let fileSize = 0
    for (const w of written) {
      try {
        const st = await fsp.stat(w)
        fileSize += st.size
      } catch {}
    }
    const res: VideoResult = {
      video,
      status: 'ok',
      fileSize,
      snippetCount: snippets.length,
      language: fetched.languageCode || (snippets.length ? job.languages[0] : undefined),
      captionSource: fetched.source,
      durationMs: Date.now() - start,
    }
    return res
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    let status: VideoStatus
    if (/sign in to confirm|not a bot|LOGIN_REQUIRED|bot detection|ip.*blocked|request.*blocked|playability|HTTP 429|Too Many Requests/i.test(msg)) {
      status = 'blocked'
    } else if (/no.*caption|transcript.*(disabled|not found)|no.*transcript|No matching caption/i.test(msg)) {
      status = 'no-captions'
    } else {
      status = 'failed'
    }
    return { video, status, error: msg.slice(0, 300), durationMs: Date.now() - start }
  }
}

function emitProgress(job: Job, io: Server, videoResult?: VideoResult) {
  if (videoResult) {
    io.to(`job:${job.id}`).emit('video:result', { jobId: job.id, result: videoResult })
  }
  const stats = job.stats
  const percent = stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0
  io.to(`job:${job.id}`).emit('job:progress', {
    jobId: job.id,
    done: stats.done,
    total: stats.total,
    ok: stats.ok,
    failed: stats.failed,
    skipped: stats.skipped,
    noCaptions: stats.noCaptions,
    blocked: stats.blocked,
    percent,
    status: job.status,
  })
}

// ----------------------------------------------------------------------------
// ZIP + manifest
// ----------------------------------------------------------------------------
async function packageJob(job: Job, io: Server): Promise<void> {
  job.status = 'packaging'
  emitProgress(job, io)
  const zipPath = path.join(job.outDir, 'captions.zip')
  const manifestPath = path.join(job.outDir, 'manifest.csv')

  // 1. Write manifest CSV FIRST (so it's included in the ZIP)
  const rows = [
    ['position', 'video_id', 'title', 'status', 'caption_source', 'language', 'error', 'snippets', 'file_size_bytes', 'duration_ms'],
  ]
  for (const r of job.results) {
    rows.push([
      String(r.video.position + 1),
      r.video.id,
      r.video.title.replace(/"/g, '""'),
      r.status,
      r.captionSource ?? '',
      r.language ?? '',
      (r.error || '').replace(/"/g, '""'),
      String(r.snippetCount ?? ''),
      String(r.fileSize ?? ''),
      String(r.durationMs ?? ''),
    ])
  }
  const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n')
  await fsp.writeFile(manifestPath, csv, 'utf-8')

  // 2. Generate combined single-file exports (handy for LLM/RAG input)
  const okResults = job.results.filter((r) => r.status === 'ok')
  if (okResults.length > 0) {
    const txtParts: string[] = []
    const jsonParts: any[] = []
    for (const r of okResults) {
      const baseName = buildBaseName(r.video, job.filenamePattern)
      const txtPath = path.join(job.outDir, `${baseName}.txt`)
      let content = ''
      try {
        content = await fsp.readFile(txtPath, 'utf-8')
      } catch {
        // TXT may not exist if only SRT/VTT was requested; derive from SRT or VTT
        const srtPath = path.join(job.outDir, `${baseName}.srt`)
        const vttPath = path.join(job.outDir, `${baseName}.vtt`)
        try {
          const srt = await fsp.readFile(srtPath, 'utf-8')
          content = srt.replace(/^\d+\n[\d:,.]+ --> [\d:,.]+\n/gm, '').replace(/\n{2,}/g, '\n').trim()
        } catch {
          try {
            const vtt = await fsp.readFile(vttPath, 'utf-8')
            content = vtt.replace(/^WEBVTT\s*\n*/i, '').replace(/^\d+\n[\d:,.]+ --> [\d:,.]+\n/gm, '').replace(/\n{2,}/g, '\n').trim()
          } catch {}
        }
      }
      const header = `=== ${r.video.title} ===\nVideo: https://www.youtube.com/watch?v=${r.video.id}\nSource: ${r.captionSource || 'unknown'}${r.language ? ` (${r.language})` : ''}\nSnippets: ${r.snippetCount || 0}\n`
      txtParts.push(`${header}\n${content}\n`)
      jsonParts.push({
        videoId: r.video.id,
        title: r.video.title,
        position: r.video.position,
        url: `https://www.youtube.com/watch?v=${r.video.id}`,
        captionSource: r.captionSource,
        language: r.language,
        snippetCount: r.snippetCount,
        text: content,
      })
    }
    await fsp.writeFile(path.join(job.outDir, 'all_transcripts.txt'), txtParts.join('\n' + '─'.repeat(60) + '\n\n'), 'utf-8')
    await fsp.writeFile(path.join(job.outDir, 'all_transcripts.json'), JSON.stringify({ playlist: job.playlistTitle, total: okResults.length, transcripts: jsonParts }, null, 2), 'utf-8')
  }

  // 3. Create the ZIP (includes all transcript files + manifest + combined exports)
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = archiver('zip', { zlib: { level: 6 } })
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)
    // Add all files from the output dir (skip the zip itself)
    archive.directory(job.outDir, false, (entry: any) => {
      if (entry.name.endsWith('.zip')) return false
      return entry
    })
    archive.finalize()
  })

  job.zipPath = zipPath
  job.manifestPath = manifestPath
}

// ----------------------------------------------------------------------------
// Main job runner
// ----------------------------------------------------------------------------
async function runJob(job: Job, io: Server): Promise<void> {
  try {
    // Stage 1: extract playlist
    job.status = 'extracting'
    emitProgress(job, io)
    log(job.id, 'info', `Extracting playlist: ${job.url}`, io)
    const { title, videos } = await extractPlaylistRobust(job.url, (msg) => {
      log(job.id, 'info', msg, io)
    })
    job.playlistTitle = title
    job.videos = videos
    job.stats.total = videos.length
    log(job.id, 'info', `Found ${videos.length} videos in "${title}"`, io)
    io.to(`job:${job.id}`).emit('job:playlist', {
      jobId: job.id,
      title,
      total: videos.length,
      videos: videos.slice(0, 400), // cap payload
    })
    emitProgress(job, io)

    if (videos.length === 0) {
      throw new Error('Playlist is empty or could not be parsed')
    }

    // Stage 2: fetch transcripts
    job.status = 'fetching'
    emitProgress(job, io)
    await runPool(
      videos,
      job.workers,
      async (video) => {
        if (job.cancelFlag) {
          const res: VideoResult = { video, status: 'skipped', error: 'cancelled' }
          job.results.push(res)
          job.stats.done++
          job.stats.skipped++
          emitProgress(job, io, res)
          return res
        }
        io.to(`job:${job.id}`).emit('video:start', { jobId: job.id, videoId: video.id, title: video.title, position: video.position })
        const res = await processVideo(job, video, io)
        job.results.push(res)
        job.stats.done++
        if (res.status === 'ok') job.stats.ok++
        else if (res.status === 'skipped') job.stats.skipped++
        else if (res.status === 'no-captions') job.stats.noCaptions++
        else if (res.status === 'blocked') job.stats.blocked++
        else job.stats.failed++
        const tag = res.status === 'ok' ? 'info' : res.status === 'blocked' ? 'error' : res.status === 'no-captions' ? 'warn' : 'error'
        const extra = res.status === 'ok'
          ? ` (${res.snippetCount} snippets, ${(res.fileSize ? res.fileSize / 1024 : 0).toFixed(1)} KB${res.captionSource && res.captionSource !== 'unknown' ? `, ${res.captionSource === 'auto' ? 'auto-generated' : res.captionSource === 'translated' ? 'auto-translated' : 'manual'} captions` : ''})`
          : res.error ? ` — ${res.error}` : ''
        log(job.id, tag as any, `[${job.stats.done}/${job.stats.total}] ${video.title}${extra}`, io)
        // One-time environment warning when YouTube bot-detection is observed
        if (res.status === 'blocked' && !(job as any)._blockedWarned) {
          ;(job as any)._blockedWarned = true
          log(
            job.id,
            'warn',
            'YouTube is returning "Sign in to confirm you\'re not a bot" — this happens on datacenter/cloud IPs. Run the service from a residential connection or configure residential proxies (e.g. Webshare) for full transcript coverage. Playlist extraction is unaffected.',
            io
          )
        }
        emitProgress(job, io, res)
        return res
      },
      () => {}
    )

    if (job.cancelFlag) {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      emitProgress(job, io)
      log(job.id, 'warn', 'Job cancelled by user', io)
      io.to(`job:${job.id}`).emit('job:cancelled', { jobId: job.id })
      return
    }

    // Stage 3: package
    log(job.id, 'info', 'Packaging ZIP + manifest...', io)
    await packageJob(job, io)
    job.status = 'done'
    job.finishedAt = Date.now()
    const dur = ((job.finishedAt - job.startedAt) / 1000).toFixed(1)
    log(job.id, 'info', `Done in ${dur}s — ok:${job.stats.ok} failed:${job.stats.failed} no-captions:${job.stats.noCaptions} skipped:${job.stats.skipped} blocked:${job.stats.blocked}`, io)
    io.to(`job:${job.id}`).emit('job:done', {
      jobId: job.id,
      stats: job.stats,
      durationMs: job.finishedAt - job.startedAt,
      zipUrl: `/api/download/${job.id}`,
      manifestUrl: `/api/manifest/${job.id}`,
    })
    emitProgress(job, io)
  } catch (e: any) {
    job.status = 'error'
    job.finishedAt = Date.now()
    const msg = String(e?.message ?? e)
    log(job.id, 'error', `Job failed: ${msg}`, io)
    io.to(`job:${job.id}`).emit('job:error', { jobId: job.id, message: msg })
  }
}

// ----------------------------------------------------------------------------
// HTTP server + socket.io
// ----------------------------------------------------------------------------
// socket.io with path "/" intercepts all HTTP on this port, so the HTTP handler
// here is effectively unreachable. Downloads are served by the Next.js app via
// /api/download/[jobId] and /api/manifest/[jobId], which read from CAPTIONS_DIR.
const httpServer = createServer((_req: IncomingMessage, res: ServerResponse) => {
  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Use the Next.js /api routes for downloads' }))
})

const io = new Server(httpServer, {
  path: '/',
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
  maxHttpBufferSize: 5 * 1024 * 1024,
})

io.on('connection', (socket: Socket) => {
  socket.emit('connected', { serverTime: Date.now() })

  socket.on('join', (jobId: string) => {
    socket.join(`job:${jobId}`)
    const job = JOBS.get(jobId)
    if (job) {
      // Send current state snapshot
      socket.emit('job:snapshot', {
        jobId: job.id,
        status: job.status,
        playlistTitle: job.playlistTitle,
        url: job.url,
        languages: job.languages,
        workers: job.workers,
        formats: job.formats,
        filenamePattern: job.filenamePattern,
        videos: job.videos.slice(0, 400),
        results: job.results.slice(-500),
        stats: job.stats,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        zipUrl: job.zipPath ? `/api/download/${job.id}` : undefined,
        manifestUrl: job.manifestPath ? `/api/manifest/${job.id}` : undefined,
      })
    }
  })

  socket.on('start', async (payload: { url: string; languages?: string[]; workers?: number; formats?: ('srt' | 'txt' | 'vtt')[]; filenamePattern?: FilenamePattern; cookies?: string }) => {
    const url = (payload?.url || '').trim()
    if (!url) {
      socket.emit('job:error', { jobId: null, message: 'Missing playlist URL' })
      return
    }
    // Accept playlist URLs or video URLs with list param
    if (!/list=/.test(url) && !/^PL[\w-]+$/.test(url)) {
      socket.emit('job:error', { jobId: null, message: 'URL does not look like a YouTube playlist (need ?list=... or a playlist ID)' })
      return
    }
    // Parse cookies: accept either "name=value; name2=value2" format or Netscape cookies.txt
    let cookies: string | undefined
    if (payload.cookies && payload.cookies.trim()) {
      const raw = payload.cookies.trim()
      if (raw.includes('\t') && /# Netscape/i.test(raw)) {
        // Netscape cookies.txt — parse into name=value pairs
        const pairs: string[] = []
        for (const line of raw.split('\n')) {
          const trimmed = line.trim()
          if (!trimmed || trimmed.startsWith('#')) continue
          const parts = trimmed.split('\t')
          if (parts.length >= 7) pairs.push(`${parts[5]}=${parts[6]}`)
        }
        cookies = pairs.join('; ')
      } else {
        cookies = raw
      }
    }
    const jobId = crypto.randomUUID()
    const outDir = path.join(CAPTIONS_DIR, jobId)
    await fsp.mkdir(outDir, { recursive: true })
    const job: Job = {
      id: jobId,
      url,
      languages: payload.languages && payload.languages.length > 0 ? payload.languages : ['en'],
      workers: Math.max(1, Math.min(8, payload.workers ?? 3)),
      formats: payload.formats && payload.formats.length > 0 ? payload.formats : ['srt', 'txt'],
      filenamePattern: payload.filenamePattern || 'verbose',
      cookies: cookies || undefined,
      status: 'queued',
      videos: [],
      results: [],
      stats: { total: 0, done: 0, ok: 0, failed: 0, skipped: 0, noCaptions: 0, blocked: 0 },
      startedAt: Date.now(),
      cancelFlag: false,
      outDir,
    }
    JOBS.set(jobId, job)
    // Cap memory: keep last 30 jobs
    if (JOBS.size > 30) {
      const oldest = [...JOBS.entries()].sort((a, b) => a[1].startedAt - b[1].startedAt)[0]
      if (oldest && oldest[0] !== jobId) {
        const old = oldest[1]
        JOBS.delete(oldest[0])
        // Best-effort cleanup of temp dir
        fsp.rm(old.outDir, { recursive: true, force: true }).catch(() => {})
      }
    }
    socket.join(`job:${jobId}`)
    socket.emit('job:created', { jobId, url: job.url, languages: job.languages, workers: job.workers, formats: job.formats, filenamePattern: job.filenamePattern, hasCookies: !!job.cookies })
    log(jobId, 'info', `Job created — url=${url} langs=${job.languages.join(',')} workers=${job.workers} formats=${job.formats.join(',')} pattern=${job.filenamePattern}${job.cookies ? ' cookies=yes' : ''}`, io)
    // Run in background
    runJob(job, io).catch((e) => {
      log(jobId, 'error', `Unhandled job error: ${e?.message ?? e}`, io)
    })
  })

  socket.on('cancel', (jobId: string) => {
    const job = JOBS.get(jobId)
    if (job) {
      job.cancelFlag = true
      log(jobId, 'warn', 'Cancel requested', io)
    }
  })

  // List all jobs (for the job history UI). Returns metadata only, no
  // results/videos (those are fetched via `join` when a job is selected).
  socket.on('list-jobs', () => {
    const jobs = [...JOBS.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((j) => ({
        id: j.id,
        url: j.url,
        playlistTitle: j.playlistTitle,
        status: j.status,
        stats: j.stats,
        startedAt: j.startedAt,
        finishedAt: j.finishedAt,
        hasCookies: !!j.cookies,
        formats: j.formats,
        filenamePattern: j.filenamePattern,
      }))
    socket.emit('jobs:list', { jobs })
  })

  // Delete a job (for the job history UI's "clear" action)
  socket.on('delete-job', (jobId: string) => {
    const job = JOBS.get(jobId)
    if (job) {
      JOBS.delete(jobId)
      fsp.rm(job.outDir, { recursive: true, force: true }).catch(() => {})
      log(jobId, 'info', 'Job deleted', io)
    }
    socket.emit('job:deleted', { jobId })
  })

  // Re-run only the non-ok videos from an existing job. Useful for retrying
  // blocked/failed/no-captions videos after fixing the environment (e.g. adding
  // cookies or switching to a residential IP). Updates results in place.
  socket.on('retry-failed', async (payload: { jobId: string; cookies?: string }) => {
    const job = JOBS.get(payload.jobId)
    if (!job) {
      socket.emit('job:error', { jobId: payload.jobId, message: 'Job not found — it may have expired.' })
      return
    }
    if (job.status === 'fetching' || job.status === 'packaging') {
      socket.emit('job:error', { jobId: job.id, message: 'Job is still running. Wait for it to finish first.' })
      return
    }
    // Update cookies if provided
    if (payload.cookies !== undefined) {
      job.cookies = payload.cookies || undefined
    }
    // Find non-ok videos to retry
    const toRetry = job.results.filter((r) => r.status !== 'ok' && r.status !== 'skipped')
    if (toRetry.length === 0) {
      log(job.id, 'info', 'No failed videos to retry — all are already captured.', io)
      io.to(`job:${job.id}`).emit('job:done', {
        jobId: job.id,
        stats: job.stats,
        durationMs: 0,
        zipUrl: `/api/download/${job.id}`,
        manifestUrl: `/api/manifest/${job.id}`,
      })
      return
    }
    // Reset cancel flag and status
    job.cancelFlag = false
    job.status = 'fetching'
    // Reset stats for retried videos (decrement counters for the ones we're retrying)
    for (const r of toRetry) {
      if (r.status === 'blocked') job.stats.blocked = Math.max(0, job.stats.blocked - 1)
      else if (r.status === 'failed') job.stats.failed = Math.max(0, job.stats.failed - 1)
      else if (r.status === 'no-captions') job.stats.noCaptions = Math.max(0, job.stats.noCaptions - 1)
    }
    job.stats.done = job.stats.done - toRetry.length
    // Remove old results for retried videos
    job.results = job.results.filter((r) => r.status === 'ok' || r.status === 'skipped')
    log(job.id, 'info', `Re-running ${toRetry.length} failed/blocked videos${job.cookies ? ' with cookies' : ''}…`, io)
    emitProgress(job, io)

    // Re-fetch the retried videos
    await runPool(
      toRetry.map((r) => r.video),
      job.workers,
      async (video) => {
        if (job.cancelFlag) {
          const res: VideoResult = { video, status: 'skipped', error: 'cancelled' }
          job.results.push(res)
          job.stats.done++
          job.stats.skipped++
          emitProgress(job, io, res)
          return res
        }
        io.to(`job:${job.id}`).emit('video:start', { jobId: job.id, videoId: video.id, title: video.title, position: video.position })
        const res = await processVideo(job, video, io)
        job.results.push(res)
        job.stats.done++
        if (res.status === 'ok') job.stats.ok++
        else if (res.status === 'skipped') job.stats.skipped++
        else if (res.status === 'no-captions') job.stats.noCaptions++
        else if (res.status === 'blocked') job.stats.blocked++
        else job.stats.failed++
        const tag = res.status === 'ok' ? 'info' : res.status === 'blocked' ? 'error' : res.status === 'no-captions' ? 'warn' : 'error'
        const extra = res.status === 'ok'
          ? ` (${res.snippetCount} snippets, ${(res.fileSize ? res.fileSize / 1024 : 0).toFixed(1)} KB${res.captionSource && res.captionSource !== 'unknown' ? `, ${res.captionSource === 'auto' ? 'auto-generated' : res.captionSource === 'translated' ? 'auto-translated' : 'manual'} captions` : ''})`
          : res.error ? ` — ${res.error}` : ''
        log(job.id, tag as any, `[${job.stats.done}/${job.stats.total}] ${video.title}${extra}`, io)
        emitProgress(job, io, res)
        return res
      },
      () => {}
    )

    if (job.cancelFlag) {
      job.status = 'cancelled'
      job.finishedAt = Date.now()
      emitProgress(job, io)
      log(job.id, 'warn', 'Retry cancelled by user', io)
      io.to(`job:${job.id}`).emit('job:cancelled', { jobId: job.id })
      return
    }

    // Re-package with updated results
    log(job.id, 'info', 'Re-packaging ZIP + manifest...', io)
    await packageJob(job, io)
    job.status = 'done'
    job.finishedAt = Date.now()
    const dur = ((job.finishedAt - job.startedAt) / 1000).toFixed(1)
    log(job.id, 'info', `Retry done — ok:${job.stats.ok} failed:${job.stats.failed} no-captions:${job.stats.noCaptions} skipped:${job.stats.skipped} blocked:${job.stats.blocked}`, io)
    io.to(`job:${job.id}`).emit('job:done', {
      jobId: job.id,
      stats: job.stats,
      durationMs: job.finishedAt - job.startedAt,
      zipUrl: `/api/download/${job.id}`,
      manifestUrl: `/api/manifest/${job.id}`,
    })
    emitProgress(job, io)
  })

  socket.on('ping', () => socket.emit('pong', { time: Date.now() }))

  socket.on('disconnect', () => {
    // Sockets are ephemeral; jobs continue in background
  })
})

httpServer.listen(PORT, () => {
  console.log(`[transcript-service] listening on :${PORT} (socket.io path "/" + HTTP /api/*)`)
})

// Graceful shutdown
function shutdown(signal: string) {
  console.log(`[transcript-service] ${signal} received, shutting down...`)
  httpServer.close(() => {
    io.close()
    process.exit(0)
  })
  // Force exit after 5s if hanging
  setTimeout(() => process.exit(0), 5000).unref()
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

export {}
