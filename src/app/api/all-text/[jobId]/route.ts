import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-static'
export const runtime = 'nodejs'

const CAPTIONS_DIR = process.env.CAPTIONS_DIR || path.join(os.tmpdir(), 'playlist-captions')

/**
 * GET /api/all-text/[jobId]
 * Returns the combined transcripts as plain text (JSON), suitable for
 * copy-to-clipboard. Reads the all_transcripts.txt file if it exists;
 * otherwise returns a 404.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }

  const filePath = path.join(CAPTIONS_DIR, jobId, 'all_transcripts.txt')
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return NextResponse.json(
        { error: 'Combined file not found — no transcripts were captured in this job' },
        { status: 404 }
      )
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    // Compute stats
    const wordCount = content.split(/\s+/).filter(Boolean).length
    const charCount = content.length
    const lineCount = content.split('\n').length
    return NextResponse.json(
      {
        content,
        size: stat.size,
        wordCount,
        charCount,
        lineCount,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch {
    return NextResponse.json(
      { error: 'Job not found or combined file not yet generated' },
      { status: 404 }
    )
  }
}
