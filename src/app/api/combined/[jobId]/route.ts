import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-static'
export const runtime = 'nodejs'

const CAPTIONS_DIR = process.env.CAPTIONS_DIR || path.join(os.tmpdir(), 'playlist-captions')

/**
 * GET /api/combined/[jobId]?format=txt|json
 * Downloads the combined all_transcripts.txt or all_transcripts.json file.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }

  const url = new URL(req.url)
  const format = url.searchParams.get('format') === 'json' ? 'json' : 'txt'
  const filename = format === 'json' ? 'all_transcripts.json' : 'all_transcripts.txt'
  const filePath = path.join(CAPTIONS_DIR, jobId, filename)

  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return NextResponse.json(
        { error: 'Combined file not found — no transcripts were captured in this job' },
        { status: 404 }
      )
    }
    const data = fs.readFileSync(filePath)
    const contentType = format === 'json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8'
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Job not found or combined file not yet generated' },
      { status: 404 }
    )
  }
}
