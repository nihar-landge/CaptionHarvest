/**
 * Robust YouTube playlist extractor.
 *
 * YouTube recently changed the playlist page to use `lockupViewModel` items +
 * `continuationItemViewModel` pagination via the `/youtubei/v1/browse` InnerTube
 * API, instead of the old inline `playlistVideoListRenderer` / `playlistVideoRenderer`
 * structure that `ytpl` and similar libraries hard-code against.
 *
 * This module:
 *  - fetches the playlist page and parses `ytInitialData`
 *  - recursively finds all `lockupViewModel` nodes (videoId = `contentId`)
 *  - follows `CONTINUATION_REQUEST_TYPE_BROWSE` continuation tokens through the
 *    InnerTube browse endpoint until exhausted
 *  - also handles the legacy `playlistVideoRenderer` / `playlistPanelVideoRenderer`
 *    shapes as a fallback
 *  - dedupes by videoId while preserving order
 */

export interface PlaylistVideo {
  id: string
  title: string
  position: number
  author?: string
  lengthSeconds?: number
}

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const DEFAULT_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8'
const DEFAULT_CLIENT_VERSION = '2.20260708.00.00'

export function extractPlaylistId(url: string): string | null {
  const m = url.match(/[?&]list=([a-zA-Z0-9_-]+)/)
  if (m) return m[1]
  // bare playlist id
  if (/^(PL|OL|UU|RD|FL|LL|PU)[\w-]+$/.test(url.trim())) return url.trim()
  return null
}

async function fetchText(url: string, headers: Record<string, string> = {}, body?: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9', ...headers },
    body,
    method: body ? 'POST' : 'GET',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
}

/** Extract the first JSON object that appears after `key` in `html` using brace matching. */
function extractJsonObject(html: string, key: string): any | null {
  const startIdx = html.indexOf(key)
  if (startIdx === -1) return null
  const openIdx = html.indexOf('{', startIdx)
  if (openIdx === -1) return null
  let depth = 0
  let end = -1
  let inStr = false
  let esc = false
  for (let i = openIdx; i < html.length; i++) {
    const c = html[i]
    if (inStr) {
      if (esc) {
        esc = false
        continue
      }
      if (c === '\\') {
        esc = true
        continue
      }
      if (c === '"') inStr = false
      continue
    }
    if (c === '"') {
      inStr = true
      continue
    }
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        end = i + 1
        break
      }
    }
  }
  if (end === -1) return null
  try {
    return JSON.parse(html.slice(openIdx, end))
  } catch {
    return null
  }
}

/** Recursively walk a JSON tree, invoking cb for every dict node. */
function walk(obj: any, cb: (node: any, key: string, parent: any) => void): void {
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (const v of obj) walk(v, cb)
    } else {
      for (const k of Object.keys(obj)) {
        const v = obj[k]
        cb(v, k, obj)
        walk(v, cb)
      }
    }
  }
}

function findAll(obj: any, key: string): any[] {
  const out: any[] = []
  walk(obj, (v, k) => {
    if (k === key) out.push(v)
  })
  return out
}

function parseTitle(t: any): string | null {
  if (t == null) return null
  if (typeof t === 'string') return t
  if (typeof t === 'object') {
    if (typeof t.content === 'string') return t.content
    if (typeof t.simpleText === 'string') return t.simpleText
    if (Array.isArray(t.runs) && t.runs.length > 0) {
      return t.runs.map((r: any) => r?.text ?? '').join('')
    }
    if (t.accessibility?.accessibilityData?.label) return t.accessibility.accessibilityData.label
  }
  return null
}

function parseDurationLabel(s: string | undefined): number | undefined {
  if (!s) return undefined
  // formats: "1:27:41", "12:34", "5"
  const parts = s.split(':').map((p) => parseInt(p, 10))
  if (parts.some((p) => isNaN(p))) return undefined
  let sec = 0
  for (const p of parts) sec = sec * 60 + p
  return sec
}

interface ParsedVideo {
  id: string
  title: string
  author?: string
  lengthSeconds?: number
}

function parseLockup(lvm: any): ParsedVideo | null {
  if (!lvm || typeof lvm !== 'object') return null
  let id: string | undefined = lvm.contentId
  if (!id) {
    const vids = findAll(lvm, 'videoId')
    id = vids[0]
  }
  if (!id) return null
  const md = lvm.metadata?.lockupMetadataViewModel ?? {}
  let title = parseTitle(md.title)
  if (!title) title = id
  // duration: look for thumbnailBadgeViewModel text like "1:27:41"
  let lengthSeconds: number | undefined
  const badges = findAll(lvm, 'thumbnailBadgeViewModel')
  for (const b of badges) {
    const lbl = b?.text
    if (typeof lbl === 'string' && /^\d/.test(lbl)) {
      lengthSeconds = parseDurationLabel(lbl)
      if (lengthSeconds) break
    }
  }
  // author: lockupMetadataViewModel.metadata?.metadataRowRendererViewModel?.contents[0]
  let author: string | undefined
  const rows = findAll(md, 'metadataRowRendererViewModel')
  for (const r of rows) {
    const cell = r?.contents?.[0]
    const txt = parseTitle(cell)
    if (txt) {
      author = txt
      break
    }
  }
  return { id, title, author, lengthSeconds }
}

// Legacy fallback: playlistVideoRenderer (older playlist shape, still used sometimes)
function parsePlaylistVideoRenderer(pvr: any): ParsedVideo | null {
  if (!pvr) return null
  const id = pvr.videoId
  if (!id) return null
  const title = parseTitle(pvr.title) ?? id
  const lengthSeconds = pvr.lengthSeconds ? Number(pvr.lengthSeconds) : parseDurationLabel(pvr.lengthText?.simpleText)
  const author = parseTitle(pvr.shortBylineText) ?? undefined
  return { id, title, author, lengthSeconds: lengthSeconds || undefined }
}

// Mix / radio playlists use playlistPanelVideoRenderer
function parsePanelVideoRenderer(pvr: any): ParsedVideo | null {
  if (!pvr) return null
  const id = pvr.videoId
  if (!id) return null
  const title = parseTitle(pvr.title) ?? id
  const lengthSeconds = parseDurationLabel(pvr.lengthText?.simpleText)
  const author = parseTitle(pvr.longBylineText) ?? undefined
  return { id, title, author, lengthSeconds }
}

function findContinuationToken(data: any): string | null {
  let token: string | null = null
  walk(data, (v, k) => {
    if (token) return
    if (k === 'continuationCommand' && v && typeof v === 'object') {
      if (v.request === 'CONTINUATION_REQUEST_TYPE_BROWSE' && typeof v.token === 'string') {
        token = v.token
      }
    }
  })
  return token
}

function collectVideos(data: any): ParsedVideo[] {
  const out: ParsedVideo[] = []
  const seen = new Set<string>()
  const push = (v: ParsedVideo | null) => {
    if (!v || !v.id || seen.has(v.id)) return
    seen.add(v.id)
    out.push(v)
  }
  for (const lvm of findAll(data, 'lockupViewModel')) push(parseLockup(lvm))
  for (const pvr of findAll(data, 'playlistVideoRenderer')) push(parsePlaylistVideoRenderer(pvr))
  for (const pvr of findAll(data, 'playlistPanelVideoRenderer')) push(parsePanelVideoRenderer(pvr))
  return out
}

export async function extractPlaylist(
  url: string,
  opts: { maxPages?: number; onProgress?: (msg: string) => void } = {}
): Promise<{ title: string; videos: PlaylistVideo[] }> {
  const maxPages = opts.maxPages ?? 200
  const onProgress = opts.onProgress ?? (() => {})
  const pid = extractPlaylistId(url)
  if (!pid) throw new Error('Could not find a playlist ID in the URL (need ?list=...)')

  const pageUrl = `https://www.youtube.com/playlist?list=${pid}&hl=en`
  onProgress(`Fetching playlist page…`)
  const html = await fetchText(pageUrl)
  const yid = extractJsonObject(html, 'ytInitialData')
  if (!yid) throw new Error('YouTube did not return ytInitialData (the page may be a consent/bot-check page). Try again later.')

  const title =
    yid?.metadata?.playlistMetadataRenderer?.title ??
    yid?.header?.pageHeaderRenderer?.pageTitle ??
    pid

  // InnerTube client config
  const apiKeyMatch = html.match(/"INNERTUBE_API_KEY":"([^"]+)"/)
  const clientVersionMatch = html.match(/"INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)
  const apiKey = apiKeyMatch?.[1] ?? DEFAULT_API_KEY
  const clientVersion = clientVersionMatch?.[1] ?? DEFAULT_CLIENT_VERSION

  const videos: PlaylistVideo[] = []
  const seen = new Set<string>()
  const addAll = (list: ParsedVideo[]) => {
    for (const v of list) {
      if (!v.id || seen.has(v.id)) continue
      seen.add(v.id)
      videos.push({ id: v.id, title: v.title, author: v.author, lengthSeconds: v.lengthSeconds, position: videos.length })
    }
  }

  addAll(collectVideos(yid))
  onProgress(`Found ${videos.length} videos on the first page`)

  let token = findContinuationToken(yid)
  let page = 0
  while (token && page < maxPages) {
    page++
    const body = JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion, hl: 'en', gl: 'US' } },
      continuation: token,
    })
    let rj: any
    try {
      const resp = await fetchText(`https://www.youtube.com/youtubei/v1/browse?key=${apiKey}`, {
        'Content-Type': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      }, body)
      rj = JSON.parse(resp)
    } catch (e: any) {
      onProgress(`Continuation page ${page} failed: ${e?.message ?? e}`)
      break
    }
    const before = videos.length
    addAll(collectVideos(rj))
    const added = videos.length - before
    onProgress(`Page ${page}: +${added} videos (total ${videos.length})`)
    token = findContinuationToken(rj)
    // Be polite between continuation requests
    if (token) await new Promise((r) => setTimeout(r, 300))
  }

  if (videos.length === 0) {
    throw new Error('Playlist parsed but no videos found. The playlist may be empty or private.')
  }

  return { title, videos }
}
