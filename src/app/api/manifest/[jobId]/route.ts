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
  if (!/^[a-f0-9-]{36}$/i.test(jobId)) {
    return NextResponse.json({ error: 'Invalid job id' }, { status: 400 })
  }
  const manifestPath = path.join(CAPTIONS_DIR, jobId, 'manifest.csv')
  try {
    const stat = fs.statSync(manifestPath)
    if (!stat.isFile()) {
      return NextResponse.json({ error: 'Manifest not ready' }, { status: 404 })
    }
    const data = fs.readFileSync(manifestPath, 'utf-8')
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Length': String(Buffer.byteLength(data)),
        'Content-Disposition': `attachment; filename="manifest-${jobId.slice(0, 8)}.csv"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch {
    return NextResponse.json(
      { error: 'Job not found or manifest not yet generated' },
      { status: 404 }
    )
  }
}
