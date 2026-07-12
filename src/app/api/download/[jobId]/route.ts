import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export const dynamic = 'force-static'
export const runtime = 'nodejs'

const CAPTIONS_DIR = process.env.CAPTIONS_DIR || path.join(os.tmpdir(), 'playlist-captions')

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  // Strict-validate jobId (UUID) to prevent path traversal
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }
  const zipPath = path.join(CAPTIONS_DIR, jobId, 'captions.zip')
  try {
    const stat = fs.statSync(zipPath)
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'ZIP not ready' }, { status: 404 })
    }
    const data = fs.readFileSync(zipPath)
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename="captions-${jobId.slice(0, 8)}.zip"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Job not found or ZIP not yet generated' },
      { status: 404 }
    )
  }
}
