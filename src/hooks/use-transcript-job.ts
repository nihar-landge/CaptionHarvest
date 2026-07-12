'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'

// ----------------------------------------------------------------------------
// Types — mirror the mini-service contract
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

export type JobStatus =
  | 'idle'
  | 'queued'
  | 'extracting'
  | 'fetching'
  | 'packaging'
  | 'done'
  | 'error'
  | 'cancelled'

export interface LogEntry {
  level: 'info' | 'warn' | 'error'
  message: string
  ts: number
}

export interface JobState {
  jobId: string | null
  status: JobStatus
  playlistTitle?: string
  url: string
  languages: string[]
  workers: number
  formats: ('srt' | 'txt' | 'vtt')[]
  filenamePattern: FilenamePattern
  hasCookies?: boolean
  videos: PlaylistVideo[]
  results: VideoResult[]
  processingIds: Set<string>
  stats: JobStats
  logs: LogEntry[]
  zipUrl?: string
  manifestUrl?: string
  startedAt?: number
  finishedAt?: number
  error?: string
}

const initialState: JobState = {
  jobId: null,
  status: 'idle',
  url: '',
  languages: ['en'],
  workers: 3,
  formats: ['srt', 'txt'],
  filenamePattern: 'verbose',
  videos: [],
  results: [],
  processingIds: new Set(),
  stats: { total: 0, done: 0, ok: 0, failed: 0, skipped: 0, noCaptions: 0, blocked: 0 },
  logs: [],
}

const MAX_LOGS = 200
const MAX_RESULTS = 600

function clampResults(arr: VideoResult[]): VideoResult[] {
  return arr.length > MAX_RESULTS ? arr.slice(arr.length - MAX_RESULTS) : arr
}

export interface JobSummary {
  id: string
  url: string
  playlistTitle?: string
  status: string
  stats: JobStats
  startedAt: number
  finishedAt?: number
  hasCookies: boolean
  formats: string[]
  filenamePattern: FilenamePattern
}

export interface UseTranscriptJobReturn extends JobState {
  connected: boolean
  serverTime: number | null
  jobHistory: JobSummary[]
  start: (opts: { url: string; languages: string[]; workers: number; formats: ('srt' | 'txt' | 'vtt')[]; filenamePattern?: FilenamePattern; cookies?: string }) => void
  cancel: () => void
  reset: () => void
  retryFailed: (cookies?: string) => void
  listJobs: () => void
  restoreJob: (jobId: string) => void
  deleteJob: (jobId: string) => void
}

export function useTranscriptJob(): UseTranscriptJobReturn {
  const socketRef = useRef<Socket | null>(null)
  const [connected, setConnected] = useState(false)
  const [serverTime, setServerTime] = useState<number | null>(null)
  const [state, setState] = useState<JobState>(initialState)
  const [jobHistory, setJobHistory] = useState<JobSummary[]>([])

  useEffect(() => {
    // Connect to the transcript mini-service. Per gateway rules, the socket path
    // is "/" and the port is passed via XTransformPort query param.
    const s = io('http://localhost:3003', {
      path: '/',
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1200,
      timeout: 15000,
    })
    socketRef.current = s

    s.on('connect', () => {
      setConnected(true)
      // Fetch the job history on connect
      s.emit('list-jobs')
    })
    s.on('disconnect', () => setConnected(false))
    s.on('connected', (d: { serverTime: number }) => setServerTime(d.serverTime))

    s.on('job:created', (d: { jobId: string; url: string; languages: string[]; workers: number; formats: ('srt' | 'txt' | 'vtt')[]; filenamePattern?: FilenamePattern; hasCookies?: boolean }) => {
      setState((prev) => ({
        ...prev,
        jobId: d.jobId,
        status: 'queued',
        url: d.url,
        languages: d.languages,
        workers: d.workers,
        formats: d.formats,
        filenamePattern: d.filenamePattern ?? 'verbose',
        hasCookies: d.hasCookies,
        videos: [],
        results: [],
        processingIds: new Set(),
        stats: { total: 0, done: 0, ok: 0, failed: 0, skipped: 0, noCaptions: 0, blocked: 0 },
        logs: [],
        zipUrl: undefined,
        manifestUrl: undefined,
        startedAt: Date.now(),
        finishedAt: undefined,
        error: undefined,
      }))
    })

    s.on('job:playlist', (d: { jobId: string; title: string; total: number; videos: PlaylistVideo[] }) => {
      setState((prev) => ({
        ...prev,
        playlistTitle: d.title,
        videos: d.videos,
        stats: { ...prev.stats, total: d.total },
      }))
    })

    s.on('job:progress', (d: { done: number; total: number; ok: number; failed: number; skipped: number; noCaptions: number; blocked: number; percent: number; status: string }) => {
      setState((prev) => ({
        ...prev,
        status: (mapStatus(d.status) as JobStatus) || prev.status,
        stats: {
          total: d.total,
          done: d.done,
          ok: d.ok,
          failed: d.failed,
          skipped: d.skipped,
          noCaptions: d.noCaptions,
          blocked: d.blocked ?? 0,
        },
      }))
    })

    s.on('video:start', (d: { videoId: string }) => {
      setState((prev) => {
        const next = new Set(prev.processingIds)
        next.add(d.videoId)
        return { ...prev, processingIds: next }
      })
    })

    s.on('video:result', (d: { result: VideoResult }) => {
      setState((prev) => {
        const next = new Set(prev.processingIds)
        next.delete(d.result.video.id)
        return {
          ...prev,
          results: clampResults([...prev.results, d.result]),
          processingIds: next,
        }
      })
    })

    s.on('job:log', (d: LogEntry & { jobId: string }) => {
      setState((prev) => ({
        ...prev,
        logs: [...prev.logs, { level: d.level, message: d.message, ts: d.ts }].slice(-MAX_LOGS),
      }))
    })

    s.on('job:done', (d: { jobId: string; stats: JobStats; durationMs: number; zipUrl: string; manifestUrl: string }) => {
      setState((prev) => ({
        ...prev,
        status: 'done',
        // Don't replace stats from job:done — the job:progress events have the
        // authoritative stats (including `blocked`). We only need the download URLs.
        zipUrl: d.zipUrl,
        manifestUrl: d.manifestUrl,
        finishedAt: Date.now(),
      }))
    })

    s.on('job:error', (d: { jobId: string | null; message: string }) => {
      setState((prev) => ({
        ...prev,
        status: d.jobId ? 'error' : prev.status,
        error: d.message,
        finishedAt: Date.now(),
      }))
    })

    s.on('job:cancelled', () => {
      setState((prev) => ({ ...prev, status: 'cancelled', finishedAt: Date.now() }))
    })

    s.on('job:snapshot', (d: Partial<JobState> & { results?: VideoResult[]; videos?: PlaylistVideo[]; stats?: JobStats }) => {
      setState((prev) => ({
        ...prev,
        ...d,
        results: d.results ?? prev.results,
        videos: d.videos ?? prev.videos,
        stats: d.stats ?? prev.stats,
        processingIds: new Set(),
        status: (mapStatus(d.status as string) as JobStatus) ?? prev.status,
      }))
    })

    s.on('jobs:list', (d: { jobs: JobSummary[] }) => {
      setJobHistory(d.jobs || [])
    })

    s.on('job:deleted', (d: { jobId: string }) => {
      setJobHistory((prev) => prev.filter((j) => j.id !== d.jobId))
    })

    return () => {
      s.disconnect()
      socketRef.current = null
    }
  }, [])

  // Persist jobId to localStorage so a page refresh can rejoin the job.
  // Only persist when we have a real jobId; don't clear on initial mount
  // (the restore effect handles cleanup if the job no longer exists).
  useEffect(() => {
    if (state.jobId) {
      try {
        localStorage.setItem('captionharvest:jobId', state.jobId)
      } catch {}
    }
  }, [state.jobId])

  // On mount, if there's a stored jobId, rejoin it to get the snapshot.
  // If no snapshot arrives within 2s (job no longer exists on backend),
  // clear the stale jobId from localStorage.
  useEffect(() => {
    if (!connected) return
    try {
      const storedJobId = localStorage.getItem('captionharvest:jobId')
      if (!storedJobId) return
      socketRef.current?.emit('join', storedJobId)
      const timeout = setTimeout(() => {
        // If we still don't have a jobId in state, the job wasn't found
        setState((prev) => {
          if (!prev.jobId) {
            try {
              localStorage.removeItem('captionharvest:jobId')
            } catch {}
          }
          return prev
        })
      }, 2500)
      return () => clearTimeout(timeout)
    } catch {}
  }, [connected])

  const start = useCallback(
    (opts: { url: string; languages: string[]; workers: number; formats: ('srt' | 'txt' | 'vtt')[]; filenamePattern?: FilenamePattern; cookies?: string }) => {
      socketRef.current?.emit('start', opts)
    },
    []
  )

  const cancel = useCallback(() => {
    setState((prev) => ({ ...prev, status: 'cancelled' }))
    if (state.jobId) socketRef.current?.emit('cancel', state.jobId)
  }, [state.jobId])

  const reset = useCallback(() => {
    setState(initialState)
    try {
      localStorage.removeItem('captionharvest:jobId')
    } catch {}
  }, [])

  const retryFailed = useCallback(
    (cookies?: string) => {
      if (state.jobId) {
        // Transition to fetching immediately for UI feedback
        setState((prev) => ({ ...prev, status: 'fetching' }))
        socketRef.current?.emit('retry-failed', { jobId: state.jobId, cookies })
      }
    },
    [state.jobId]
  )

  const listJobs = useCallback(() => {
    socketRef.current?.emit('list-jobs')
  }, [])

  const restoreJob = useCallback((jobId: string) => {
    try {
      localStorage.setItem('captionharvest:jobId', jobId)
    } catch {}
    socketRef.current?.emit('join', jobId)
  }, [])

  const deleteJob = useCallback((jobId: string) => {
    socketRef.current?.emit('delete-job', jobId)
    // If we're deleting the current job, reset
    setState((prev) => {
      if (prev.jobId === jobId) {
        try {
          localStorage.removeItem('captionharvest:jobId')
        } catch {}
        return initialState
      }
      return prev
    })
  }, [])

  return { ...state, connected, serverTime, jobHistory, start, cancel, reset, retryFailed, listJobs, restoreJob, deleteJob }
}

function mapStatus(s: string | undefined): JobStatus | null {
  if (!s) return null
  switch (s) {
    case 'queued':
    case 'extracting':
    case 'fetching':
    case 'packaging':
    case 'done':
    case 'error':
    case 'cancelled':
      return s
    default:
      return null
  }
}
