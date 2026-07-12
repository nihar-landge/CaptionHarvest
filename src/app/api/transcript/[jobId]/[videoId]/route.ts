import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-static'
export const runtime = 'nodejs'

const CAPTIONS_DIR = process.env.CAPTIONS_DIR || path.join(os.tmpdir(), 'playlist-captions')

/**
 * GET /api/transcript/[jobId]/[videoId]?format=srt|txt
 * Returns the transcript content for a single video, for inline preview.
 * Finds the file by globbing for `*[videoId].srt` or `*[videoId].txt` in the job dir.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string; videoId: string }> }
) {
  const { jobId, videoId } = await params
  // Strict-validate IDs (UUID + 11-char videoId) to prevent path traversal
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }
  if (!/^[\w-]{6,30}$/.test(videoId)) {
    return NextResponse.json({ error: 'Invalid video id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const fmtParam = url.searchParams.get('format')
  const format: 'srt' | 'vtt' | 'txt' = fmtParam === 'vtt' ? 'vtt' : fmtParam === 'txt' ? 'txt' : 'srt'

  const jobDir = path.join(CAPTIONS_DIR, jobId)
  try {
    const files = fs.readdirSync(jobDir)
    // Find file matching `*[videoId].{ext}`
    const target = files.find(
      (f) => f.endsWith(`[${videoId}].${format}`) && !f.endsWith('.zip')
    )
    // Fall back to other formats if the requested one doesn't exist.
    // Preference order: the requested format, then srt, then vtt, then txt.
    const fallbacks = ['srt', 'vtt', 'txt'].filter((f) => f !== format)
    let chosen = target
    for (const fb of fallbacks) {
      if (chosen) break
      chosen = files.find((f) => f.endsWith(`[${videoId}].${fb}`) && !f.endsWith('.zip'))
    }
    if (!chosen) {
      return NextResponse.json(
        { error: 'Transcript file not found for this video' },
        { status: 404 }
      )
    }
    const filePath = path.join(jobDir, chosen)
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Not a file' }, { status: 404 })
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    const actualFormat = chosen.endsWith('.srt') ? 'srt' : 'txt'
    return NextResponse.json(
      {
        videoId,
        format: actualFormat,
        content,
        size: stat.size,
        filename: chosen,
      },
      {
        headers: { 'Cache-Control': 'no-store' },
      }
    )
  } catch {
    return NextResponse.json(
      { error: 'Job directory not found' },
      { status: 404 }
    )
  }
}
